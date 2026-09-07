/**
 * Search Controller
 *
 * Handles HTTP requests for establishment search and discovery.
 */

import * as searchService from '../services/searchService.js';
import { AppError } from '../middleware/errorHandler.js';
import { parseSearchFilterParams, presentFilters } from '../utils/searchFilterParams.js';

/**
 * Search establishments by radius (or without location)
 * GET /api/v1/search/establishments
 *
 * Query Parameters:
 * - latitude (optional): Center latitude - if provided with longitude, enables distance sorting
 * - longitude (optional): Center longitude - if provided with latitude, enables distance sorting
 * - radius (optional): Search radius in km (default: 10, max: 1000) - only used with coordinates
 * - categories (optional): Comma-separated categories
 * - cuisines (optional): Comma-separated cuisines
 * - priceRange (optional): Price range ($, $$, $$$, $$$$)
 * - minRating / min_rating (optional): Minimum rating (1-5) - both spellings accepted
 * - limit (optional): Results per page (default: 20, max: 100)
 * - offset (optional): Pagination offset (default: 0)
 *
 * Разбор фильтров (categories/cuisines/priceRange/minRating/max_distance/
 * radius/sort_by/hours_filter/features) вынесен в utils/searchFilterParams.js
 * и общий с POST /search/smart. / Filter parsing is shared with the smart
 * endpoint so one mobile screen gets the same filtering on both paths.
 */
export async function searchEstablishments(req, res, next) {
  try {
    const {
      latitude,
      longitude,
      city,
      limit,
      page,
      offset,
      search,
    } = req.query;

    // Parse coordinates (now optional)
    const lat = latitude ? parseFloat(latitude) : null;
    const lon = longitude ? parseFloat(longitude) : null;

    // Validate coordinates if provided
    const hasCoordinates = lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon);
    if ((latitude && !longitude) || (!latitude && longitude)) {
      throw new AppError('Both latitude and longitude must be provided together', 422, 'VALIDATION_ERROR');
    }

    // Фильтры выдачи разбирает общий парсер — те же правила, коды и тексты
    // ошибок, что у POST /search/smart. Отсутствующие ключи выброшены, чтобы
    // умолчания searchService остались в силе. / Filter dimensions share one
    // parser with the smart endpoint; absent keys are dropped so the
    // service's own parameter defaults still apply.
    const filters = presentFilters(parseSearchFilterParams(req.query));

    // Parse pagination (support both page and offset)
    const limitValue = limit ? parseInt(limit, 10) : 20;
    const pageValue = page ? parseInt(page, 10) : null;
    const offsetValue = offset ? parseInt(offset, 10) : null;

    // Calculate offset from page if page is provided
    let finalOffset = 0;
    let finalPage = 1;

    if (pageValue) {
      if (isNaN(pageValue) || pageValue < 1) {
        throw new AppError('Page must be a positive integer', 422, 'VALIDATION_ERROR');
      }
      finalPage = pageValue;
      finalOffset = (pageValue - 1) * limitValue;
    } else if (offsetValue !== null) {
      if (isNaN(offsetValue) || offsetValue < 0) {
        throw new AppError('Offset must be non-negative', 422, 'VALIDATION_ERROR');
      }
      finalOffset = offsetValue;
      finalPage = Math.floor(offsetValue / limitValue) + 1;
    }

    if (isNaN(limitValue) || limitValue < 1) {
      throw new AppError('Invalid limit parameter', 422, 'VALIDATION_ERROR');
    }

    // Execute search - with or without coordinates
    let result;
    if (hasCoordinates) {
      // Search with distance calculation
      result = await searchService.searchByRadius({
        latitude: lat,
        longitude: lon,
        ...filters,
        city,
        limit: limitValue,
        offset: finalOffset,
        page: finalPage,
        search: search?.trim() || null,
      });
    } else {
      // Search without coordinates - no distance filtering/sorting
      result = await searchService.searchWithoutLocation({
        ...filters,
        city,
        limit: limitValue,
        offset: finalOffset,
        page: finalPage,
        search: search?.trim() || null,
      });
    }

    res.status(200).json({
      success: true,
      data: result,
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
      neLat,  // Northeast latitude (alias for maxLat)
      neLon,  // Northeast longitude (alias for maxLon)
      swLat,  // Southwest latitude (alias for minLat)
      swLon,  // Southwest longitude (alias for minLon)
      categories,
      cuisines,
      priceRange,
      minRating,
      hours_filter,
      limit,
      search,
    } = req.query;

    // Parse bounds (support both ne/sw and min/max formats)
    const bounds = {
      minLat: parseFloat(swLat || minLat),
      maxLat: parseFloat(neLat || maxLat),
      minLon: parseFloat(swLon || minLon),
      maxLon: parseFloat(neLon || maxLon),
    };

    if (Object.values(bounds).some(isNaN)) {
      throw new AppError('Invalid bounds coordinates', 422, 'VALIDATION_ERROR');
    }

    // Parse filters (same as radius search)
    const categoryList = categories
      ? (Array.isArray(categories) ? categories : categories.split(',')).map(c => c.trim()).filter(Boolean)
      : null;

    const cuisineList = cuisines
      ? (Array.isArray(cuisines) ? cuisines : cuisines.split(',')).map(c => c.trim()).filter(Boolean)
      : null;

    // Parse priceRange (support multiple values: comma-separated or array)
    const priceRangeList = priceRange
      ? (Array.isArray(priceRange) ? priceRange : priceRange.split(',')).map(p => p.trim()).filter(Boolean)
      : null;

    const minRatingValue = minRating ? parseFloat(minRating) : null;
    if (minRatingValue && (isNaN(minRatingValue) || minRatingValue < 1 || minRatingValue > 5)) {
      throw new AppError('minRating must be between 1 and 5', 422, 'VALIDATION_ERROR');
    }

    const limitValue = limit ? parseInt(limit, 10) : 100;
    if (isNaN(limitValue)) {
      throw new AppError('Invalid limit parameter', 422, 'VALIDATION_ERROR');
    }

    // Validate hours filter
    const validHoursFilters = ['until_22', 'until_morning', '24_hours'];
    if (hours_filter && !validHoursFilters.includes(hours_filter)) {
      throw new AppError(`Invalid hours_filter. Must be one of: ${validHoursFilters.join(', ')}`, 422, 'VALIDATION_ERROR');
    }

    // Execute bounds search
    const result = await searchService.searchByBounds({
      ...bounds,
      categories: categoryList,
      cuisines: cuisineList,
      priceRange: priceRangeList,
      minRating: minRatingValue,
      hoursFilter: hours_filter,
      limit: limitValue,
      search: search?.trim() || null,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get establishment by ID (public)
 * GET /api/v1/search/establishments/:id
 *
 * Path Parameters:
 * - id (required): Establishment UUID
 */
export async function getEstablishmentById(req, res, next) {
  try {
    const { id } = req.params;

    const establishment = await searchService.getEstablishmentById(id);

    res.status(200).json({
      success: true,
      data: establishment,
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
      data: health,
    });
  } catch (error) {
    next(error);
  }
}

export default {
  searchEstablishments,
  searchMap,
  getEstablishmentById,
  searchHealth,
};
