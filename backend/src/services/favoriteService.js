/**
 * Favorite Service
 * 
 * This service implements all business logic for the favorites system.
 * It orchestrates database operations through the model layer, enforces
 * business rules, and handles error scenarios with appropriate messaging.
 * 
 * Architecture note: Services contain the "what" and "why" of application
 * behavior. They understand domain concepts and business rules but are
 * independent of HTTP concerns. Controllers call services, services call models.
 * 
 * The Favorites system is intentionally simple for MVP, focusing on core
 * functionality: add, remove, list, and check. More advanced features like
 * categories, notes, or sharing are deferred to post-MVP.
 */

import * as FavoriteModel from '../models/favoriteModel.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Add an establishment to user's favorites
 * 
 * This is the core business operation for creating a favorite bookmark.
 * The function implements the following workflow:
 * 
 * 1. Verify the establishment exists and is active
 * 2. Add the favorite (idempotent - no error if already exists)
 * 3. Return success confirmation
 * 
 * Idempotency is a key design principle here. If a user adds the same
 * establishment multiple times (e.g., due to double-clicks or network
 * retries), the operation succeeds without creating duplicates or returning
 * errors. This provides better UX than rejecting duplicate additions.
 * 
 * @param {string} userId - UUID of the user (from authenticated context)
 * @param {string} establishmentId - UUID of the establishment to favorite
 * @returns {Promise<Object>} Object with favorite details and success message
 * @throws {AppError} If establishment doesn't exist or is inactive
 */
export const addToFavorites = async (userId, establishmentId) => {
  // Verify establishment exists before creating favorite
  // This provides clear error message rather than relying on foreign key violation
  const exists = await FavoriteModel.establishmentExists(establishmentId);
  
  if (!exists) {
    logger.warn('Attempted to favorite non-existent or inactive establishment', {
      userId,
      establishmentId,
    });
    
    throw new AppError(
      'Establishment not found or is no longer active',
      404,
      'ESTABLISHMENT_NOT_FOUND'
    );
  }

  // Add favorite (idempotent operation)
  const favorite = await FavoriteModel.addFavorite(userId, establishmentId);

  logger.info('Favorite added successfully', {
    userId,
    establishmentId,
    favoriteId: favorite.id,
  });

  return {
    id: favorite.id,
    establishment_id: favorite.establishment_id,
    created_at: favorite.created_at,
    message: 'Establishment added to favorites',
  };
};

/**
 * Remove an establishment from user's favorites
 * 
 * This operation allows users to remove establishments from their favorites
 * collection. The function is idempotent - removing a non-existent favorite
 * succeeds without error because the desired end state is achieved regardless.
 * 
 * Idempotency rationale: If a user removes a favorite and the operation
 * completes on the server but the response is lost due to network issues,
 * the user might retry. We want the retry to succeed rather than returning
 * a "favorite not found" error, which would be confusing.
 * 
 * @param {string} userId - UUID of the user (from authenticated context)
 * @param {string} establishmentId - UUID of the establishment to unfavorite
 * @returns {Promise<Object>} Object with success message
 */
export const removeFromFavorites = async (userId, establishmentId) => {
  // Remove favorite (idempotent operation)
  const wasDeleted = await FavoriteModel.removeFavorite(userId, establishmentId);

  if (wasDeleted) {
    logger.info('Favorite removed successfully', {
      userId,
      establishmentId,
    });
  } else {
    logger.debug('Attempted to remove non-existent favorite (idempotent)', {
      userId,
      establishmentId,
    });
  }

  // Always return success because idempotent operation
  // The desired end state (favorite doesn't exist) is achieved
  return {
    message: 'Establishment removed from favorites',
  };
};

/**
 * Get all favorites for a specific user with pagination
 * 
 * This operation retrieves the user's complete favorites collection,
 * including establishment details to enable display without additional
 * API calls. The response includes pagination metadata following the
 * same pattern used in the Reviews system.
 * 
 * The favorites are sorted by most recently added first (created_at DESC).
 * This ordering serves users who remember their recent additions and want
 * to quickly find them. Alternative sort options like alphabetical or by
 * proximity could be added as enhancements.
 * 
 * Business consideration: Most users will have modest favorites collections
 * (10-50 establishments), but power users might accumulate hundreds over
 * time. Pagination ensures the API remains performant even for these users.
 * 
 * @param {string} userId - UUID of the user
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (1-indexed)
 * @param {number} options.limit - Results per page (default: 10, max: 50)
 * @returns {Promise<Object>} Object with favorites array and pagination metadata
 */
