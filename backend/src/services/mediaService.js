/**
 * Media Service
 * 
 * This service implements all business logic for the establishment media system.
 * It orchestrates media uploads through Cloudinary, enforces subscription-based
 * upload limits, manages primary photo logic, and coordinates media CRUD operations.
 * 
 * Architecture note: Services contain the "what" and "why" of application behavior.
 * They understand domain concepts and business rules but are independent of HTTP
 * concerns. Controllers call services, services call models and external services
 * (like Cloudinary).
 */

import * as MediaModel from '../models/mediaModel.js';
import * as EstablishmentModel from '../models/establishmentModel.js';
import * as CloudinaryUtil from '../config/cloudinary.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Subscription tier upload limits
 * 
 * These limits control how many photos partners can upload based on their
 * subscription tier. The limits are enforced at the service layer before
 * allowing uploads to Cloudinary.
 * 
 * Limits are per media type (interior and menu are tracked separately).
 * Other types (exterior, dishes) share the interior limit for simplicity.
 */
const MEDIA_LIMITS = {
  free: { interior: 10, menu: 10 },
  basic: { interior: 15, menu: 15 },
  standard: { interior: 20, menu: 20 },
  premium: { interior: 30, menu: 30 },
};

/**
 * Valid media type values
 */
const VALID_MEDIA_TYPES = ['interior', 'exterior', 'menu', 'dishes'];

/**
 * Upload a new media file for an establishment
 * 
 * This is the core operation that orchestrates the complete media upload workflow:
 * 1. Verify establishment ownership
 * 2. Check subscription tier limits
 * 3. Validate file type and size
 * 4. Upload to Cloudinary
 * 5. Generate three resolution URLs
 * 6. Create database record
 * 7. Handle primary photo logic if needed
 * 
 * Business rules enforced:
 * - Partner must own the establishment
 * - Upload count must not exceed tier limits
 * - File must be valid image type and size
 * - If is_primary=true, clear other primary flags
 * - Automatically set position for proper ordering
 * 
 * @param {string} partnerId - UUID of the authenticated partner
 * @param {string} establishmentId - UUID of the establishment
 * @param {Object} file - Uploaded file object (from multer or similar)
 * @param {Object} metadata - Media metadata
 * @param {string} metadata.type - Media type ('interior', 'exterior', 'menu', 'dishes')
 * @param {string} metadata.caption - Optional caption
 * @param {boolean} metadata.is_primary - Whether to set as primary photo
 * @returns {Promise<Object>} Created media record with all URLs
 * @throws {AppError} If validation fails or business rules violated
 */
