/**
 * Media Routes
 * 
 * This module defines all media management API endpoints for partners,
 * composing controllers, validation middleware, authentication middleware,
 * and multer file upload middleware into complete request handling pipelines.
 * 
 * Architecture note: Routes are declarative specifications of how requests flow
 * through middleware chains. They should be readable as documentation of the API
 * surface without containing any logic themselves.
 * 
 * File Upload Configuration:
 * These routes use multer middleware to handle multipart/form-data uploads.
 * Multer processes the file upload and makes it available in req.file for
 * the controller to access. The configuration includes file size limits,
 * storage location, and filename generation.
 * 
 * All endpoints in this file are partner-only and require authentication.
 * The base path is /api/v1/partner/establishments/:id/media when mounted.
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as MediaController from '../../controllers/mediaController.js';
import * as MediaValidation from '../../validators/mediaValidation.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/errorHandler.js';

const router = express.Router({ mergeParams: true });

/**
 * Configure multer for file uploads
 * 
 * Multer handles multipart/form-data and saves uploaded files to a temporary
 * directory before they're processed and uploaded to Cloudinary.
 * 
 * Configuration:
 * - Storage: Disk storage in /tmp/uploads directory
 * - Filename: UUID-based to prevent conflicts
 * - File filter: Only allow image types (jpeg, jpg, png, webp, heic)
 * - Size limit: 10MB maximum per file
 * 
 * The files are stored temporarily and should be cleaned up after Cloudinary
 * upload completes. A cron job or periodic cleanup process should remove old
 * files from /tmp/uploads to prevent disk space issues.
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Store uploaded files in /tmp/uploads directory
    // This directory should exist and be writable
    cb(null, 'backend/tmp/uploads');
  },
  filename: (req, file, cb) => {
    // Generate unique filename using UUID to prevent conflicts
    // Keep original file extension for proper MIME type detection
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

/**
 * File filter to accept only image types
 * 
 * This provides early rejection of non-image files at the multer level,
 * before the file is fully uploaded. This saves bandwidth and processing time.
 * 
 * Accepted MIME types:
 * - image/jpeg
 * - image/jpg
 * - image/png
 * - image/webp
 * - image/heic
 */
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and HEIC images are allowed.'), false);
  }
};

/**
 * Create multer upload instance with configuration
 */
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB maximum file size
  },
});

/**
 * Apply authentication to all routes in this router
 * 
 * All media management endpoints require:
 * 1. Valid JWT token (authenticate middleware)
 * 2. 'partner' role (authorize middleware)
 * 
 * Note: We use mergeParams: true when creating the router to access
 * the :id parameter from the parent route (establishment ID).
 */
router.use(authenticate);
router.use(authorize('partner'));

/**
 * Upload a new media file
 * 
 * POST /api/v1/partner/establishments/:id/media
 * Content-Type: multipart/form-data
 * 
 * This endpoint handles image uploads for establishments. The file is first
 * uploaded to temporary storage via multer, then processed and uploaded to
 * Cloudinary by the service layer, and finally a database record is created.
 * 
 * Request:
 * - file: Image file (required, multipart/form-data field named 'file')
 * - type: Media type (required, form field: 'interior', 'exterior', 'menu', 'dishes')
 * - caption: Optional caption (form field, max 255 characters)
 * - is_primary: Optional boolean (form field, default: false)
 * 
 * Flow: 
 * Authentication → Authorization → Multer Upload → Validation → Controller → Service
 * 
 * The upload.single('file') middleware expects the file to be uploaded with
 * the field name 'file' in the multipart form data.
 * 
 * Protected: Yes (partner role required, ownership verified in service layer)
 * Rate Limited: Yes (50 requests/hour per partner for media uploads)
 */
router.post(
  '/',
  upload.single('file'), // Process file upload with field name 'file'
  MediaValidation.validateUpload,
  validate,
  MediaController.uploadMedia
);

/**
 * Get all media for an establishment
 * 
 * GET /api/v1/partner/establishments/:id/media
 * 
 * Returns all media for the specified establishment, optionally filtered by type.
 * Results are ordered by position (for manual ordering) and creation date.
 * 
 * Query parameters:
 * - type: Optional media type filter ('interior', 'exterior', 'menu', 'dishes')
 * 
 * Flow:
 * Authentication → Authorization → Validation → Controller → Service → Ownership Check
 * 
 * Returns: Array of media objects with all three resolution URLs
 * 
 * Protected: Yes (partner role required, ownership verified)
 */
router.get(
  '/',
  MediaValidation.validateGetMedia,
  validate,
  MediaController.getMedia
);

/**
 * Update media details
 * 
 * PUT /api/v1/partner/establishments/:id/media/:mediaId
 * Content-Type: application/json
 * 
 * Allows partners to update media caption, position (for reordering), or
 * is_primary flag. The image URLs cannot be changed - to change an image,
 * delete and re-upload.
 * 
 * Path parameters:
 * - id: UUID of the establishment
 * - mediaId: UUID of the media to update
 * 
 * Request body (all fields optional):
 * - caption: New caption text (max 255 characters)
 * - position: New position number (non-negative integer)
 * - is_primary: Whether to set as primary photo (boolean)
 * 
 * Flow:
 * Authentication → Authorization → Validation → Controller → Service → Ownership Check
 * 
 * Returns: Updated media object
 * 
 * Protected: Yes (partner role required, ownership verified)
 * 
 * Note: If is_primary is set to true, all other media for this establishment
 * will have is_primary set to false automatically.
 */
router.put(
  '/:mediaId',
  MediaValidation.validateUpdate,
  validate,
  MediaController.updateMedia
);

/**
 * Delete media
 * 
 * DELETE /api/v1/partner/establishments/:id/media/:mediaId
 * 
 * Deletes media from both Cloudinary and the database. This is a permanent
 * operation that cannot be undone.
 * 
 * Path parameters:
 * - id: UUID of the establishment
 * - mediaId: UUID of the media to delete
 * 
 * Flow:
 * Authentication → Authorization → Validation → Controller → Service → Ownership Check
 * 
 * The service layer handles:
 * 1. Verifying ownership
 * 2. Deleting from Cloudinary
 * 3. Deleting from database
 * 4. If deleted photo was primary, setting another as primary
 * 
 * Returns: Success confirmation
 * 
 * Protected: Yes (partner role required, ownership verified)
 */
router.delete(
  '/:mediaId',
  MediaValidation.validateDelete,
  validate,
  MediaController.deleteMedia
);

/**
 * Error handler for multer upload errors
 * 
 * This middleware catches errors from multer (file size exceeded, invalid type, etc.)
 * and formats them as consistent API error responses.
 * 
 * This should be registered AFTER the routes that use multer uploads.
 */
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    // Handle multer-specific errors
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: 'File size exceeds 10MB limit',
        error_code: 'FILE_TOO_LARGE',
      });
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected field in file upload',
        error_code: 'INVALID_UPLOAD_FIELD',
      });
    }

    // Generic multer error
    return res.status(400).json({
      success: false,
      message: error.message,
      error_code: 'UPLOAD_ERROR',
    });
  }

  if (error.message && error.message.includes('Invalid file type')) {
    // Handle file filter errors
    return res.status(422).json({
      success: false,
      message: error.message,
      error_code: 'INVALID_FILE_TYPE',
    });
  }

  // Pass other errors to global error handler
  next(error);
});

export default router;

