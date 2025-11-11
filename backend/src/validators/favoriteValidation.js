/**
 * Favorite Validation Rules
 * 
 * This module defines express-validator validation chains for favorites endpoints.
 * Validation middleware executes before controllers, ensuring only valid data
 * reaches business logic. This is the first line of defense against invalid input.
 * 
 * Architecture note: Validation serves multiple purposes:
 * 1. Security - Prevents malformed data from reaching database
 * 2. User experience - Provides clear error messages for invalid input
 * 3. Performance - Rejects bad requests early without wasting resources
 * 4. Data integrity - Ensures consistent data formats across the system
 * 
 * By catching problems early with clear error messages, we prevent wasted
 * processing and provide better user experience than letting database constraint
 * violations bubble up as generic errors.
 */

import { body, param, query } from 'express-validator';

/**
 * Validation for adding a favorite
 * 
 * POST /api/v1/favorites
 * 
 * This endpoint requires only the establishment_id in the request body.
 * The user_id comes from authenticated context (JWT token), not from
 * the request body, so we don't validate it here.
 * 
 * Validation rules:
 * - establishment_id must be present (not empty after trimming)
 * - establishment_id must be a valid UUID format
 * 
 * We validate UUID format to catch obviously invalid inputs early. The
 * actual existence check happens in the service layer with a database query
 * because we need to verify the establishment exists and is active.
 */
export const validateAddFavorite = [
  body('establishmentId')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),
];

/**
 * Validation for removing a favorite
 * 
 * DELETE /api/v1/favorites/:establishmentId
 * 
 * This endpoint takes the establishment ID as a URL path parameter.
 * We validate it follows UUID format to catch malformed requests early.
 * 
 * The actual favorite existence check happens in the service layer, but
 * format validation here prevents obviously invalid requests from consuming
 * database resources.
 */
export const validateRemoveFavorite = [
  param('establishmentId')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),
];

/**
 * Validation for getting user's favorites list
 * 
 * GET /api/v1/favorites
 * 
 * This endpoint supports pagination through optional query parameters.
 * The validation ensures pagination values are within reasonable bounds
 * to prevent abuse and maintain good performance.
 * 
 * Query parameters (all optional with defaults):
 * - page: Must be a positive integer (default: 1)
 * - limit: Must be between 1 and 50 (default: 10)
 * 
 * We cap limit at 50 to prevent users from requesting thousands of results
 * in a single request, which could cause performance issues. This limit is
 * consistent with the Reviews system's pagination approach.
 * 
 * Architecture note: Pagination parameters follow the same pattern as the
 * Reviews system for consistency. Users and developers should experience
 * the same pagination behavior across all paginated endpoints.
 */
export const validateGetFavorites = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer')
    .toInt(), // Convert string to integer

  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50')
    .toInt(), // Convert string to integer
];

/**
 * Validation for checking single favorite status
 * 
 * GET /api/v1/favorites/check/:establishmentId
 * 
 * This endpoint takes a single establishment ID as a path parameter.
 * We validate it's a properly formatted UUID to catch malformed requests.
 * 
 * This is a lightweight read operation, so the validation is simple -
 * just format checking without additional business rule validation.
 */
export const validateCheckFavorite = [
  param('establishmentId')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),
];

/**
 * Validation for batch checking favorite status
 * 
 * POST /api/v1/favorites/check-batch
 * 
 * This endpoint accepts an array of establishment IDs in the request body.
 * The validation ensures the array is properly formatted and within
 * reasonable size limits to prevent abuse.
 * 
 * Validation rules:
 * - establishment_ids must be present
 * - establishment_ids must be an array
 * - Array must not be empty (at least 1 ID)
 * - Array must not exceed 50 IDs (performance limit)
 * - Each element must be a valid UUID format
 * 
 * The 50-item limit prevents users from requesting status for hundreds or
 * thousands of establishments at once, which could cause performance issues.
 * This limit should be sufficient for reasonable use cases like checking
 * status for a page of search results.
 * 
 * Architecture note: We use custom validation logic here because express-validator's
 * array validation isn't as flexible for complex array element validation. The
 * custom validator allows us to validate both the array structure and individual
 * element formats with clear error messages.
 */
export const validateCheckBatchFavorites = [
  body('establishment_ids')
    .exists()
    .withMessage('establishment_ids is required')
    .isArray({ min: 1, max: 50 })
    .withMessage('establishment_ids must be an array with 1-50 items')
    .custom((value) => {
      // Validate each element is a valid UUID
      if (!Array.isArray(value)) {
        throw new Error('establishment_ids must be an array');
      }

      // Check array is not empty
      if (value.length === 0) {
        throw new Error('establishment_ids array cannot be empty');
      }

      // Check array size limit
      if (value.length > 50) {
        throw new Error('Cannot check more than 50 establishments at once');
      }

      // Validate each element is a valid UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const invalidIds = value.filter(id => !uuidRegex.test(id));
      
      if (invalidIds.length > 0) {
        throw new Error(
          `Invalid UUID format for establishment IDs: ${invalidIds.slice(0, 3).join(', ')}${
            invalidIds.length > 3 ? '...' : ''
          }`
        );
      }

      return true;
    }),
];

/**
 * No validation needed for stats endpoint
 * 
 * GET /api/v1/favorites/stats
 * 
 * This endpoint takes no parameters - it returns statistics for the
 * authenticated user based on their JWT token. Since there are no inputs
 * to validate, we export an empty array for consistency with the routing
 * pattern even though no validation middleware is needed.
 * 
 * The authentication middleware will ensure the user is authenticated,
 * which is the only requirement for this endpoint.
 */
export const validateGetStats = [];

/**
 * Common validation helper for UUID parameters
 * 
 * This is a reusable validation chain that can be composed into other
 * validation rules. It's not exported because the specific validators
 * above are sufficient for current needs, but it demonstrates how
 * validation logic can be modularized and reused.
 * 
 * Future enhancement: If we add more endpoints that accept establishment
 * IDs, we could export this helper and compose it into their validation rules
 * to reduce duplication.
 */
const validateUUID = (fieldName, location = 'param') => {
  const validator = location === 'param' ? param : location === 'body' ? body : query;
  
  return validator(fieldName)
    .trim()
    .notEmpty()
    .withMessage(`${fieldName} is required`)
    .isUUID()
    .withMessage(`${fieldName} must be a valid UUID`);
};

/**
 * Validation error messages guide
 * 
 * The error messages in this module follow these principles:
 * 
 * 1. Be specific: "Rating must be between 1 and 5" rather than "Invalid rating"
 * 2. Be actionable: Tell users what to fix, not just what's wrong
 * 3. Be consistent: Use the same phrasing patterns across similar validations
 * 4. Be friendly: Avoid technical jargon in user-facing messages
 * 
 * Examples of good vs bad error messages:
 * 
 * Good: "Page must be a positive integer"
 * Bad: "Invalid page parameter"
 * 
 * Good: "establishment_ids must be an array with 1-50 items"
 * Bad: "Bad request"
 * 
 * Good: "Establishment ID must be a valid UUID"
 * Bad: "UUID validation failed"
 * 
 * These error messages appear in API responses and may be displayed to users
 * in the mobile app, so clarity and helpfulness are important.
 */

