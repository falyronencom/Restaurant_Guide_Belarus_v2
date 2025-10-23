/**
 * Favorite Model
 * 
 * This model provides database access methods for the favorites table.
 * It encapsulates all SQL queries related to user favorites and returns
 * plain JavaScript objects.
 * 
 * Architecture note: Models are thin data access layers that know about SQL
 * and database structure, but nothing about business rules. Business logic
 * lives in the service layer. This model follows the same patterns established
 * in reviewModel.js for consistency across the codebase.
 * 
 * The favorites table has a UNIQUE constraint on (user_id, establishment_id)
 * which ensures a user cannot favorite the same establishment multiple times.
 * This constraint is enforced at the database level for data integrity.
 */

import pool from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Add an establishment to user's favorites
 * 
 * This function implements idempotent behavior through PostgreSQL's
 * ON CONFLICT DO NOTHING clause. If the favorite already exists, the
 * query succeeds without error and returns the existing favorite. This
 * makes the API idempotent as specified in the directive.
 * 
 * @param {string} userId - UUID of the user adding the favorite
 * @param {string} establishmentId - UUID of the establishment being favorited
 * @returns {Promise<Object>} The created or existing favorite object
 * @throws {Error} If database operation fails (e.g., establishment doesn't exist)
 */
export const addFavorite = async (userId, establishmentId) => {
  const query = `
    INSERT INTO favorites (user_id, establishment_id, created_at)
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id, establishment_id) DO NOTHING
    RETURNING 
      id,
      user_id,
      establishment_id,
      created_at
  `;

  const values = [userId, establishmentId];

  try {
    const result = await pool.query(query, values);
    
    // If ON CONFLICT triggered, result.rows will be empty
    // In this case, we need to fetch the existing favorite
    if (result.rows.length === 0) {
      // Favorite already existed, fetch it
      logger.info('Favorite already exists, fetching existing record', {
        userId,
        establishmentId,
      });
      return await getFavorite(userId, establishmentId);
    }

    logger.info('Favorite added', {
      favoriteId: result.rows[0].id,
      userId,
      establishmentId,
    });
    
    return result.rows[0];
  } catch (error) {
    // Foreign key constraint violation means establishment doesn't exist
    if (error.code === '23503') {
      logger.warn('Attempted to favorite non-existent establishment', {
        userId,
        establishmentId,
        error: error.message,
      });
    } else {
      logger.error('Error adding favorite', {
        error: error.message,
        userId,
        establishmentId,
      });
    }
    throw error;
  }
};

/**
 * Get a specific favorite by user and establishment
 * 
 * This is a helper function used internally when addFavorite encounters
 * an existing favorite (ON CONFLICT scenario). It retrieves the existing
 * favorite record to return to the caller.
 * 
 * @param {string} userId - UUID of the user
 * @param {string} establishmentId - UUID of the establishment
 * @returns {Promise<Object|null>} The favorite object or null if not found
 */
const getFavorite = async (userId, establishmentId) => {
  const query = `
    SELECT 
      id,
      user_id,
      establishment_id,
      created_at
    FROM favorites
    WHERE user_id = $1 AND establishment_id = $2
  `;

  try {
    const result = await pool.query(query, [userId, establishmentId]);
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Error fetching favorite', {
      error: error.message,
      userId,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Remove an establishment from user's favorites
 * 
 * This function also implements idempotent behavior. If the favorite
 * doesn't exist, the DELETE succeeds without error. The function returns
 * true if a favorite was actually deleted, or false if nothing was deleted.
 * 
 * Architecture note: We use a hard delete rather than soft delete because
 * favorites are transient user preferences without audit requirements.
 * Users can freely add and remove favorites without needing history.
 * 
 * @param {string} userId - UUID of the user removing the favorite
 * @param {string} establishmentId - UUID of the establishment being unfavorited
 * @returns {Promise<boolean>} True if favorite was deleted, false if it didn't exist
 * @throws {Error} If database operation fails
 */
export const removeFavorite = async (userId, establishmentId) => {
  const query = `
    DELETE FROM favorites
    WHERE user_id = $1 AND establishment_id = $2
    RETURNING id
  `;

  const values = [userId, establishmentId];

  try {
    const result = await pool.query(query, values);
    
    const wasDeleted = result.rows.length > 0;
    
    if (wasDeleted) {
      logger.info('Favorite removed', {
        userId,
        establishmentId,
      });
    } else {
      logger.debug('Attempted to remove non-existent favorite', {
        userId,
        establishmentId,
      });
    }
    
    return wasDeleted;
  } catch (error) {
    logger.error('Error removing favorite', {
      error: error.message,
      userId,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Get all favorites for a specific user with pagination
 * 
 * This function performs a JOIN with the establishments table to include
 * establishment details in the response. This allows the API to return
 * complete information without requiring additional requests for each
 * establishment. This pattern matches the approach used in reviewModel.js
 * for retrieving reviews with author information.
 * 
 * The establishments data includes key information for displaying favorites:
 * - Basic info: name, description
 * - Location: city, address
 * - Categories and cuisines for filtering
 * - Aggregated rating data for display
 * - Primary media for thumbnails
 * 
 * @param {string} userId - UUID of the user
 * @param {Object} options - Query options
 * @param {number} options.limit - Maximum number of favorites to return (default: 10)
 * @param {number} options.offset - Number of favorites to skip for pagination (default: 0)
 * @returns {Promise<Array>} Array of favorite objects with establishment information
 */
export const getUserFavorites = async (userId, options = {}) => {
  const {
    limit = 10,
    offset = 0,
  } = options;

  const query = `
    SELECT 
      f.id,
      f.user_id,
      f.establishment_id,
      f.created_at,
      e.name as establishment_name,
      e.description as establishment_description,
      e.city as establishment_city,
      e.address as establishment_address,
      e.latitude as establishment_latitude,
      e.longitude as establishment_longitude,
      e.categories as establishment_categories,
      e.cuisine_type as establishment_cuisines,
      e.price_range as establishment_price_range,
      e.average_rating as establishment_average_rating,
      e.review_count as establishment_review_count,
      e.status as establishment_status,
      (
        SELECT url 
        FROM establishment_media 
        WHERE establishment_id = e.id 
          AND is_primary = true 
        LIMIT 1
      ) as establishment_primary_image
    FROM favorites f
    JOIN establishments e ON f.establishment_id = e.id
    WHERE f.user_id = $1
    ORDER BY f.created_at DESC
    LIMIT $2 OFFSET $3
  `;

  try {
    const result = await pool.query(query, [userId, limit, offset]);
    
    logger.debug('Fetched user favorites', {
      userId,
      count: result.rows.length,
      limit,
      offset,
    });
    
    return result.rows;
  } catch (error) {
    logger.error('Error fetching user favorites', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Count total favorites for a specific user
 * 
 * This is used for pagination metadata, allowing the API to tell clients
 * how many total favorites exist and how many pages are available.
 * 
 * @param {string} userId - UUID of the user
 * @returns {Promise<number>} Total count of user's favorites
 */
export const countUserFavorites = async (userId) => {
  const query = `
    SELECT COUNT(*) as count
    FROM favorites
    WHERE user_id = $1
  `;

  try {
    const result = await pool.query(query, [userId]);
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    logger.error('Error counting user favorites', {
      error: error.message,
      userId,
    });
    throw error;
  }
};

/**
 * Check if an establishment is in user's favorites
 * 
 * This function provides a simple boolean check for whether a specific
 * establishment is favorited by a user. This is used by the API to return
 * favorite status for establishments in search results or detail views.
 * 
 * Performance note: This query uses the compound index on (user_id, establishment_id)
 * defined in the database schema, making it very fast even with millions of favorites.
 * 
 * @param {string} userId - UUID of the user
 * @param {string} establishmentId - UUID of the establishment
 * @returns {Promise<boolean>} True if establishment is in user's favorites
 */
export const isFavorite = async (userId, establishmentId) => {
  const query = `
    SELECT EXISTS(
      SELECT 1 
      FROM favorites 
      WHERE user_id = $1 AND establishment_id = $2
    ) as is_favorite
  `;

  try {
    const result = await pool.query(query, [userId, establishmentId]);
    return result.rows[0].is_favorite;
  } catch (error) {
    logger.error('Error checking favorite status', {
      error: error.message,
      userId,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Verify that an establishment exists in the database
 * 
 * This validation function is used by the service layer before creating
 * favorites to ensure the establishment exists. This provides better error
 * messages than relying solely on foreign key constraint violations.
 * 
 * Architecture note: This duplicates a function from reviewModel.js, which
 * suggests it might be better placed in a shared establishmentModel.js in
 * the future. However, for MVP we keep models focused and accept some
 * duplication rather than premature abstraction.
 * 
 * @param {string} establishmentId - UUID of the establishment to verify
 * @returns {Promise<boolean>} True if establishment exists and is active
 */
export const establishmentExists = async (establishmentId) => {
  const query = `
    SELECT EXISTS(
      SELECT 1 
      FROM establishments 
      WHERE id = $1 AND status = 'active'
    ) as exists
  `;

  try {
    const result = await pool.query(query, [establishmentId]);
    return result.rows[0].exists;
  } catch (error) {
    logger.error('Error checking establishment existence', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

/**
 * Get favorite count for a specific establishment
 * 
 * This function returns how many users have favorited a particular establishment.
 * This metric can be used for analytics and popularity rankings.
 * 
 * Optional feature: This could be cached in the establishments table as
 * favorite_count for better performance, similar to how review_count is cached.
 * For MVP, a real-time query is sufficient.
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @returns {Promise<number>} Count of users who favorited this establishment
 */
export const getEstablishmentFavoriteCount = async (establishmentId) => {
  const query = `
    SELECT COUNT(*) as count
    FROM favorites
    WHERE establishment_id = $1
  `;

  try {
    const result = await pool.query(query, [establishmentId]);
    return parseInt(result.rows[0].count, 10);
  } catch (error) {
    logger.error('Error counting establishment favorites', {
      error: error.message,
      establishmentId,
    });
    throw error;
  }
};