export const uploadMedia = async (partnerId, establishmentId, file, metadata) => {
  const { type, caption, is_primary = false } = metadata;

  try {
    // Validate media type
    if (!VALID_MEDIA_TYPES.includes(type)) {
      throw new AppError(
        `Invalid media type. Must be one of: ${VALID_MEDIA_TYPES.join(', ')}`,
        422,
        'INVALID_MEDIA_TYPE'
      );
    }

    // Verify establishment ownership
    const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
    if (!isOwner) {
      throw new AppError(
        'Establishment not found or access denied',
        404,
        'ESTABLISHMENT_NOT_FOUND'
      );
    }

    // Fetch establishment to check subscription tier
    const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);
    if (!establishment) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND'
      );
    }

    // Check current media count against tier limits
    const mediaCounts = await MediaModel.getMediaCountByType(establishmentId);
    
    // Determine which limit to check (menu uses menu limit, all others use interior limit)
    const limitType = type === 'menu' ? 'menu' : 'interior';
    const currentCount = mediaCounts[type] || 0;
    const tierLimits = MEDIA_LIMITS[establishment.subscription_tier] || MEDIA_LIMITS.free;
    const limit = tierLimits[limitType];

    if (currentCount >= limit) {
      throw new AppError(
        `Upload limit reached for ${type} photos. Your ${establishment.subscription_tier} tier allows ${limit} ${limitType} photos. Upgrade subscription to upload more.`,
        403,
        'MEDIA_LIMIT_EXCEEDED'
      );
    }

    // Validate file type
    if (!CloudinaryUtil.isValidImageType(file.mimetype)) {
      throw new AppError(
        'Invalid file type. Accepted formats: JPEG, PNG, WebP, HEIC',
        422,
        'INVALID_FILE_TYPE'
      );
    }

    // Validate file size
    if (!CloudinaryUtil.isValidImageSize(file.size)) {
      throw new AppError(
        'File size exceeds 10MB limit',
        422,
        'FILE_TOO_LARGE'
      );
    }

    // Upload to Cloudinary
    const uploadResult = await CloudinaryUtil.uploadImage(
      file.path,
      establishmentId,
      type
    );

    // Generate URLs for all three resolutions
    const urls = CloudinaryUtil.generateAllResolutions(uploadResult.public_id);

    // Get next position for proper ordering
    const position = await MediaModel.getNextPosition(establishmentId, type);

    // Create media record in database
    const mediaRecord = await MediaModel.createMedia({
      establishment_id: establishmentId,
      type,
      url: urls.url,
      thumbnail_url: urls.thumbnail_url,
      preview_url: urls.preview_url,
      caption,
      position,
      is_primary,
    });

    // If this is marked as primary, ensure other photos are not primary
    if (is_primary) {
      await MediaModel.setPrimaryPhoto(establishmentId, mediaRecord.id);
    }

    logger.info('Media uploaded successfully', {
      mediaId: mediaRecord.id,
      establishmentId,
      partnerId,
      type,
      isPrimary: is_primary,
      cloudinaryPublicId: uploadResult.public_id,
    });

    return mediaRecord;
  } catch (error) {
    // Re-throw if it's already an AppError
    if (error instanceof AppError) {
      throw error;
    }

    // Log unexpected errors
    logger.error('Unexpected error uploading media', {
      error: error.message,
      stack: error.stack,
      establishmentId,
      partnerId,
    });

    throw new AppError(
      'Failed to upload media',
      500,
      'MEDIA_UPLOAD_FAILED'
    );
  }
};

/**
 * Get all media for an establishment
 * 
 * Verifies ownership before returning media list. Supports filtering by type.
 * 
 * @param {string} partnerId - UUID of the authenticated partner
 * @param {string} establishmentId - UUID of the establishment
 * @param {Object} filters - Optional filters
 * @param {string} filters.type - Optional media type filter
 * @returns {Promise<Array>} Array of media objects
 * @throws {AppError} If establishment not found or access denied
 */
export const getMediaList = async (partnerId, establishmentId, filters = {}) => {
  try {
    // Verify ownership
    const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
    if (!isOwner) {
      throw new AppError(
        'Establishment not found or access denied',
        404,
        'ESTABLISHMENT_NOT_FOUND'
      );
    }

    // Fetch media
    const media = await MediaModel.getEstablishmentMedia(establishmentId, filters);

    logger.debug('Media list fetched', {
      establishmentId,
      partnerId,
      count: media.length,
      type: filters.type || 'all',
    });

    return media;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error('Error fetching media list', {
      error: error.message,
      establishmentId,
      partnerId,
    });

    throw new AppError(
      'Failed to fetch media',
      500,
      'MEDIA_FETCH_FAILED'
    );
  }
};

/**
 * Update media details
 * 
 * Allows partners to update caption, position (for reordering), or is_primary flag.
 * The image URLs cannot be changed - to change an image, delete and re-upload.
 * 
 * Business rules:
 * - Partner must own the establishment
 * - Media must belong to the establishment
 * - If is_primary changes to true, clear other primary flags
 * 
 * @param {string} partnerId - UUID of the authenticated partner
 * @param {string} establishmentId - UUID of the establishment
 * @param {string} mediaId - UUID of the media to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated media record
 * @throws {AppError} If validation fails or unauthorized
 */
