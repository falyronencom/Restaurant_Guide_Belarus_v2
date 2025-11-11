/**
 * Review Validation Rules
 * 
 * This module defines express-validator validation chains for review endpoints.
 * Validation middleware executes before controllers, ensuring only valid data
 * reaches business logic.
 * 
 * Architecture note: Validation serves as the first line of defense against invalid
 * input. By catching problems early with clear error messages, we prevent wasted
 * processing and provide better user experience than database constraint violations.
 */

import { body, param, query } from 'express-validator';

/**
 * Validation for creating a new review
 * 
 * POST /api/v1/reviews
 * 
 * These rules enforce the directive's specifications:
 * - establishment_id must be a valid UUID
 * - rating must be an integer between 1 and 5 inclusive
 * - content must be between 20 and 1000 characters after trimming
 * 
 * The user_id comes from authenticated context, not request body, so we don't validate it here.
 */
export const validateCreateReview = [
  body('establishmentId')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  body('rating')
    .notEmpty()
    .withMessage('Rating is required')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be an integer between 1 and 5'),

  body('content')
    .trim()
    .notEmpty()
    .withMessage('Review content is required')
    .isLength({ min: 20, max: 1000 })
    .withMessage('Review content must be between 20 and 1000 characters')
    // Custom validation to ensure content is substantive, not just repeated characters
    .custom((value) => {
      // Check if content is not just whitespace or repeated characters
      const uniqueChars = new Set(value.replace(/\s/g, '')).size;
      if (uniqueChars < 5) {
        throw new Error('Review content must contain meaningful text, not just repeated characters');
      }
      return true;
    }),
];

/**
 * Validation for getting a specific review by ID
 * 
 * GET /api/v1/reviews/:id
 * 
 * The only input is the review ID from the URL path parameter.
 * We validate it's a properly formatted UUID.
 */
export const validateGetReview = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Review ID is required')
    .isUUID()
    .withMessage('Review ID must be a valid UUID'),
];

/**
 * Validation for getting establishment reviews
 * 
 * GET /api/v1/establishments/:id/reviews
 * 
 * Path parameter: establishment ID (UUID)
 * Query parameters: page, limit, sort (all optional with defaults)
 * 
 * We validate ranges and enums to prevent malicious or nonsensical values.
 * For example, page 0 or limit 9999 should be rejected before reaching business logic.
 */
export const validateGetEstablishmentReviews = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),

  query('sort')
    .optional()
    .isIn(['newest', 'highest', 'lowest'])
    .withMessage('Sort must be one of: newest, highest, lowest'),
];

/**
 * Validation for getting user reviews
 * 
 * GET /api/v1/users/:id/reviews
 * 
 * Path parameter: user ID (UUID)
 * Query parameters: page, limit (both optional with defaults)
 * 
 * Similar to establishment reviews but without sort parameter since user reviews
 * always sort by newest first (most recent activity).
 */
export const validateGetUserReviews = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('User ID is required')
    .isUUID()
    .withMessage('User ID must be a valid UUID'),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50'),
];

/**
 * Validation for updating a review
 * 
 * PUT /api/v1/reviews/:id
 * 
 * Path parameter: review ID (UUID)
 * Body: rating and/or content (at least one must be provided)
 * 
 * This is a partial update endpoint - users can update just rating, just content,
 * or both. We validate that at least one field is present and that provided fields
 * meet the same requirements as creation.
 * 
 * The service layer handles authorization (ensuring user is review author).
 */
export const validateUpdateReview = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Review ID is required')
    .isUUID()
    .withMessage('Review ID must be a valid UUID'),

  // Rating is optional but if provided must be valid
  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be an integer between 1 and 5'),

  // Content is optional but if provided must be valid
  body('content')
    .optional()
    .trim()
    .isLength({ min: 20, max: 1000 })
    .withMessage('Review content must be between 20 and 1000 characters')
    // Same substantive content check as creation
    .custom((value) => {
      if (!value) return true; // Skip if not provided
      const uniqueChars = new Set(value.replace(/\s/g, '')).size;
      if (uniqueChars < 5) {
        throw new Error('Review content must contain meaningful text, not just repeated characters');
      }
      return true;
    }),

  // Custom validation to ensure at least one field is being updated
  body()
    .custom((value) => {
      const hasRating = value.rating !== undefined;
      const hasContent = value.content !== undefined;
      if (!hasRating && !hasContent) {
        throw new Error('At least one field (rating or content) must be provided for update');
      }
      return true;
    }),
];

/**
 * Validation for deleting a review
 * 
 * DELETE /api/v1/reviews/:id
 * 
 * The only input is the review ID from the URL path parameter.
 * The service layer handles authorization (ensuring user is review author).
 */
export const validateDeleteReview = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Review ID is required')
    .isUUID()
    .withMessage('Review ID must be a valid UUID'),
];

/**
 * No validation needed for quota endpoint
 * 
 * GET /api/v1/reviews/quota
 * 
 * This endpoint takes no parameters - it returns quota information for the
 * authenticated user based on their JWT token. No validation rules needed.
 */
export const validateGetQuota = [];

