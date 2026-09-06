/**
 * File Upload Middleware
 *
 * Configures multer for avatar uploads and owns the temp directory every multer
 * destination in the backend writes to (TEMP_UPLOAD_DIR = backend/tmp/uploads)
 * before the Cloudinary transfer. backend/uploads/ is only served statically for
 * legacy avatar URLs.
 */

import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Uploads root directory (backend/uploads/)
const UPLOADS_ROOT = path.join(__dirname, '..', '..', 'uploads');

// Legacy avatars directory — kept for express.static fallback of old relative URLs
const AVATARS_DIR = path.join(UPLOADS_ROOT, 'avatars');
fs.mkdirSync(AVATARS_DIR, { recursive: true });

// Temp directory for multer uploads (avatars, establishment media, promotions,
// pre-registration temp media) before the Cloudinary transfer.
// Module-relative on purpose: the server runs with cwd = backend/ locally
// (`npm start`) and /app on Railway (Root Directory = backend), so a cwd-relative
// 'backend/tmp/uploads' used to land in backend/backend/tmp/uploads locally and
// /app/backend/tmp/uploads in the container. Every multer destination imports
// this constant; importing the module also guarantees the directory exists
// before the first write.
const TEMP_UPLOAD_DIR = path.join(__dirname, '..', '..', 'tmp', 'uploads');
fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

// Allowed image MIME types
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * Storage configuration for avatar uploads.
 * Files saved as: tmp/uploads/{uuid}.{ext} (TEMP_UPLOAD_DIR), then transferred
 * to Cloudinary by authController.uploadAvatar and unlinked.
 */
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${randomUUID()}${ext}`);
  },
});

/**
 * File filter — only allow images
 */
const imageFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('INVALID_FILE_TYPE'), false);
  }
};

/**
 * Avatar upload middleware — single file, max 5MB
 */
export const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
}).single('avatar');

export { UPLOADS_ROOT, TEMP_UPLOAD_DIR };
