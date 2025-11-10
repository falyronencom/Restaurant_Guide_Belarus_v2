/**
 * Search Service
 *
 * Handles geospatial search and discovery using PostGIS.
 * Implements radius-based and bounds-based search with filtering.
 */

import pool from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Search establishments by radius
 *
 * @param {Object} params - Search parameters
 * @param {number} params.latitude - Center latitude
 * @param {number} params.longitude - Center longitude
 * @param {number} params.radius - Search radius in kilometers (default: 10)
 * @param {string[]} params.categories - Filter by categories
 * @param {string[]} params.cuisines - Filter by cuisines
 * @param {string} params.priceRange - Filter by price range ($, $$, $$$, $$$$)
 * @param {number} params.minRating - Minimum average rating (1-5)
 * @param {number} params.limit - Results per page (default: 20, max: 100)
 * @param {number} params.offset - Pagination offset (default: 0)
 * @returns {Promise<Object>} Search results with establishments and pagination
 */
export async function searchByRadius({
  latitude,
  longitude,
  radius = 10,
  categories = null,
  cuisines = null,
  priceRange = null,
  minRating = null,
  limit = 20,
  offset = 0
}) {
  // Validate coordinates
  if (!latitude || !longitude) {
    throw new AppError('Latitude and longitude are required', 400, 'MISSING_COORDINATES');
  }

  if (latitude < -90 || latitude > 90) {
    throw new AppError('Latitude must be between -90 and 90', 400, 'INVALID_LATITUDE');
  }

  if (longitude < -180 || longitude > 180) {
    throw new AppError('Longitude must be between -180 and 180', 400, 'INVALID_LONGITUDE');
  }

  // Validate radius
  if (radius <= 0 || radius > 1000) {
    throw new AppError('Radius must be between 0 and 1000 km', 400, 'INVALID_RADIUS');
  }

  // Validate pagination
  if (limit < 1 || limit > 100) {
    throw new AppError('Limit must be between 1 and 100', 400, 'INVALID_LIMIT');
  }

  if (offset < 0) {
    throw new AppError('Offset must be non-negative', 400, 'INVALID_OFFSET');
  }

  // Build dynamic query
  const conditions = ['e.status = $1'];
  const params = ['active']; // Only search active establishments
  let paramIndex = 2;

  // Add category filter
  if (categories && categories.length > 0) {
    conditions.push(`e.categories && $${paramIndex}::varchar[]`);
    params.push(categories);
    paramIndex++;
  }

  // Add cuisine filter
  if (cuisines && cuisines.length > 0) {
    conditions.push(`e.cuisines && $${paramIndex}::varchar[]`);
    params.push(cuisines);
    paramIndex++;
  }

  // Add price range filter
  if (priceRange) {
    conditions.push(`e.price_range = $${paramIndex}`);
    params.push(priceRange);
    paramIndex++;
  }

  // Add rating filter
  if (minRating) {
    conditions.push(`e.average_rating >= $${paramIndex}`);
    params.push(minRating);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  // Main query with PostGIS distance calculation
  const query = `
    WITH nearby_establishments AS (
      SELECT
        e.*,
        ST_Distance(
          ST_MakePoint($${paramIndex}, $${paramIndex + 1})::geography,
          ST_MakePoint(e.longitude, e.latitude)::geography
        ) / 1000.0 AS distance_km
      FROM establishments e
      WHERE ${whereClause}
    )
    SELECT
      ne.*,
      u.name AS partner_name,
      u.email AS partner_email
    FROM nearby_establishments ne
    LEFT JOIN users u ON ne.partner_id = u.id
    WHERE ne.distance_km <= $${paramIndex + 2}
    ORDER BY ne.distance_km ASC, ne.average_rating DESC, ne.review_count DESC
    LIMIT $${paramIndex + 3}
    OFFSET $${paramIndex + 4}
  `;

  params.push(longitude, latitude, radius, limit, offset);

  const result = await pool.query(query, params);

  // Count total results for pagination
  const countQuery = `
    SELECT COUNT(*) as total
    FROM establishments e
    WHERE ${whereClause}
      AND ST_Distance(
        ST_MakePoint($${paramIndex}, $${paramIndex + 1})::geography,
        ST_MakePoint(e.longitude, e.latitude)::geography
      ) / 1000.0 <= $${paramIndex + 2}
  `;

  const countParams = params.slice(0, -2); // Remove limit and offset
  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].total);

  return {
    establishments: result.rows,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total
    }
  };
}

