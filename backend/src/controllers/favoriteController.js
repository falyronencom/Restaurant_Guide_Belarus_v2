/**
 * Favorite Controller
 * 
 * This controller handles HTTP requests and responses for the favorites system.
 * It provides a thin layer between HTTP and business logic, extracting data
 * from requests, calling service methods, and formatting responses.
 * 
 * Architecture note: Controllers should be thin orchestration layers. They parse
 * requests, delegate to services, and format responses. Business logic lives in
 * the service layer, not here. This keeps controllers focused on HTTP concerns
 * like status codes, headers, and response formatting.
 * 
 * All controllers follow the same pattern:
 * 1. Extract and validate request data
 * 2. Get user context from authenticated request (req.user)
 * 3. Call appropriate service functions
 * 4. Format and return HTTP response
 * 5. Let error middleware handle any exceptions
 */

import * as FavoriteService from '../services/favoriteService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Add an establishment to user's favorites
 * 
 * POST /api/v1/favorites
 * 
 * This endpoint allows authenticated users to bookmark establishments for later
 * viewing. The operation is idempotent - adding the same establishment multiple
 * times produces the same result without errors, which provides better UX for
 * scenarios like double-clicks or network retries.
 * 
 * Security note: The user_id comes from the authenticated context (JWT token),
 * never from the request body. This prevents users from adding favorites to
 * other users' collections by manipulating the request.
 * 
 * Request body requirements are enforced by validation middleware before this
 * controller executes. By the time we reach this code, we know establishment_id
 * is present and is a valid UUID format.
 */
export const addFavorite = asyncHandler(async (req, res) => {
  // Extract establishment ID from request body
  const { establishmentId } = req.body;

  // Get authenticated user ID from JWT token (set by authenticate middleware)
  // CRITICAL: Never trust user_id from request body - always use authenticated context
  const userId = req.user.userId;

  // Call service layer to add favorite with business logic
  const result = await FavoriteService.addToFavorites(userId, establishmentId);

  // Log successful favorite creation for monitoring
  logger.info('Favorite added via API', {
    userId,
    establishmentId: establishmentId,
    endpoint: 'POST /api/v1/favorites',
  });

  // Return 201 Created for new resource creation
  // Even though operation is idempotent, 201 is appropriate because we're
  // creating a favorite resource (or confirming its existence)
  res.status(201).json({
    success: true,
    data: result,
  });
});

/**
 * Remove an establishment from user's favorites
 * 
 * DELETE /api/v1/favorites/:establishmentId
 * 
 * This endpoint allows authenticated users to remove establishments from their
 * favorites collection. The operation is idempotent - removing a non-existent
 * favorite succeeds without error because the desired end state is achieved.
 * 
 * Authorization note: Users can only remove from their own favorites collection.
 * This is enforced through the authenticated user context, not request parameters,
 * preventing users from manipulating others' favorites.
 * 
 * HTTP semantics: We use 200 OK rather than 204 No Content because we return
 * a confirmation message in the response body. Some APIs prefer 204 for deletes,
 * but 200 with a body provides clearer feedback for API consumers.
 */
