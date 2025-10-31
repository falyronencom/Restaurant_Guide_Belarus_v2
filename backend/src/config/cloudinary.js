/**
 * Cloudinary Configuration and Utilities
 * 
 * This module configures the Cloudinary SDK and provides helper functions for
 * image upload, URL generation with optimization parameters, and deletion.
 * 
 * Cloudinary serves as the image hosting and optimization platform for all
 * establishment media. It provides automatic format optimization (WebP for
 * modern browsers, JPEG fallback), quality adjustment, and progressive loading.
 * 
 * Architecture note: This module encapsulates all Cloudinary-specific logic,
 * making it easy to swap CDN providers in the future if needed. The media
 * service layer calls these utilities without knowing implementation details.
 * 
 * Critical requirements:
 * - ALL images must include optimization parameters: f_auto, q_auto, fl_progressive
 * - THREE resolutions generated for each upload: original, preview, thumbnail
 * - Proper error handling for upload failures
 * - Clean deletion when media is removed
 */

import { v2 as cloudinary } from 'cloudinary';
import logger from '../utils/logger.js';

/**
 * Configure Cloudinary SDK with credentials from environment variables
 * 
 * Required environment variables:
 * - CLOUDINARY_CLOUD_NAME: Your Cloudinary cloud name
 * - CLOUDINARY_API_KEY: Your Cloudinary API key
 * - CLOUDINARY_API_SECRET: Your Cloudinary API secret
 * 
 * These credentials are configured in the .env file and should never be
 * committed to version control. They provide authenticated access to your
 * Cloudinary account for upload, transformation, and deletion operations.
 */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // Always use HTTPS for security
});

/**
 * Base optimization parameters applied to all images
 * 
 * These parameters enable Cloudinary's automatic optimization features:
 * - f_auto: Automatically serves WebP for modern clients (25-35% smaller),
 *           JPEG fallback for older browsers
 * - q_auto: Content-aware automatic quality adjustment
 * - fl_progressive: Progressive JPEG encoding for faster perceived loading
 */
const OPTIMIZATION_PARAMS = 'f_auto,q_auto,fl_progressive';

/**
 * Image resolution configurations for the three-tier system
 * 
 * Each uploaded image is available in three resolutions to optimize
 * bandwidth and loading performance:
 * 
 * - Original: Maximum 1920x1080, maintains aspect ratio
 *   Used for: Full-screen image viewing, high-quality displays
 * 
 * - Preview: 800x600, fit within bounds maintaining aspect
 *   Used for: Detail screens, medium-sized image displays
 * 
 * - Thumbnail: 200x150, fill entire bounds with cropping
 *   Used for: List views, gallery thumbnails, fast loading
 */
const RESOLUTION_CONFIG = {
  original: {
    width: 1920,
    height: 1080,
    crop: 'limit', // Never exceed dimensions, maintain aspect ratio
  },
  preview: {
    width: 800,
    height: 600,
    crop: 'fit', // Fit within dimensions, maintain aspect ratio
  },
  thumbnail: {
    width: 200,
    height: 150,
    crop: 'fill', // Fill entire dimensions, may crop to fit
  },
};

/**
 * Upload an image to Cloudinary
 * 
 * This function handles the complete upload workflow:
 * 1. Upload image to Cloudinary with quality optimization
 * 2. Store in folder structure for organization
 * 3. Return public_id and secure URL for database storage
 * 
 * The uploaded image is stored in a folder structure:
 * establishments/{establishmentId}/{filename}
 * 
 * This organization makes it easy to:
 * - Find all images for a specific establishment
 * - Perform bulk operations (backup, migration)
 * - Debug issues with specific establishments
 * 
 * @param {string} filePath - Local file path of the image to upload
 * @param {string} establishmentId - UUID of the establishment (for folder organization)
 * @param {string} mediaType - Type of media ('interior', 'exterior', 'menu', 'dishes')
 * @returns {Promise<Object>} Upload result with public_id and secure_url
 * @throws {Error} If upload fails
 */
export const uploadImage = async (filePath, establishmentId, mediaType) => {
  try {
    // Upload to Cloudinary with optimization settings
    const uploadResult = await cloudinary.uploader.upload(filePath, {
      folder: `establishments/${establishmentId}/${mediaType}`,
      resource_type: 'image',
      quality: 'auto', // Automatic quality optimization
      fetch_format: 'auto', // Automatic format selection (WebP when supported)
      transformation: [
        {
          width: RESOLUTION_CONFIG.original.width,
          height: RESOLUTION_CONFIG.original.height,
          crop: RESOLUTION_CONFIG.original.crop,
        },
      ],
    });

    logger.info('Image uploaded to Cloudinary', {
      publicId: uploadResult.public_id,
      establishmentId,
      mediaType,
      format: uploadResult.format,
      bytes: uploadResult.bytes,
    });

    return {
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url,
      width: uploadResult.width,
      height: uploadResult.height,
      format: uploadResult.format,
    };
  } catch (error) {
    logger.error('Error uploading image to Cloudinary', {
      error: error.message,
      establishmentId,
      mediaType,
    });
    throw new Error(`Failed to upload image: ${error.message}`);
  }
};

/**
 * Generate optimized URL for an image with specified resolution
 * 
 * This function constructs Cloudinary URLs with transformation parameters
 * for the requested resolution. All URLs include optimization parameters
 * for automatic format and quality selection.
 * 
 * The transformation parameters are applied in the URL structure:
 * https://res.cloudinary.com/{cloud_name}/image/upload/{transformations}/{public_id}.jpg
 * 
 * Example URL:
 * https://res.cloudinary.com/mycloud/image/upload/f_auto,q_auto,fl_progressive,w_800,h_600,c_fit/establishments/abc-123/interior/photo.jpg
 * 
 * @param {string} publicId - Cloudinary public_id from upload
 * @param {string} resolution - Resolution type ('original', 'preview', 'thumbnail')
 * @returns {string} Optimized image URL with transformations
 */