/**
 * Search establishments within geographic bounds (for map view)
 *
 * @param {Object} params - Search parameters
 * @param {number} params.minLat - Minimum latitude (southwest corner)
 * @param {number} params.maxLat - Maximum latitude (northeast corner)
 * @param {number} params.minLon - Minimum longitude (southwest corner)
 * @param {number} params.maxLon - Maximum longitude (northeast corner)
 * @param {string[]} params.categories - Filter by categories
 * @param {string[]} params.cuisines - Filter by cuisines
 * @param {string} params.priceRange - Filter by price range
 * @param {number} params.minRating - Minimum average rating
 * @param {number} params.limit - Results limit (default: 100, max: 500 for map)
 * @returns {Promise<Object>} Establishments within bounds
 */
export async function searchByBounds({
  minLat,
  maxLat,
  minLon,
  maxLon,
  categories = null,
  cuisines = null,
  priceRange = null,
  minRating = null,
  limit = 100
}) {
  // Validate bounds
  if (!minLat || !maxLat || !minLon || !maxLon) {
    throw new AppError('All bounds parameters are required (minLat, maxLat, minLon, maxLon)', 400, 'MISSING_BOUNDS');
  }

  if (minLat >= maxLat) {
    throw new AppError('minLat must be less than maxLat', 400, 'INVALID_BOUNDS');
  }

  if (minLon >= maxLon) {
    throw new AppError('minLon must be less than maxLon', 400, 'INVALID_BOUNDS');
  }

  // Validate limit
  if (limit < 1 || limit > 500) {
    throw new AppError('Limit must be between 1 and 500 for bounds search', 400, 'INVALID_LIMIT');
  }

  // Build dynamic query
  const conditions = ['e.status = $1'];
  const params = ['active'];
  let paramIndex = 2;

  // Add geographic bounds filter
  conditions.push(`e.latitude BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
  conditions.push(`e.longitude BETWEEN $${paramIndex + 2} AND $${paramIndex + 3}`);
  params.push(minLat, maxLat, minLon, maxLon);
  paramIndex += 4;

  // Add category filter
  if (categories && categories.length > 0) {
    conditions.push(`e.categories && $${paramIndex}::varchar[]`);
    params.push(categories);
    paramIndex++;
  }

  // Add cuisine filter
  if (cuisines && cuisines.length > 0) {
    conditions.push(`e.cuisines && $${paramIndex}::varchar[]`);
    params.push(cuisines);
    paramIndex++;
  }

  // Add price range filter
  if (priceRange) {
    conditions.push(`e.price_range = $${paramIndex}`);
    params.push(priceRange);
    paramIndex++;
  }

  // Add rating filter
  if (minRating) {
    conditions.push(`e.average_rating >= $${paramIndex}`);
    params.push(minRating);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  const query = `
    SELECT
      e.*,
      u.name AS partner_name,
      u.email AS partner_email
    FROM establishments e
    LEFT JOIN users u ON e.partner_id = u.id
    WHERE ${whereClause}
    ORDER BY e.average_rating DESC, e.review_count DESC
    LIMIT $${paramIndex}
  `;

  params.push(limit);

  const result = await pool.query(query, params);

  return {
    establishments: result.rows,
    total: result.rows.length
  };
}

/**
 * Health check for search system
 *
 * @returns {Promise<Object>} Health status
 */
export async function checkSearchHealth() {
  try {
    // Test PostGIS is available
    const result = await pool.query(`
      SELECT PostGIS_version() as version
    `);

    return {
      healthy: true,
      postgis: result.rows[0].version,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

export default {
  searchByRadius,
  searchByBounds,
  checkSearchHealth
};