export const removeFavorite = asyncHandler(async (req, res) => {
  // Extract establishment ID from URL path parameter
  const { establishmentId } = req.params;

  // Get authenticated user ID from JWT token
  const userId = req.user.userId;

  // Call service layer to remove favorite
  const result = await FavoriteService.removeFromFavorites(userId, establishmentId);

  // Log successful favorite removal for monitoring
  logger.info('Favorite removed via API', {
    userId,
    establishmentId,
    endpoint: `DELETE /api/v1/favorites/${establishmentId}`,
  });

  // Return 200 OK with confirmation message
  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * Get all favorites for the authenticated user
 * 
 * GET /api/v1/favorites
 * 
 * This endpoint retrieves the user's complete favorites collection with
 * pagination support. The response includes establishment details enabling
 * display without additional API calls for each establishment.
 * 
 * Query parameters:
 * - page: Page number (default 1, must be positive integer)
 * - limit: Results per page (default 10, max 50)
 * 
 * The response includes pagination metadata (total count, page count, navigation
 * flags) that clients need to implement pagination UI with page numbers,
 * next/previous buttons, and result count displays.
 * 
 * Authorization note: Users can only view their own favorites. The user context
 * comes from the JWT token, not from URL parameters, ensuring users cannot
 * access others' favorites by manipulating the request.
 */
export const getUserFavorites = asyncHandler(async (req, res) => {
  // Get authenticated user ID from JWT token
  const userId = req.user.userId;

  // Extract query parameters with defaults and type conversion
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Cap at 50

  // Validate pagination parameters
  // Service layer will also validate, but doing it here provides earlier
  // feedback and prevents unnecessary service calls for obviously invalid input
  if (page < 1 || limit < 1) {
    return res.status(400).json({
      success: false,
      message: 'Page and limit must be positive integers',
      error: {
        code: 'INVALID_PAGINATION'
      },
    });
  }

  // Call service layer to fetch favorites with pagination
  const result = await FavoriteService.getUserFavorites(userId, {
    page,
    limit,
  });

  // Log successful favorites retrieval for monitoring
  logger.info('User favorites retrieved via API', {
    userId,
    page,
    limit,
    resultCount: result.favorites.length,
    endpoint: 'GET /api/v1/favorites',
  });

  // Return 200 OK with favorites and pagination metadata
  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * Check if a specific establishment is in user's favorites
 * 
 * GET /api/v1/favorites/check/:establishmentId
 * 
 * This endpoint provides a simple boolean check for whether a specific
 * establishment is in the user's favorites collection. This is useful for
 * displaying correct UI state (filled vs outline heart icons) in establishment
 * detail views or search results.
 * 
 * Performance note: This endpoint is very lightweight (single indexed query)
 * and can be called frequently without performance concerns. The database
 * index on (user_id, establishment_id) makes lookups extremely fast.
 * 
 * Alternative approach: The directive mentions this could be implemented by
 * including favorite status in establishment detail responses rather than
 * as a separate endpoint. We chose the dedicated endpoint approach for
 * cleaner separation of concerns. Favorites are independent of establishments.
 */
export const checkFavoriteStatus = asyncHandler(async (req, res) => {
  // Extract establishment ID from URL path parameter
  const { establishmentId } = req.params;

  // Get authenticated user ID from JWT token
  const userId = req.user.userId;

  // Call service layer to check favorite status
  const result = await FavoriteService.checkFavoriteStatus(userId, establishmentId);

  // Log for monitoring (debug level since this is a frequent, lightweight operation)
  logger.debug('Favorite status checked via API', {
    userId,
    establishmentId,
    isFavorite: result.is_favorite,
    endpoint: `GET /api/v1/favorites/check/${establishmentId}`,
  });

  // Return 200 OK with favorite status
  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * Batch check favorite status for multiple establishments
 * 
 * POST /api/v1/favorites/check-batch
 * 
 * This endpoint efficiently checks favorite status for multiple establishments
 * in a single request. It's designed for use cases like search results where
 * the frontend needs to display favorite status for many establishments at once.
 * 
 * Request body:
 * - establishment_ids: Array of establishment UUIDs (max 50)
 * 
 * Response format: Object mapping establishment IDs to boolean favorite status,
 * allowing easy lookup by the frontend without array searching.
 * 
 * Example response:
 * {
 *   "favorites": {
 *     "uuid-1": true,
 *     "uuid-2": false,
 *     "uuid-3": true
 *   }
 * }
 */
export const checkBatchFavoriteStatus = asyncHandler(async (req, res) => {
  // Extract establishment IDs array from request body
  const { establishment_ids } = req.body;

  // Get authenticated user ID from JWT token
  const userId = req.user.userId;

  // Basic validation (detailed validation happens in service layer)
  if (!Array.isArray(establishment_ids)) {
    return res.status(400).json({
      success: false,
      message: 'establishment_ids must be an array',
      error: {
        code: 'INVALID_INPUT'
      },
    });
  }

  // Call service layer to batch check favorite status
  const result = await FavoriteService.checkMultipleFavoriteStatus(userId, establishment_ids);

  // Log for monitoring
  logger.info('Batch favorite status checked via API', {
    userId,
    count: establishment_ids.length,
    endpoint: 'POST /api/v1/favorites/check-batch',
  });

  // Return 200 OK with favorite status mapping
  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * Get favorites statistics for the authenticated user
 * 
 * GET /api/v1/favorites/stats
 * 
 * This endpoint provides aggregate statistics about a user's favorites collection.
 * Currently returns basic count information, but could be expanded to include:
 * - Count by city (geographic distribution of favorites)
 * - Count by category (user's establishment type preferences)
 * - Average rating of favorited establishments
 * - Most recently added favorites
 * 
 * Optional feature: This endpoint is included for completeness but may not be
 * necessary for MVP. It can be deferred if implementation timeline is tight.
 * The basic functionality of add/remove/list favorites is sufficient for MVP.
 */
export const getFavoritesStats = asyncHandler(async (req, res) => {
  // Get authenticated user ID from JWT token
  const userId = req.user.userId;

  // Call service layer to get statistics
  const result = await FavoriteService.getUserFavoritesStats(userId);

  // Log for monitoring
  logger.debug('Favorites statistics retrieved via API', {
    userId,
    endpoint: 'GET /api/v1/favorites/stats',
  });

  // Return 200 OK with statistics
  res.status(200).json({
    success: true,
    data: result,
  });
});