export const generateImageUrl = (publicId, resolution = 'original') => {
  const config = RESOLUTION_CONFIG[resolution];

  if (!config) {
    logger.warn('Invalid resolution requested, using original', { resolution });
    return generateImageUrl(publicId, 'original');
  }

  // Generate URL with transformation parameters
  const url = cloudinary.url(publicId, {
    transformation: [
      {
        width: config.width,
        height: config.height,
        crop: config.crop,
      },
      {
        fetch_format: 'auto',
        quality: 'auto',
        flags: 'progressive',
      },
    ],
    secure: true, // Always use HTTPS
  });

  return url;
};

/**
 * Generate all three resolution URLs for an image
 * 
 * This convenience function generates URLs for all three resolutions
 * in a single call. The media model uses this to populate the three
 * URL fields in the database when creating media records.
 * 
 * @param {string} publicId - Cloudinary public_id from upload
 * @returns {Object} Object with url, preview_url, and thumbnail_url properties
 */
export const generateAllResolutions = (publicId) => {
  return {
    url: generateImageUrl(publicId, 'original'),
    preview_url: generateImageUrl(publicId, 'preview'),
    thumbnail_url: generateImageUrl(publicId, 'thumbnail'),
  };
};

/**
 * Delete an image from Cloudinary
 * 
 * This function permanently removes an image from Cloudinary storage.
 * It should be called when media is deleted from the database to prevent
 * orphaned files that consume storage quota.
 * 
 * The function is idempotent - calling it multiple times with the same
 * public_id will succeed without error (even if the image was already deleted).
 * 
 * @param {string} publicId - Cloudinary public_id to delete
 * @returns {Promise<Object>} Deletion result
 * @throws {Error} If deletion fails
 */
export const deleteImage = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);

    logger.info('Image deleted from Cloudinary', {
      publicId,
      result: result.result, // 'ok' if successful, 'not found' if already deleted
    });

    return result;
  } catch (error) {
    logger.error('Error deleting image from Cloudinary', {
      error: error.message,
      publicId,
    });
    throw new Error(`Failed to delete image: ${error.message}`);
  }
};

/**
 * Extract public_id from Cloudinary URL
 * 
 * When deleting media, we need to extract the public_id from the stored URL
 * to call the deletion API. This function parses various Cloudinary URL formats
 * to extract the public_id.
 * 
 * Example URL formats:
 * - https://res.cloudinary.com/cloud/image/upload/v1234567890/establishments/abc/interior/photo.jpg
 * - https://res.cloudinary.com/cloud/image/upload/transformations/establishments/abc/interior/photo.jpg
 * 
 * Extracted public_id: establishments/abc/interior/photo
 * 
 * @param {string} cloudinaryUrl - Full Cloudinary URL
 * @returns {string|null} Extracted public_id or null if parsing fails
 */
export const extractPublicIdFromUrl = (cloudinaryUrl) => {
  try {
    // Cloudinary URL pattern: .../upload/{version or transformations}/{public_id}.{format}
    const urlParts = cloudinaryUrl.split('/upload/');
    
    if (urlParts.length < 2) {
      logger.warn('Invalid Cloudinary URL format', { cloudinaryUrl });
      return null;
    }

    // Get the part after '/upload/'
    const afterUpload = urlParts[1];
    
    // Skip version number (v1234567890) or transformation parameters if present
    const pathParts = afterUpload.split('/');
    
    // Find the start of the actual path (after version/transformations)
    let startIndex = 0;
    if (pathParts[0].startsWith('v') || pathParts[0].includes(',')) {
      startIndex = 1;
    }

    // Rejoin the path and remove file extension
    const pathWithExtension = pathParts.slice(startIndex).join('/');
    const publicId = pathWithExtension.replace(/\.[^.]+$/, ''); // Remove extension

    logger.debug('Extracted public_id from URL', {
      cloudinaryUrl,
      publicId,
    });

    return publicId;
  } catch (error) {
    logger.error('Error extracting public_id from URL', {
      error: error.message,
      cloudinaryUrl,
    });
    return null;
  }
};

/**
 * Validate image file type
 * 
 * This function checks if the uploaded file is a valid image type.
 * We accept common web image formats that Cloudinary can optimize.
 * 
 * Accepted formats:
 * - JPEG/JPG: Most common, good compression
 * - PNG: Lossless, supports transparency
 * - WebP: Modern format, excellent compression
 * - HEIC: iOS native format (Cloudinary converts to web formats)
 * 
 * Not accepted:
 * - GIF: Use video for animations
 * - BMP: Uncompressed, too large
 * - TIFF: Professional format, not web-optimized
 * 
 * @param {string} mimetype - MIME type from uploaded file
 * @returns {boolean} True if valid image type
 */
export const isValidImageType = (mimetype) => {
  const validTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
  ];

  return validTypes.includes(mimetype);
};

/**
 * Validate image file size
 * 
 * We enforce a maximum file size to prevent abuse and ensure reasonable
 * upload times. The 10MB limit is generous for high-quality photos while
 * preventing extremely large files.
 * 
 * For context:
 * - Modern smartphone photo: 2-5MB
 * - Professional DSLR photo: 5-15MB (acceptable)
 * - Unnecessarily large file: >20MB (rejected)
 * 
 * @param {number} sizeInBytes - File size in bytes
 * @returns {boolean} True if size is acceptable
 */
export const isValidImageSize = (sizeInBytes) => {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB in bytes
  return sizeInBytes <= MAX_SIZE;
};

export default cloudinary;

