/**
 * Temp Upload Cleanup
 *
 * Every multer destination in the backend writes the incoming file into
 * TEMP_UPLOAD_DIR (middleware/upload.js) and hands `req.file.path` to the
 * layer that transfers it to Cloudinary. Nothing deletes that file afterwards:
 * multer only removes it when the upload itself aborts, and Cloudinary reads
 * the path without touching it. Whoever receives `req.file` therefore owns its
 * removal — on every outcome, not only after a successful transfer. Until
 * 2026-09-06 the establishment media and promotion endpoints never removed it,
 * so every upload leaked one file: on Railway the disk is ephemeral and the
 * leak lived until the next deploy; locally two months of tests and dev
 * uploads left 16.7k files / 24 MB behind.
 *
 * Owners today: the media and promotion controllers (`finally` around the
 * service call), `validate` in middleware/errorHandler.js (a request rejected
 * by express-validator has already been written to disk by multer and never
 * reaches a controller), tempMediaRoutes and authController.uploadAvatar
 * (their own unlink calls, predating this helper).
 */

import fs from 'fs';
import logger from './logger.js';

/**
 * Remove the temp file multer wrote for a request, if there is one.
 *
 * Safe to call from a `finally` and on requests without a file: never throws,
 * never rejects. A missing file (ENOENT) is the desired end state and stays
 * silent; any other failure is logged as a warn with the path, so a leak is
 * visible in the logs instead of silent.
 *
 * @param {Object|null|undefined} file - multer file object (`req.file`), or nothing
 * @returns {Promise<void>}
 */
export const discardTempUpload = async (file) => {
  const filePath = file?.path;
  if (!filePath) {
    return;
  }

  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn('Failed to remove temp upload', {
        path: filePath,
        error: err.message,
      });
    }
  }
};
