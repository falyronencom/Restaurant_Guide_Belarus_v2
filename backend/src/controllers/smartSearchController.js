/**
 * Smart Search Controller
 *
 * Handles POST /api/v1/search/smart requests.
 * Validates input, delegates to smartSearchService, returns results.
 */

import * as smartSearchService from '../services/smartSearchService.js';
import logger from '../utils/logger.js';
import { parseSearchFilterParams, presentFilters } from '../utils/searchFilterParams.js';

/** Maximum query length */
const MAX_QUERY_LENGTH = 150;

/**
 * Sanitize user query: trim, collapse whitespace, remove control characters.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeQuery(raw) {
  return raw
    .trim()
    // eslint-disable-next-line no-control-regex -- намеренная санитизация пользовательского ввода
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')             // collapse whitespace
    .slice(0, MAX_QUERY_LENGTH);
}

/**
 * POST /api/v1/search/smart
 *
 * Body: {
 *   query: string, latitude?: number, longitude?: number, city?: string,
 *   limit?: number, page?: number,
 *   categories?: string[]|string, cuisines?: string[]|string,
 *   priceRange?: string[]|string, minRating?: number, min_rating?: number,
 *   max_distance?: number (метры / meters), radius?: number (км / km),
 *   sort_by?: string, hours_filter?: string, features?: string[]|string
 * }
 *
 * Фильтры экрана. Строка поиска на mobile всегда ходит сюда, а фильтры экрана
 * (цена, часы, удобства, сортировка, расстояние, категории, кухни) обязаны
 * работать в обоих режимах — поэтому тело принимает ровно те же имена, что
 * классический GET читает из query-строки, и разбирает их тем же парсером
 * (utils/searchFilterParams.js). Отсюда и коды: ошибки ТЕЛА (query, широта,
 * долгота) — 400, как было; ошибки ФИЛЬТРОВ — 422, как у классики, потому что
 * их бросает общий парсер. / The screen's filters must work whether or not the
 * text field is empty, so the body accepts the same names the classic endpoint
 * reads from the query string, through the same parser. Body errors stay 400;
 * filter errors are 422, exactly as on the classic path.
 *
 * Фильтры НЕ входят в ключ кэша: кэшируется разбор фразы (intent), а не
 * выдача. Переключение фильтров и подгрузка страниц с той же фразой — попадание
 * в кэш, один SQL, без обращения к AI. / Filters are deliberately outside the
 * cache key: what is cached is the parsed intent, not the result set.
 */
export async function smartSearch(req, res, next) {
  try {
    const { query, latitude, longitude, city, limit, page } = req.body;

    // --- Validation ---
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'query is required and must be a non-empty string',
        },
      });
    }

    const sanitized = sanitizeQuery(query);

    if (sanitized.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'query is empty after sanitization',
        },
      });
    }

    // Validate optional coordinates
    const lat = latitude != null ? parseFloat(latitude) : undefined;
    const lon = longitude != null ? parseFloat(longitude) : undefined;

    if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'latitude must be between -90 and 90',
        },
      });
    }

    if (lon !== undefined && (isNaN(lon) || lon < -180 || lon > 180)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'longitude must be between -180 and 180',
        },
      });
    }

    // Validate pagination
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);

    // Явные фильтры экрана — после проверок тела, чтобы 400 сохранил
    // приоритет над 422 парсера. / Parsed after the body checks so a bad
    // query or coordinate still answers 400 rather than the parser's 422.
    const explicitFilters = presentFilters(parseSearchFilterParams(req.body));

    // --- Execute ---
    const context = {};
    if (lat !== undefined && lon !== undefined) {
      context.latitude = lat;
      context.longitude = lon;
    }
    if (city && typeof city === 'string') {
      context.city = city.trim();
    }

    const result = await smartSearchService.executeSmartSearch(
      sanitized,
      context,
      { limit: parsedLimit, page: parsedPage },
      explicitFilters,
    );

    return res.status(200).json({
      success: true,
      data: {
        intent: result.intent,
        establishments: result.results,
        pagination: result.pagination,
        fallback: result.fallback,
      },
    });
  } catch (error) {
    // Never log req.body here: it carries the user's free-text query and
    // exact lat/long (PII). errorHandler re-logs curated request context.
    logger.error('Smart search controller error', {
      error: error.message,
    });
    next(error);
  }
}
