/**
 * Favorite Routes
 * 
 * This module defines all favorites-related API endpoints, composing controllers,
 * validation middleware, and authentication middleware into complete request
 * handling pipelines.
 * 
 * Architecture note: Routes are declarative specifications of how requests flow
 * through middleware chains. They should be readable as documentation of the API
 * surface without containing any logic themselves. Each route explicitly shows
 * all middleware applied in order, making the request flow transparent.
 * 
 * Middleware execution order is critical:
 * 1. Rate limiting (if applicable) - Prevent abuse before authentication
 * 2. Authentication - Verify JWT token and populate req.user
 * 3. Validation - Check request format and constraints
 * 4. Error formatting - Convert validation errors to API responses
 * 5. Controller - Handle business logic and return response
 * 
 * This order ensures efficient request processing: we reject unauthenticated
 * or invalid requests early without wasting resources on business logic.
 */

import express from 'express';
import * as FavoriteController from '../../controllers/favoriteController.js';
import * as FavoriteValidation from '../../validators/favoriteValidation.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/errorHandler.js';

const router = express.Router();

/**
 * POST /api/v1/favorites
 * 
 * Add an establishment to user's favorites collection.
 * 
 * This is a protected endpoint requiring authentication because favorites are
 * user-specific personal data. The user ID comes from the JWT token, not from
 * the request body, ensuring users can only add to their own favorites.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Validation: Check establishment_id is present and valid UUID format
 * 3. Error formatting: Convert validation errors to structured API responses
 * 4. Controller: Execute business logic to create favorite
 * 
 * The operation is idempotent - adding the same establishment multiple times
 * produces the same result without errors. This provides better UX for scenarios
 * like double-clicks or network retries.
 * 
 * Request body:
 * {
 *   "establishment_id": "uuid-of-establishment"
 * }
 * 
 * Success response (201 Created):
 * {
 *   "success": true,
 *   "data": {
 *     "id": "favorite-uuid",
 *     "establishment_id": "establishment-uuid",
 *     "created_at": "2025-10-20T10:30:00Z",
 *     "message": "Establishment added to favorites"
 *   }
 * }
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 404 Not Found: Establishment doesn't exist or is inactive
 * - 422 Unprocessable Entity: Invalid establishment_id format
 */
router.post(
  '/',
  authenticate,
  FavoriteValidation.validateAddFavorite,
  validate,
  FavoriteController.addFavorite
);

/**
 * DELETE /api/v1/favorites/:establishmentId
 * 
 * Remove an establishment from user's favorites collection.
 * 
 * This is a protected endpoint requiring authentication. Users can only remove
 * from their own favorites collection, enforced through JWT token context.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Validation: Check establishmentId path parameter is valid UUID format
 * 3. Error formatting: Convert validation errors to structured API responses
 * 4. Controller: Execute business logic to delete favorite
 * 
 * The operation is idempotent - removing a non-existent favorite succeeds
 * without error because the desired end state is achieved. If the favorite
 * doesn't exist, it still doesn't exist after the operation.
 * 
 * Success response (200 OK):
 * {
 *   "success": true,
 *   "data": {
 *     "message": "Establishment removed from favorites"
 *   }
 * }
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 422 Unprocessable Entity: Invalid establishment_id format
 */
router.delete(
  '/:establishmentId',
  authenticate,
  FavoriteValidation.validateRemoveFavorite,
  validate,
  FavoriteController.removeFavorite
);

/**
 * GET /api/v1/favorites
 * 
 * Get all favorites for the authenticated user with pagination.
 * 
 * This is a protected endpoint requiring authentication. Users can only view
 * their own favorites - the user ID comes from JWT token, not URL parameters,
 * preventing access to others' favorites.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Validation: Check pagination parameters (page, limit) are valid
 * 3. Error formatting: Convert validation errors to structured API responses
 * 4. Controller: Fetch favorites with establishment details and pagination
 * 
 * Query parameters (all optional):
 * - page: Page number (default: 1, must be positive integer)
 * - limit: Results per page (default: 10, max: 50)
 * 
 * Success response (200 OK):
 * {
 *   "success": true,
 *   "data": {
 *     "favorites": [
 *       {
 *         "id": "favorite-uuid",
 *         "establishment_id": "establishment-uuid",
 *         "created_at": "2025-10-20T10:30:00Z",
 *         "establishment": {
 *           "name": "Restaurant Name",
 *           "description": "Description...",
 *           "city": "Минск",
 *           "address": "Address...",
 *           "location": { "latitude": 53.9, "longitude": 27.5 },
 *           "categories": ["restaurant"],
 *           "cuisines": ["belarusian"],
 *           "price_range": "$$",
 *           "rating": { "average": 4.5, "count": 120 },
 *           "is_active": true,
 *           "primary_image": "https://..."
 *         }
 *       }
 *     ],
 *     "pagination": {
 *       "page": 1,
 *       "limit": 10,
 *       "total": 25,
 *       "pages": 3,
 *       "hasNext": true,
 *       "hasPrevious": false
 *     }
 *   }
 * }
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 400 Bad Request: Invalid pagination parameters
 */
router.get(
  '/',
  authenticate,
  FavoriteValidation.validateGetFavorites,
  validate,
  FavoriteController.getUserFavorites
);

