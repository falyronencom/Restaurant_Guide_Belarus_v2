/**
 * Media Validation Rules
 * 
 * This module defines express-validator validation chains for media management
 * endpoints. Validation middleware executes before controllers, ensuring only
 * valid data reaches business logic.
 * 
 * Architecture note: Validation serves multiple purposes:
 * 1. Security - Prevents malformed data from reaching database and external services
 * 2. User experience - Provides clear error messages for invalid input
 * 3. Performance - Rejects bad requests early without wasting resources
 * 4. Data integrity - Ensures consistent data formats across the system
 * 
 * Note on file uploads: File validation (type, size) is handled by multer
 * middleware and business logic in the service layer. This validation focuses
 * on metadata fields (type, caption, is_primary).
 */

import { body, param, query } from 'express-validator';

/**
 * Valid media type values
 */
const VALID_MEDIA_TYPES = ['interior', 'exterior', 'menu', 'dishes'];

/**
 * Validation for uploading media
 * 
 * POST /api/v1/partner/establishments/:id/media
 * 
 * Required:
 * - id: Valid UUID of establishment (path parameter)
 * - type: Valid media type ('interior', 'exterior', 'menu', 'dishes')
 * - file: Image file (handled by multer, not validated here)
 * 
 * Optional:
 * - caption: Max 255 characters
 * - is_primary: Boolean
 */
export const validateUpload = [
  // Establishment ID parameter validation
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  // Media type validation
  body('type')
    .trim()
    .notEmpty()
    .withMessage('Media type is required')
    .isIn(VALID_MEDIA_TYPES)
    .withMessage(`Media type must be one of: ${VALID_MEDIA_TYPES.join(', ')}`),

  // Caption validation (optional)
  body('caption')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Caption must not exceed 255 characters'),

  // is_primary validation (optional, defaults to false)
  body('is_primary')
    .optional()
    .isBoolean()
    .withMessage('is_primary must be a boolean value (true or false)')
    .toBoolean(),
];

/**
 * Validation for getting media list
 * 
 * GET /api/v1/partner/establishments/:id/media
 * 
 * Required:
 * - id: Valid UUID of establishment (path parameter)
 * 
 * Optional:
 * - type: Valid media type for filtering
 */
export const validateGetMedia = [
  // Establishment ID parameter validation
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  // Type query parameter validation (optional filter)
  query('type')
    .optional()
    .isIn(VALID_MEDIA_TYPES)
    .withMessage(`Type filter must be one of: ${VALID_MEDIA_TYPES.join(', ')}`),
];

/**
 * Validation for updating media
 * 
 * PUT /api/v1/partner/establishments/:id/media/:mediaId
 * 
 * Required:
 * - id: Valid UUID of establishment (path parameter)
 * - mediaId: Valid UUID of media (path parameter)
 * 
 * Optional (at least one field must be provided):
 * - caption: Max 255 characters
 * - position: Non-negative integer
 * - is_primary: Boolean
 */
export const validateUpdate = [
  // Establishment ID parameter validation
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  // Media ID parameter validation
  param('mediaId')
    .trim()
    .notEmpty()
    .withMessage('Media ID is required')
    .isUUID()
    .withMessage('Media ID must be a valid UUID'),

  // Caption validation (optional)
  body('caption')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Caption must not exceed 255 characters'),

  // Position validation (optional)
  body('position')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Position must be a non-negative integer')
    .toInt(),

  // is_primary validation (optional)
  body('is_primary')
    .optional()
    .isBoolean()
    .withMessage('is_primary must be a boolean value (true or false)')
    .toBoolean(),
];

/**
 * Validation for deleting media
 * 
 * DELETE /api/v1/partner/establishments/:id/media/:mediaId
 * 
 * Required:
 * - id: Valid UUID of establishment (path parameter)
 * - mediaId: Valid UUID of media (path parameter)
 */
export const validateDelete = [
  // Establishment ID parameter validation
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  // Media ID parameter validation
  param('mediaId')
    .trim()
    .notEmpty()
    .withMessage('Media ID is required')
    .isUUID()
    .withMessage('Media ID must be a valid UUID'),
];

