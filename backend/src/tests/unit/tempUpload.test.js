/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit tests for utils/tempUpload.js — the one place that removes the file
 * multer wrote into TEMP_UPLOAD_DIR. The contract the controllers and the
 * validate middleware rely on: never throws, never rejects, silent when the
 * file is already gone, warns (with the path) on any other failure.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.unstable_mockModule('../../utils/logger.js', () => ({ default: mockLogger }));

const { discardTempUpload } = await import('../../utils/tempUpload.js');

describe('discardTempUpload', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgb-temp-upload-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('removes the file multer wrote and resolves without logging', async () => {
    const filePath = path.join(dir, 'upload.jpg');
    fs.writeFileSync(filePath, 'fake image');

    await expect(discardTempUpload({ path: filePath })).resolves.toBeUndefined();

    expect(fs.existsSync(filePath)).toBe(false);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  test('is a no-op when the request carried no file', async () => {
    // JSON requests, and multipart requests whose optional image is absent
    // (promotions), reach the same finally with no req.file.
    await expect(discardTempUpload(undefined)).resolves.toBeUndefined();
    await expect(discardTempUpload(null)).resolves.toBeUndefined();
    await expect(discardTempUpload({})).resolves.toBeUndefined();

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  test('stays silent when the file is already gone — ENOENT is the desired end state', async () => {
    const filePath = path.join(dir, 'already-removed.jpg');

    await expect(discardTempUpload({ path: filePath })).resolves.toBeUndefined();

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  test('never rejects and warns with the path when the unlink fails for another reason', async () => {
    // unlink on a directory fails with EPERM (win32) / EISDIR (posix) — a
    // failure that is not ENOENT and must surface in the logs, not throw
    // out of a controller's finally.
    const dirPath = path.join(dir, 'not-a-file');
    fs.mkdirSync(dirPath);

    await expect(discardTempUpload({ path: dirPath })).resolves.toBeUndefined();

    expect(fs.existsSync(dirPath)).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to remove temp upload',
      expect.objectContaining({ path: dirPath, error: expect.any(String) }),
    );
  });
});