/**
 * GET /api/v1/favorites/check/:establishmentId
 * 
 * Check if a specific establishment is in user's favorites.
 * 
 * This is a protected endpoint requiring authentication because favorite status
 * is user-specific. Different users will have different favorite collections.
 * 
 * IMPORTANT: This route must be defined BEFORE the DELETE /:establishmentId route
 * to prevent 'check' from being interpreted as an establishment ID. Route order
 * matters in Express - routes are matched top-to-bottom, and the first match wins.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Validation: Check establishmentId path parameter is valid UUID format
 * 3. Error formatting: Convert validation errors to structured API responses
 * 4. Controller: Check favorite status for the establishment
 * 
 * This is a lightweight read operation that's very fast due to database indexing.
 * It's safe to call frequently for UI state updates.
 * 
 * Success response (200 OK):
 * {
 *   "success": true,
 *   "data": {
 *     "establishment_id": "establishment-uuid",
 *     "is_favorite": true
 *   }
 * }
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 422 Unprocessable Entity: Invalid establishment_id format
 */
router.get(
  '/check/:establishmentId',
  authenticate,
  FavoriteValidation.validateCheckFavorite,
  validate,
  FavoriteController.checkFavoriteStatus
);

/**
 * POST /api/v1/favorites/check-batch
 * 
 * Batch check favorite status for multiple establishments.
 * 
 * This is a protected endpoint for efficiently checking favorite status across
 * multiple establishments in a single request. It's designed for use cases like
 * search results where the frontend needs to show favorite status for 10-20
 * establishments at once.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Validation: Check establishment_ids is array with 1-50 valid UUIDs
 * 3. Error formatting: Convert validation errors to structured API responses
 * 4. Controller: Check favorite status for all establishments
 * 
 * Request body:
 * {
 *   "establishment_ids": [
 *     "uuid-1",
 *     "uuid-2",
 *     "uuid-3"
 *   ]
 * }
 * 
 * Success response (200 OK):
 * {
 *   "success": true,
 *   "data": {
 *     "favorites": {
 *       "uuid-1": true,
 *       "uuid-2": false,
 *       "uuid-3": true
 *     }
 *   }
 * }
 * 
 * The response format is an object mapping establishment IDs to boolean values,
 * allowing easy lookup by the frontend without array searching.
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 * - 400 Bad Request: Invalid array format or size
 * - 422 Unprocessable Entity: Invalid UUID format in array
 */
router.post(
  '/check-batch',
  authenticate,
  FavoriteValidation.validateCheckBatchFavorites,
  validate,
  FavoriteController.checkBatchFavoriteStatus
);

/**
 * GET /api/v1/favorites/stats
 * 
 * Get statistics about user's favorites collection.
 * 
 * This is a protected endpoint that returns aggregate statistics about the
 * authenticated user's favorites. Currently returns basic count information,
 * but could be expanded to include breakdowns by city, category, average
 * ratings, etc.
 * 
 * OPTIONAL FEATURE: This endpoint is included for completeness but may not be
 * necessary for MVP. The basic functionality of add/remove/list favorites is
 * sufficient. This endpoint can be deferred if implementation timeline is tight.
 * 
 * Middleware chain:
 * 1. Authentication: Verify JWT token and attach user data to req.user
 * 2. Controller: Calculate and return statistics
 * 
 * No validation needed because this endpoint takes no parameters - everything
 * comes from the authenticated user context.
 * 
 * Success response (200 OK):
 * {
 *   "success": true,
 *   "data": {
 *     "total_favorites": 25
 *   }
 * }
 * 
 * Error responses:
 * - 401 Unauthorized: Missing or invalid JWT token
 */
router.get(
  '/stats',
  authenticate,
  FavoriteController.getFavoritesStats
);

/**
 * Route ordering considerations
 * 
 * The order of route definitions matters in Express. Routes are matched from
 * top to bottom, and the first matching route handles the request. This is
 * particularly important for routes with similar patterns.
 * 
 * Correct order (what we have):
 * 1. POST / - Specific static route
 * 2. GET /check/:establishmentId - Specific prefix with parameter
 * 3. POST /check-batch - Specific static route
 * 4. GET /stats - Specific static route
 * 5. GET / - Specific static route
 * 6. DELETE /:establishmentId - Generic parameter route
 * 
 * If we put DELETE /:establishmentId before GET /check/:establishmentId,
 * then GET /check/uuid would match the DELETE route with 'check' as the
 * establishment ID, which would be wrong.
 * 
 * Best practice: Define more specific routes (with prefixes like 'check' or
 * 'stats') before generic parameter routes (like '/:id'). This ensures the
 * right handler processes each request.
 */

/**
 * Future route additions
 * 
 * As the Favorites system evolves, these additional routes might be added:
 * 
 * GET /api/v1/favorites/by-city/:city
 * - Get favorites filtered by city for travel planning
 * 
 * GET /api/v1/favorites/by-category/:category
 * - Get favorites filtered by establishment category
 * 
 * POST /api/v1/favorites/reorder
 * - Allow users to manually order their favorites
 * 
 * POST /api/v1/favorites/:id/note
 * - Add personal notes to favorites (why saved, what to try)
 * 
 * These enhancements are explicitly deferred to post-MVP per the directive.
 * The current route set provides complete core functionality for bookmarking
 * establishments.
 */

export default router;