export const updateMediaDetails = async (partnerId, establishmentId, mediaId, updates) => {
  try {
    // Verify establishment ownership
    const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
    if (!isOwner) {
      throw new AppError(
        'Establishment not found or access denied',
        404,
        'ESTABLISHMENT_NOT_FOUND'
      );
    }

    // Fetch media to verify it belongs to this establishment
    const media = await MediaModel.findMediaById(mediaId);
    if (!media || media.establishment_id !== establishmentId) {
      throw new AppError(
        'Media not found or does not belong to this establishment',
        404,
        'MEDIA_NOT_FOUND'
      );
    }

    // Update media
    const updatedMedia = await MediaModel.updateMedia(mediaId, updates);

    // If is_primary was set to true, ensure no other photos are primary
    if (updates.is_primary === true) {
      await MediaModel.setPrimaryPhoto(establishmentId, mediaId);
    }

    logger.info('Media updated successfully', {
      mediaId,
      establishmentId,
      partnerId,
      updatedFields: Object.keys(updates),
    });

    return updatedMedia;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error('Error updating media', {
      error: error.message,
      mediaId,
      establishmentId,
      partnerId,
    });

    throw new AppError(
      'Failed to update media',
      500,
      'MEDIA_UPDATE_FAILED'
    );
  }
};

/**
 * Delete media
 * 
 * This operation:
 * 1. Verifies ownership
 * 2. Deletes image from Cloudinary
 * 3. Deletes database record
 * 4. If deleted photo was primary, sets another photo as primary
 * 
 * Business rules:
 * - Partner must own the establishment
 * - Media must belong to the establishment
 * - Cloudinary deletion errors are logged but don't block database deletion
 * 
 * @param {string} partnerId - UUID of the authenticated partner
 * @param {string} establishmentId - UUID of the establishment
 * @param {string} mediaId - UUID of the media to delete
 * @returns {Promise<Object>} Deletion confirmation
 * @throws {AppError} If validation fails or unauthorized
 */
export const deleteMedia = async (partnerId, establishmentId, mediaId) => {
  try {
    // Verify establishment ownership
    const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
    if (!isOwner) {
      throw new AppError(
        'Establishment not found or access denied',
        404,
        'ESTABLISHMENT_NOT_FOUND'
      );
    }

    // Fetch media to verify it belongs to this establishment and get URLs
    const media = await MediaModel.findMediaById(mediaId);
    if (!media || media.establishment_id !== establishmentId) {
      throw new AppError(
        'Media not found or does not belong to this establishment',
        404,
        'MEDIA_NOT_FOUND'
      );
    }

    // Extract public_id from Cloudinary URL
    const publicId = CloudinaryUtil.extractPublicIdFromUrl(media.url);

    // Delete from Cloudinary (non-blocking - log error but continue)
    if (publicId) {
      try {
        await CloudinaryUtil.deleteImage(publicId);
      } catch (cloudinaryError) {
        // Log error but don't fail the operation
        // The database record should still be deleted even if Cloudinary fails
        logger.error('Failed to delete image from Cloudinary', {
          error: cloudinaryError.message,
          publicId,
          mediaId,
          establishmentId,
        });
      }
    } else {
      logger.warn('Could not extract public_id from URL, skipping Cloudinary deletion', {
        mediaId,
        url: media.url,
      });
    }

    // Delete from database
    const deletedMedia = await MediaModel.deleteMedia(mediaId);

    if (!deletedMedia) {
      throw new AppError(
        'Media not found',
        404,
        'MEDIA_NOT_FOUND'
      );
    }

    // If deleted photo was primary, set another photo as primary (lowest position number)
    if (media.is_primary) {
      const remainingMedia = await MediaModel.getEstablishmentMedia(establishmentId);
      
      if (remainingMedia.length > 0) {
        // Set the first media (lowest position) as primary
        await MediaModel.setPrimaryPhoto(establishmentId, remainingMedia[0].id);
        
        logger.info('New primary photo set after deletion', {
          establishmentId,
          newPrimaryMediaId: remainingMedia[0].id,
        });
      }
    }

    logger.info('Media deleted successfully', {
      mediaId,
      establishmentId,
      partnerId,
      wasPrimary: media.is_primary,
    });

    return {
      success: true,
      message: 'Media deleted successfully',
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error('Error deleting media', {
      error: error.message,
      mediaId,
      establishmentId,
      partnerId,
    });

    throw new AppError(
      'Failed to delete media',
      500,
      'MEDIA_DELETE_FAILED'
    );
  }
};

