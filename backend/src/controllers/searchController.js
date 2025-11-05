/**
 * Search Controller
 *
 * Handles HTTP requests for establishment search and discovery.
 */

import * as searchService from '../services/searchService.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Search establishments by radius
 * GET /api/v1/search/establishments
 *
 * Query Parameters:
 * - latitude (required): Center latitude
 * - longitude (required): Center longitude
 * - radius (optional): Search radius in km (default: 10, max: 1000)
 * - categories (optional): Comma-separated categories
 * - cuisines (optional): Comma-separated cuisines
 * - priceRange (optional): Price range ($, $$, $$$, $$$$)
 * - minRating (optional): Minimum rating (1-5)
 * - limit (optional): Results per page (default: 20, max: 100)
 * - offset (optional): Pagination offset (default: 0)
 */
export async function searchEstablishments(req, res, next) {
  try {
    const {
      latitude,
      longitude,
      radius,
      categories,
      cuisines,
      priceRange,
      minRating,
      limit,
      offset
    } = req.query;

    // Parse coordinates
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lon)) {
      throw new AppError('Invalid latitude or longitude', 400, 'INVALID_COORDINATES');
    }

    // Parse radius (optional)
    const radiusKm = radius ? parseFloat(radius) : 10;
    if (isNaN(radiusKm)) {
      throw new AppError('Invalid radius', 400, 'INVALID_RADIUS');
    }

    // Parse categories (optional, comma-separated)
    const categoryList = categories
      ? categories.split(',').map(c => c.trim()).filter(Boolean)
      : null;

    // Parse cuisines (optional, comma-separated)
    const cuisineList = cuisines
      ? cuisines.split(',').map(c => c.trim()).filter(Boolean)
      : null;

    // Parse minRating (optional)
    const minRatingValue = minRating ? parseFloat(minRating) : null;
    if (minRatingValue && (isNaN(minRatingValue) || minRatingValue < 1 || minRatingValue > 5)) {
      throw new AppError('minRating must be between 1 and 5', 400, 'INVALID_RATING');
    }

    // Parse pagination (optional)
    const limitValue = limit ? parseInt(limit, 10) : 20;
    const offsetValue = offset ? parseInt(offset, 10) : 0;

    if (isNaN(limitValue) || isNaN(offsetValue)) {
      throw new AppError('Invalid pagination parameters', 400, 'INVALID_PAGINATION');
    }

    // Execute search
    const result = await searchService.searchByRadius({
      latitude: lat,
      longitude: lon,
      radius: radiusKm,
      categories: categoryList,
      cuisines: cuisineList,
      priceRange,
      minRating: minRatingValue,
      limit: limitValue,
      offset: offsetValue
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Search establishments within bounds (map view)
 * GET /api/v1/search/map
 *
 * Query Parameters:
 * - minLat (required): Minimum latitude (southwest)
 * - maxLat (required): Maximum latitude (northeast)
 * - minLon (required): Minimum longitude (southwest)
 * - maxLon (required): Maximum longitude (northeast)
 * - categories (optional): Comma-separated categories
 * - cuisines (optional): Comma-separated cuisines
 * - priceRange (optional): Price range ($, $$, $$$, $$$$)
 * - minRating (optional): Minimum rating (1-5)
 * - limit (optional): Results limit (default: 100, max: 500)
 */
export async function searchMap(req, res, next) {
  try {
    const {
      minLat,
      maxLat,
      minLon,
      maxLon,
      categories,
      cuisines,
      priceRange,
      minRating,
      limit
    } = req.query;

    // Parse bounds
    const bounds = {
      minLat: parseFloat(minLat),
      maxLat: parseFloat(maxLat),
      minLon: parseFloat(minLon),
      maxLon: parseFloat(maxLon)
    };

    if (Object.values(bounds).some(isNaN)) {
      throw new AppError('Invalid bounds coordinates', 400, 'INVALID_BOUNDS');
    }

    // Parse filters (same as radius search)
    const categoryList = categories
      ? categories.split(',').map(c => c.trim()).filter(Boolean)
      : null;

    const cuisineList = cuisines
      ? cuisines.split(',').map(c => c.trim()).filter(Boolean)
      : null;

    const minRatingValue = minRating ? parseFloat(minRating) : null;
    if (minRatingValue && (isNaN(minRatingValue) || minRatingValue < 1 || minRatingValue > 5)) {
      throw new AppError('minRating must be between 1 and 5', 400, 'INVALID_RATING');
    }

    const limitValue = limit ? parseInt(limit, 10) : 100;
    if (isNaN(limitValue)) {
      throw new AppError('Invalid limit parameter', 400, 'INVALID_LIMIT');
    }

    // Execute bounds search
    const result = await searchService.searchByBounds({
      ...bounds,
      categories: categoryList,
      cuisines: cuisineList,
      priceRange,
      minRating: minRatingValue,
      limit: limitValue
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Search system health check
 * GET /api/v1/search/health
 */
export async function searchHealth(req, res, next) {
  try {
    const health = await searchService.checkSearchHealth();

    const statusCode = health.healthy ? 200 : 503;

    res.status(statusCode).json({
      success: health.healthy,
      data: health
    });
  } catch (error) {
    next(error);
  }
}

export default {
  searchEstablishments,
  searchMap,
  searchHealth
};