export const getUserFavorites = async (userId, options = {}) => {
  const {
    page = 1,
    limit = 10,
  } = options;

  // Validate pagination parameters
  if (page < 1) {
    throw new AppError('Page must be at least 1', 400, 'INVALID_PAGE');
  }

  if (limit < 1 || limit > 50) {
    throw new AppError('Limit must be between 1 and 50', 400, 'INVALID_LIMIT');
  }

  // Calculate offset for pagination
  const offset = (page - 1) * limit;

  // Fetch favorites and total count in parallel
  const [favorites, totalCount] = await Promise.all([
    FavoriteModel.getUserFavorites(userId, { limit, offset }),
    FavoriteModel.countUserFavorites(userId),
  ]);

  // Calculate pagination metadata
  const totalPages = Math.ceil(totalCount / limit);
  const hasNext = page < totalPages;
  const hasPrevious = page > 1;

  // Format response with establishment details
  const formattedFavorites = favorites.map((favorite) => ({
    id: favorite.id,
    establishment_id: favorite.establishment_id,
    created_at: favorite.created_at,
    establishment: {
      name: favorite.establishment_name,
      description: favorite.establishment_description,
      city: favorite.establishment_city,
      address: favorite.establishment_address,
      location: {
        latitude: parseFloat(favorite.establishment_latitude),
        longitude: parseFloat(favorite.establishment_longitude),
      },
      categories: favorite.establishment_categories,
      cuisines: favorite.establishment_cuisines,
      price_range: favorite.establishment_price_range,
      rating: {
        average: favorite.establishment_average_rating ? 
          parseFloat(favorite.establishment_average_rating) : null,
        count: favorite.establishment_review_count || 0,
      },
      is_active: favorite.establishment_status === 'active',
      primary_image: favorite.establishment_primary_image,
    },
  }));

  logger.info('Fetched user favorites', {
    userId,
    count: formattedFavorites.length,
    page,
    totalCount,
  });

  return {
    favorites: formattedFavorites,
    pagination: {
      page,
      limit,
      total: totalCount,
      pages: totalPages,
      hasNext,
      hasPrevious,
    },
  };
};

/**
 * Check if a specific establishment is in user's favorites
 * 
 * This utility function allows checking favorite status for individual
 * establishments. It's useful for:
 * 
 * 1. Showing correct UI state (filled vs outline heart icons)
 * 2. Determining favorite status in establishment detail views
 * 3. Bulk checking favorite status for search results
 * 
 * Performance note: This query is very fast due to the compound index on
 * (user_id, establishment_id). Even with millions of favorites, lookups
 * remain under a millisecond.
 * 
 * Architecture consideration: The directive mentions this could alternatively
 * be implemented by including favorite status in establishment responses.
 * We chose a dedicated endpoint for cleaner separation of concerns. The
 * favorites system is independent of establishments, and this approach keeps
 * the models decoupled.
 * 
 * @param {string} userId - UUID of the user
 * @param {string} establishmentId - UUID of the establishment to check
 * @returns {Promise<Object>} Object with boolean is_favorite field
 */
export const checkFavoriteStatus = async (userId, establishmentId) => {
  const isFavorite = await FavoriteModel.isFavorite(userId, establishmentId);

  logger.debug('Checked favorite status', {
    userId,
    establishmentId,
    isFavorite,
  });

  return {
    establishment_id: establishmentId,
    is_favorite: isFavorite,
  };
};

/**
 * Batch check favorite status for multiple establishments
 * 
 * This function efficiently checks favorite status for multiple establishments
 * in a single operation. It's designed for use cases like search results where
 * the frontend needs to display favorite status for 10-20 establishments at once.
 * 
 * Performance optimization: Rather than making N individual database queries,
 * this could be optimized with a single query using WHERE establishment_id IN (...).
 * For MVP, we accept the N+1 query pattern since typical batch sizes are small.
 * 
 * Future enhancement: If search results show 50+ establishments per page, consider
 * adding a batched database query or caching layer to improve performance.
 * 
 * @param {string} userId - UUID of the user
 * @param {Array<string>} establishmentIds - Array of establishment UUIDs to check
 * @returns {Promise<Object>} Object mapping establishment IDs to favorite status
 */
export const checkMultipleFavoriteStatus = async (userId, establishmentIds) => {
  // Validate input
  if (!Array.isArray(establishmentIds) || establishmentIds.length === 0) {
    throw new AppError('establishment_ids must be a non-empty array', 400, 'INVALID_INPUT');
  }

  // Limit batch size to prevent abuse
  if (establishmentIds.length > 50) {
    throw new AppError('Cannot check more than 50 establishments at once', 400, 'BATCH_TOO_LARGE');
  }

  // Check each establishment's favorite status
  const statusChecks = await Promise.all(
    establishmentIds.map(async (establishmentId) => {
      const isFavorite = await FavoriteModel.isFavorite(userId, establishmentId);
      return {
        establishment_id: establishmentId,
        is_favorite: isFavorite,
      };
    })
  );

  // Convert array to object mapping for easier frontend consumption
  const statusMap = statusChecks.reduce((acc, status) => {
    acc[status.establishment_id] = status.is_favorite;
    return acc;
  }, {});

  logger.debug('Batch checked favorite status', {
    userId,
    count: establishmentIds.length,
  });

  return {
    favorites: statusMap,
  };
};

/**
 * Get statistics about user's favorites
 * 
 * This utility function provides aggregate statistics about a user's favorites
 * collection. It can be used for profile pages or analytics.
 * 
 * Optional feature for MVP: This function is included for completeness but
 * may not be exposed as an API endpoint initially. It demonstrates how
 * aggregate statistics can be calculated for future analytics features.
 * 
 * @param {string} userId - UUID of the user
 * @returns {Promise<Object>} Object with various statistics
 */
export const getUserFavoritesStats = async (userId) => {
  const totalCount = await FavoriteModel.countUserFavorites(userId);

  // Future enhancements could include:
  // - Count by city (which cities user has most favorites in)
  // - Count by category (which types of establishments user prefers)
  // - Average rating of favorited establishments
  // - Most recently added favorite

  logger.debug('Fetched user favorites statistics', {
    userId,
    totalCount,
  });

  return {
    total_favorites: totalCount,
  };
};

