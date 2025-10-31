/**
 * Media Controller
 * 
 * This controller handles HTTP requests and responses for the media management
 * system. It provides a thin layer between HTTP and business logic, extracting
 * data from requests, calling service methods, and formatting responses.
 * 
 * Architecture note: Controllers should be thin orchestration layers. They parse
 * requests, delegate to services, and format responses. Business logic lives in
 * the service layer, not here.
 * 
 * Note on file uploads: This controller expects file uploads to be handled by
 * multer middleware, which processes multipart/form-data and provides file
 * information in req.file. The actual file handling setup is done in the
 * routes layer.
 */

import * as MediaService from '../services/mediaService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Upload a new media file
 * 
 * POST /api/v1/partner/establishments/:id/media
 * Content-Type: multipart/form-data
 * 
 * This endpoint allows authenticated partners to upload photos for their establishments.
 * The file upload is handled by multer middleware before reaching this controller.
 * 
 * Request:
 * - file: Image file (multipart/form-data)
 * - type: Media type ('interior', 'exterior', 'menu', 'dishes')
 * - caption: Optional caption
 * - is_primary: Optional boolean (default: false)
 * 
 * The service layer handles:
 * - Ownership verification
 * - Tier limit enforcement
 * - Cloudinary upload
 * - Database record creation
 * - Primary photo logic
 */
export const uploadMedia = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const establishmentId = req.params.id;

  // Check if file was uploaded
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded',
      error_code: 'FILE_REQUIRED',
    });
  }

  // Extract metadata from request body
  const metadata = {
    type: req.body.type,
    caption: req.body.caption || null,
    is_primary: req.body.is_primary === 'true' || req.body.is_primary === true,
  };

  // Call service layer to handle upload
  const media = await MediaService.uploadMedia(
    partnerId,
    establishmentId,
    req.file,
    metadata
  );

  logger.info('Media uploaded via API', {
    mediaId: media.id,
    establishmentId,
    partnerId,
    type: metadata.type,
    endpoint: 'POST /api/v1/partner/establishments/:id/media',
  });

  // Return 201 Created with media object
  res.status(201).json({
    success: true,
    data: media,
  });
});

/**
 * Get all media for an establishment
 * 
 * GET /api/v1/partner/establishments/:id/media
 * 
 * Returns all media for the specified establishment, optionally filtered by type.
 * The service layer verifies ownership before returning data.
 * 
 * Query parameters:
 * - type: Optional media type filter
 */
export const getMedia = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const establishmentId = req.params.id;

  // Extract query parameters
  const filters = {
    type: req.query.type,
  };

  // Call service layer to fetch media
  const media = await MediaService.getMediaList(
    partnerId,
    establishmentId,
    filters
  );

  logger.info('Media list fetched via API', {
    establishmentId,
    partnerId,
    count: media.length,
    endpoint: 'GET /api/v1/partner/establishments/:id/media',
  });

  // Return media array
  res.status(200).json({
    success: true,
    data: media,
  });
});

/**
 * Update media details
 * 
 * PUT /api/v1/partner/establishments/:id/media/:mediaId
 * 
 * Allows partners to update caption, position (for reordering), or is_primary flag.
 * The image URLs cannot be changed - to change an image, delete and re-upload.
 * 
 * Request body (all fields optional):
 * - caption: New caption text
 * - position: New position number
 * - is_primary: Whether to set as primary photo
 */
export const updateMedia = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const establishmentId = req.params.id;
  const mediaId = req.params.mediaId;

  // Extract updates from request body
  const updates = {};
  
  if (req.body.caption !== undefined) {
    updates.caption = req.body.caption;
  }
  
  if (req.body.position !== undefined) {
    updates.position = parseInt(req.body.position, 10);
  }
  
  if (req.body.is_primary !== undefined) {
    updates.is_primary = req.body.is_primary === 'true' || req.body.is_primary === true;
  }

  // Call service layer to update media
  const updatedMedia = await MediaService.updateMediaDetails(
    partnerId,
    establishmentId,
    mediaId,
    updates
  );

  logger.info('Media updated via API', {
    mediaId,
    establishmentId,
    partnerId,
    updatedFields: Object.keys(updates),
    endpoint: 'PUT /api/v1/partner/establishments/:id/media/:mediaId',
  });

  // Return updated media
  res.status(200).json({
    success: true,
    data: updatedMedia,
  });
});

/**
 * Delete media
 * 
 * DELETE /api/v1/partner/establishments/:id/media/:mediaId
 * 
 * Deletes media from both Cloudinary and the database. If the deleted photo
 * was the primary photo, another photo is automatically set as primary.
 */
export const deleteMedia = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const establishmentId = req.params.id;
  const mediaId = req.params.mediaId;

  // Call service layer to delete media
  const result = await MediaService.deleteMedia(
    partnerId,
    establishmentId,
    mediaId
  );

  logger.info('Media deleted via API', {
    mediaId,
    establishmentId,
    partnerId,
    endpoint: 'DELETE /api/v1/partner/establishments/:id/media/:mediaId',
  });

  // Return success message
  res.status(200).json({
    success: true,
    data: result,
  });
});

