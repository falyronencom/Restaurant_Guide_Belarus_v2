/**
 * Search Service
 *
 * Handles geospatial search and discovery using PostGIS.
 * Implements radius-based and bounds-based search with filtering.
 */

import pool from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import * as MediaModel from '../models/mediaModel.js';
import * as EstablishmentModel from '../models/establishmentModel.js';
import * as PromotionModel from '../models/promotionModel.js';
import logger from '../utils/logger.js';
import {
  toPublicEstablishment,
  toPublicEstablishmentListing,
} from '../projections/establishmentProjections.js';

/**
 * Synonym map: common search terms → related categories and cuisines.
 * Enables "пицца" → find "Пиццерия" category + "Итальянская" cuisine, etc.
 * Keys are lowercase for case-insensitive matching.
 */
const SEARCH_SYNONYMS = {
  // Food → category + cuisine
  'пицца':    { categories: ['Пиццерия'], cuisines: ['Итальянская'] },
  'пиццу':    { categories: ['Пиццерия'], cuisines: ['Итальянская'] },
  'паста':    { categories: ['Ресторан'], cuisines: ['Итальянская'] },
  'суши':     { categories: [], cuisines: ['Японская', 'Азиатская'] },
  'ролл':     { categories: [], cuisines: ['Японская', 'Азиатская'] },
  'роллы':    { categories: [], cuisines: ['Японская', 'Азиатская'] },
  'бургер':   { categories: ['Фаст-фуд'], cuisines: ['Американская'] },
  'бургеры':  { categories: ['Фаст-фуд'], cuisines: ['Американская'] },
  'хинкали':  { categories: [], cuisines: ['Грузинская'] },
  'хачапури': { categories: [], cuisines: ['Грузинская'] },
  'шашлык':   { categories: [], cuisines: ['Грузинская'] },
  'лапша':    { categories: [], cuisines: ['Азиатская'] },
  'рамен':    { categories: [], cuisines: ['Японская', 'Азиатская'] },
  'вок':      { categories: [], cuisines: ['Азиатская'] },
  'стейк':    { categories: ['Ресторан'], cuisines: ['Американская', 'Европейская'] },
  'кофе':     { categories: ['Кофейня'], cuisines: [] },
  'торт':     { categories: ['Кондитерская'], cuisines: [] },
  'выпечка':  { categories: ['Пекарня', 'Кондитерская'], cuisines: [] },
  'пиво':     { categories: ['Бар', 'Паб'], cuisines: [] },
  'коктейль': { categories: ['Бар'], cuisines: [] },
  'кальян':   { categories: ['Кальянная'], cuisines: [] },
  'драники':  { categories: [], cuisines: ['Народная'] },
  'веган':    { categories: [], cuisines: ['Вегетарианская'] },
  'вегетарианское': { categories: [], cuisines: ['Вегетарианская'] },
};

/**
 * Helper: OR-parts for a free-text search — ILIKE on name/description/
 * categories/cuisines plus SEARCH_SYNONYMS expansion. Pushes its params and
 * returns the parts with the next param index. Shared by the AND-ed `search`
 * filter (addSearchConditions) and by the dish OR-alternative
 * (addDishCondition).
 *
 * @param {string} search - User search text
 * @param {Array} params - Existing params array (mutated)
 * @param {number} paramIndex - Current parameter index
 * @returns {{ orParts: string[], paramIndex: number }}
 */
function buildSearchOrParts(search, params, paramIndex) {
  const searchLower = search.toLowerCase();
  const likePattern = `%${search}%`;

  // Base ILIKE conditions: name, description, categories text, cuisines text
  const orParts = [
    `e.name ILIKE $${paramIndex}`,
    `e.description ILIKE $${paramIndex}`,
    `e.categories::text ILIKE $${paramIndex}`,
    `e.cuisines::text ILIKE $${paramIndex}`,
  ];
  params.push(likePattern);
  paramIndex++;

  // Check synonyms — expand search to related categories/cuisines
  const synonym = SEARCH_SYNONYMS[searchLower];
  if (synonym) {
    if (synonym.categories && synonym.categories.length > 0) {
      orParts.push(`e.categories && $${paramIndex}::varchar[]`);
      params.push(synonym.categories);
      paramIndex++;
    }
    if (synonym.cuisines && synonym.cuisines.length > 0) {
      orParts.push(`e.cuisines && $${paramIndex}::varchar[]`);
      params.push(synonym.cuisines);
      paramIndex++;
    }
  }

  return { orParts, paramIndex };
}

/**
 * Helper: Build search conditions for text query.
 * Combines ILIKE on name/description/categories/cuisines with synonym expansion.
 *
 * @param {string} search - User search text
 * @param {Array} conditions - Existing WHERE conditions array (mutated)
 * @param {Array} params - Existing params array (mutated)
 * @param {number} paramIndex - Current parameter index
 * @returns {number} Updated paramIndex
 */
function addSearchConditions(search, conditions, params, paramIndex) {
  const { orParts, paramIndex: nextIndex } = buildSearchOrParts(search, params, paramIndex);
  conditions.push(`(${orParts.join(' OR ')})`);
  return nextIndex;
}

/**
 * Helper: Segment B dish-level filter via menu_items — one implementation for
 * searchByRadius and searchWithoutLocation.
 *
 * EXISTS keeps establishments with at least one non-hidden menu item whose
 * name OR menu section (category_raw) contains `dish`. The section matters:
 * OCR'd menus name pizzas «Маргарита»/«Пепперони» under the section «Пицца»,
 * so item_name alone found nothing for the most common dish query (prod,
 * 07.09.2026). ILIKE folds Cyrillic case only under a non-C locale — verified
 * on pg-test (en_US.utf8) and on prod through the public search API
 * (`?search=СОРРЕНТО` finds «Сорренто»).
 *
 * When priceMaxByn is provided, either the regular price or an active,
 * in-time-window promotion's discount price must satisfy the budget.
 *
 * `dishOrSearch` (optional) widens the condition to «menu match OR
 * establishment-level free-text match» (ILIKE + SEARCH_SYNONYMS for that text,
 * see buildSearchOrParts). Smart search passes the dish term itself when no
 * budget was stated, so a pizzeria whose menu is not parsed yet still surfaces
 * for «пицца». Callers that need strictly menu-verified rows (a price ceiling,
 * the admin-hide flow) leave it out — `dish` alone stays strict.
 *
 * @param {{ dish: string, priceMaxByn: number|null, dishOrSearch: string|null }} dishFilter
 * @param {Array} conditions - Existing WHERE conditions array (mutated)
 * @param {Array} params - Existing params array (mutated)
 * @param {number} paramIndex - Current parameter index
 * @returns {number} Updated paramIndex
 */
function addDishCondition({ dish, priceMaxByn, dishOrSearch }, conditions, params, paramIndex) {
  const dishParam = paramIndex++;
  const priceParam = paramIndex++;
  params.push(dish);
  params.push(priceMaxByn);

  const menuMatch = `EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE mi.establishment_id = e.id
        AND mi.is_hidden_by_admin = FALSE
        AND (
          mi.item_name ILIKE '%' || $${dishParam} || '%'
          OR mi.category_raw ILIKE '%' || $${dishParam} || '%'
        )
        AND (
          $${priceParam}::numeric IS NULL
          OR mi.price_byn <= $${priceParam}::numeric
          OR EXISTS (
            SELECT 1 FROM promotions p
            WHERE p.menu_item_id = mi.id
              AND p.status = 'active'
              AND p.valid_from <= CURRENT_DATE
              AND (p.valid_until IS NULL OR p.valid_until >= CURRENT_DATE)
              AND (p.valid_from_time IS NULL OR CURRENT_TIME >= p.valid_from_time)
              AND (p.valid_until_time IS NULL OR CURRENT_TIME <= p.valid_until_time)
              AND p.discount_price_byn IS NOT NULL
              AND p.discount_price_byn <= $${priceParam}::numeric
          )
        )
    )`;

  if (dishOrSearch) {
    const alternative = buildSearchOrParts(dishOrSearch, params, paramIndex);
    paramIndex = alternative.paramIndex;
    conditions.push(`(${menuMatch} OR ${alternative.orParts.join(' OR ')})`);
  } else {
    conditions.push(menuMatch);
  }

  return paramIndex;
}

/**
 * Helper: SQL fragment that extracts close_time from working_hours JSONB.
 * Handles two data formats:
 *   - String: "10:00-22:00" → extracts "22:00"
 *   - Object: {"open":"10:00","close":"22:00"} → extracts "22:00"
 *   - Object without close (e.g. {"is_open":false}) → NULL
 *
 * Used inside jsonb_each() via LATERAL join.
 * Variable `val` refers to the JSONB value for each day.
 */
const CLOSE_TIME_SQL = `
  LATERAL (SELECT
    CASE jsonb_typeof(val)
      WHEN 'string' THEN
        CASE WHEN val #>> '{}' ~ '^[0-9]{1,2}:[0-9]{2}-[0-9]{1,2}:[0-9]{2}$'
          THEN SPLIT_PART(val #>> '{}', '-', 2)
          ELSE NULL END
      WHEN 'object' THEN
        CASE WHEN val->>'close' IS NOT NULL AND val->>'close' ~ '^[0-9]{1,2}:[0-9]{2}$'
          THEN val->>'close'
          ELSE NULL END
      ELSE NULL
    END AS close_time
  ) ct
`;

/**
 * Bayesian prior: number of "virtual" reviews at the prior rating.
 * Until an establishment accumulates this many real reviews, its
 * weighted rating is pulled toward BAYESIAN_PRIOR_RATING.
 * m=5: standard industry practice (IMDB, Amazon, Yelp).
 */
const BAYESIAN_PRIOR_COUNT = 5;

/**
 * Conservative prior rating. Not the platform average (~4.2),
 * but a deliberately lower constant that creates incentive to
 * collect reviews (each real review above 3.5 raises the weighted score).
 */
const BAYESIAN_PRIOR_RATING = 3.5;

/**
 * Helper: Build ORDER BY clause based on sort parameter
 *
 * Uses Bayesian weighted rating instead of raw average_rating:
 *   weighted = (review_count × average_rating + m × C) / (review_count + m)
 * This prevents 5.0★×1 from outranking 4.8★×200, while avoiding
 * the hard-wall problem of two-tier sorting (3.0★×4 > 5.0★×2).
 *
 * @param {string} sortBy - Sort option (rating, price_asc, price_desc, distance)
 * @param {boolean} hasDistance - Whether distance_km column is available
 * @returns {string} SQL ORDER BY clause
 */
function buildOrderByClause(sortBy, hasDistance = false) {
  // Convert price range to numeric for sorting — NULL/missing sorts last (ELSE 5)
  const priceToNum = `(CASE e.price_range
    WHEN '$' THEN 1
    WHEN '$$' THEN 2
    WHEN '$$$' THEN 3
    WHEN '$$$$' THEN 4
    ELSE 5
  END)`;

  // Bayesian weighted rating: plavnaya formula bez zhyostkikh porogov
  const weightedRating = `(e.review_count * e.average_rating + ${BAYESIAN_PRIOR_COUNT} * ${BAYESIAN_PRIOR_RATING}) / (e.review_count + ${BAYESIAN_PRIOR_COUNT})`;

  switch (sortBy) {
    case 'rating':
      if (hasDistance) {
        return `${weightedRating} DESC, e.review_count DESC, distance_km ASC, e.name ASC`;
      }
      return `${weightedRating} DESC, e.review_count DESC, e.base_score DESC, e.name ASC`;

    case 'price_asc':
      if (hasDistance) {
        return `${priceToNum} ASC, distance_km ASC, ${weightedRating} DESC, e.name ASC`;
      }
      return `${priceToNum} ASC, ${weightedRating} DESC, e.review_count DESC, e.name ASC`;

    case 'price_desc':
      if (hasDistance) {
        return `${priceToNum} DESC, distance_km ASC, ${weightedRating} DESC, e.name ASC`;
      }
      return `${priceToNum} DESC, ${weightedRating} DESC, e.review_count DESC, e.name ASC`;

    case 'distance':
      if (hasDistance) {
        return `distance_km ASC, e.base_score DESC, ${weightedRating} DESC, e.name ASC`;
      }
      // Fallback to rating if distance not available
      return `${weightedRating} DESC, e.review_count DESC, e.base_score DESC, e.name ASC`;

    default:
      // Default: rating-based (same as 'rating')
      if (hasDistance) {
        return `${weightedRating} DESC, e.review_count DESC, distance_km ASC, e.name ASC`;
      }
      return `${weightedRating} DESC, e.review_count DESC, e.base_score DESC, e.name ASC`;
  }
}

/**
 * Enrich an array of establishments with promotion flags.
 * Post-query enrichment: one batch query for all IDs, then attach has_promotion
 * and promotion_count to each result. Does NOT modify the search query or ORDER BY.
 *
 * @param {Object[]} establishments - Array of establishment objects (must have .id)
 * @returns {Promise<Object[]>} Same array with has_promotion and promotion_count added
 */
async function enrichWithPromotions(establishments) {
  if (!establishments || establishments.length === 0) return establishments;

  try {
    const ids = establishments.map(e => e.id);
    const promoMap = await PromotionModel.getActivePromotionsForEstablishments(ids);

    return establishments.map(e => ({
      ...e,
      has_promotion: promoMap.has(e.id),
      promotion_count: promoMap.has(e.id) ? promoMap.get(e.id).length : 0,
    }));
  } catch (error) {
    // Non-blocking: if promotion enrichment fails, return results without promotion data.
    // Search must never break due to promotion system issues.
    logger.warn('Promotion enrichment failed, returning results without promotion data', { error: error.message });
    return establishments.map(e => ({ ...e, has_promotion: false, promotion_count: 0 }));
  }
}

/**
 * Search establishments by radius
 *
 * @param {Object} params - Search parameters
 * @param {number} params.latitude - Center latitude
 * @param {number} params.longitude - Center longitude
 * @param {number} params.radius - Search radius in kilometers (default: 10)
 * @param {string} params.city - Filter by city name (e.g., 'Минск', 'Гродно')
 * @param {string[]} params.categories - Filter by categories
 * @param {string[]} params.cuisines - Filter by cuisines
 * @param {string} params.priceRange - Filter by price range ($, $$, $$$, $$$$)
 * @param {number} params.minRating - Minimum average rating (1-5)
 * @param {number} params.limit - Results per page (default: 20, max: 100)
 * @param {number} params.offset - Pagination offset (default: 0)
 * @param {string} params.sortBy - Sort order (distance, rating, price_asc, price_desc)
 * @param {string} params.search - Free text: ILIKE on name/description/categories/cuisines + SEARCH_SYNONYMS (AND-ed)
 * @param {string} params.dish - Dish/drink term matched against menu_items (item name OR menu section)
 * @param {number} params.priceMaxByn - Budget ceiling for the dish in BYN (regular or active promo price)
 * @param {string} params.dishOrSearch - Free text applied as an OR-alternative to the dish match (see addDishCondition)
 * @returns {Promise<Object>} Search results with establishments and pagination
 */
export async function searchByRadius({
  latitude,
  longitude,
  radius = 10,
  maxDistance = null,
  city = null,
  categories = null,
  cuisines = null,
  priceRange = null,
  minRating = null,
  limit = 20,
  offset = 0,
  page = 1,
  sortBy = 'rating',
  hoursFilter = null,
  features = null,
  search = null,
  dish = null,
  priceMaxByn = null,
  dishOrSearch = null,
}) {
  // Validate coordinates (use strict null check to allow 0 values)
  if (latitude == null || longitude == null) {
    throw new AppError('Latitude and longitude are required', 422, 'VALIDATION_ERROR');
  }

  if (latitude < -90 || latitude > 90) {
    throw new AppError('Latitude must be between -90 and 90', 422, 'VALIDATION_ERROR');
  }

  if (longitude < -180 || longitude > 180) {
    throw new AppError('Longitude must be between -180 and 180', 422, 'VALIDATION_ERROR');
  }

  // Validate radius
  if (radius <= 0 || radius > 1000) {
    throw new AppError('Radius must be between 0 and 1000 km', 422, 'VALIDATION_ERROR');
  }

  // Validate pagination
  if (limit < 1 || limit > 100) {
    throw new AppError('Limit must be between 1 and 100', 422, 'VALIDATION_ERROR');
  }

  if (offset < 0) {
    throw new AppError('Offset must be non-negative', 422, 'VALIDATION_ERROR');
  }

  // Build dynamic query
  const conditions = ['e.status = $1'];
  const params = ['active']; // Only search active establishments
  let paramIndex = 2;

  // Add city filter (supports single string or array — array used by public
  // catalog for Mogilev ё/е expansion, where two Cyrillic variants must match)
  if (city) {
    if (Array.isArray(city)) {
      conditions.push(`e.city = ANY($${paramIndex}::varchar[])`);
      params.push(city);
    } else {
      conditions.push(`e.city = $${paramIndex}`);
      params.push(city);
    }
    paramIndex++;
  }

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

  // Add price range filter (supports single value or array)
  if (priceRange) {
    if (Array.isArray(priceRange)) {
      conditions.push(`e.price_range = ANY($${paramIndex}::varchar[])`);
      params.push(priceRange);
    } else {
      conditions.push(`e.price_range = $${paramIndex}`);
      params.push(priceRange);
    }
    paramIndex++;
  }

  // Add rating filter
  if (minRating) {
    conditions.push(`e.average_rating >= $${paramIndex}`);
    params.push(minRating);
    paramIndex++;
  }

  // Add hours filter
  // working_hours is JSONB with two possible value formats per day:
  //   String: "10:00-22:00"
  //   Object: {"open": "10:00", "close": "22:00"} or {"is_open": false}
  // CLOSE_TIME_SQL handles extraction from both formats via LATERAL join.
  if (hoursFilter) {
    switch (hoursFilter) {
      case 'until_22':
        // Establishments that close by 22:00 on ALL days
        // Exclude if ANY day closes after 22:00 (including 22:01+) or after midnight (00:xx-06:xx)
        conditions.push(`
          NOT EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND (
              CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) > 22
              OR (
                CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) = 22
                AND CAST(SPLIT_PART(ct.close_time, ':', 2) AS INTEGER) > 0
              )
              OR CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
            )
          )
        `);
        break;
      case 'until_morning':
        // Late night establishments - at least one day closes after midnight (00:00-06:59)
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
          )
        `);
        break;
      case '24_hours':
        // 24-hour establishments
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE (
              ct.close_time IS NOT NULL
              AND ct.close_time IN ('23:59', '00:00')
              AND SPLIT_PART(
                CASE jsonb_typeof(val)
                  WHEN 'string' THEN val #>> '{}'
                  WHEN 'object' THEN val->>'open'
                  ELSE NULL
                END, ':', 1) IN ('0', '00') -- midnight open as 1- or 2-digit hour; string-match (not CAST) → safe on closed/malformed day values
            )
            OR (jsonb_typeof(val) = 'string' AND val #>> '{}' ILIKE '%24%')
          )
        `);
        break;
    }
  }

  // Add features filter (check attributes JSONB)
  if (features && features.length > 0) {
    features.forEach((feature) => {
      conditions.push(`(e.attributes->>$${paramIndex})::boolean = true`);
      params.push(feature);
      paramIndex++;
    });
  }

  // Add text search filter (ILIKE + synonyms)
  if (search) {
    paramIndex = addSearchConditions(search, conditions, params, paramIndex);
  }

  // Segment B: dish-level filter via menu_items (name OR section, optional
  // budget, optional OR-alternative) — see addDishCondition.
  if (dish) {
    paramIndex = addDishCondition({ dish, priceMaxByn, dishOrSearch }, conditions, params, paramIndex);
  }

  const whereClause = conditions.join(' AND ');

  // Determine if we should filter by distance:
  // - If maxDistance is explicitly provided (from max_distance param), always filter
  // - If no city specified, use default radius filtering
  // - If city specified without maxDistance, skip filtering (just sort by distance)
  const useRadiusFilter = maxDistance != null || !city;

  // Use maxDistance if provided, otherwise fall back to radius
  const effectiveRadius = maxDistance ?? radius;

  // Main query with PostGIS distance calculation
  let query;
  let countQuery;

  if (useRadiusFilter) {
    // Original behavior: filter by radius
    query = `
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
      ORDER BY ${buildOrderByClause(sortBy, true).replaceAll('e.', 'ne.')}
      LIMIT $${paramIndex + 3}
      OFFSET $${paramIndex + 4}
    `;
    params.push(longitude, latitude, effectiveRadius, limit, offset);

    countQuery = `
      SELECT COUNT(*) as total
      FROM establishments e
      WHERE ${whereClause}
        AND ST_Distance(
          ST_MakePoint($${paramIndex}, $${paramIndex + 1})::geography,
          ST_MakePoint(e.longitude, e.latitude)::geography
        ) / 1000.0 <= $${paramIndex + 2}
    `;
    // Note: countParams will use effectiveRadius from params array
  } else {
    // City specified: don't filter by radius, just sort by distance
    query = `
      SELECT
        e.*,
        ST_Distance(
          ST_MakePoint($${paramIndex}, $${paramIndex + 1})::geography,
          ST_MakePoint(e.longitude, e.latitude)::geography
        ) / 1000.0 AS distance_km,
        u.name AS partner_name,
        u.email AS partner_email
      FROM establishments e
      LEFT JOIN users u ON e.partner_id = u.id
      WHERE ${whereClause}
      ORDER BY ${buildOrderByClause(sortBy, true)}
      LIMIT $${paramIndex + 2}
      OFFSET $${paramIndex + 3}
    `;
    params.push(longitude, latitude, limit, offset);

    countQuery = `
      SELECT COUNT(*) as total
      FROM establishments e
      WHERE ${whereClause}
    `;
  }

  const result = await pool.query(query, params);

  // Count total results for pagination
  const countParams = useRadiusFilter ? params.slice(0, -2) : params.slice(0, -4);
  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].total);

  // Calculate page-based pagination metadata
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrevious = page > 1;

  // Transform results with type conversions and distance field
  const rawEstablishments = result.rows.map(row => ({
    ...row,
    distance_km: parseFloat(row.distance_km),
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    average_rating: row.average_rating ? parseFloat(row.average_rating) : null,
    review_count: parseInt(row.review_count) || 0,
  }));

  // Post-query enrichment: add promotion flags without touching ORDER BY
  const enriched = await enrichWithPromotions(rawEstablishments);

  // Public projection — excludes partner_email/subscription_*/base_score/
  // moderation_*/is_seed/claimed_* even from mobile responses. Mobile Dart
  // fromJson is tolerant of removed fields (those fields were not actively
  // used in public mobile models per verification grep).
  const establishments = enriched.map(toPublicEstablishmentListing);

  return {
    establishments,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext,
      hasPrevious,
    },
  };
}

/**
 * Search establishments without location (no distance calculation)
 * Used when user doesn't provide coordinates
 *
 * @param {Object} params - Search parameters
 * @param {string} params.city - Filter by city name (e.g., 'Минск', 'Гродно')
 * @param {string[]} params.categories - Filter by categories
 * @param {string[]} params.cuisines - Filter by cuisines
 * @param {string} params.priceRange - Filter by price range
 * @param {number} params.minRating - Minimum average rating
 * @param {number} params.limit - Results per page (default: 20, max: 100)
 * @param {number} params.offset - Pagination offset (default: 0)
 * @param {number} params.page - Page number for pagination metadata
 * @param {string} params.search - Free text: ILIKE on name/description/categories/cuisines + SEARCH_SYNONYMS (AND-ed)
 * @param {string} params.dish - Dish/drink term matched against menu_items (item name OR menu section)
 * @param {number} params.priceMaxByn - Budget ceiling for the dish in BYN (regular or active promo price)
 * @param {string} params.dishOrSearch - Free text applied as an OR-alternative to the dish match (see addDishCondition)
 * @returns {Promise<Object>} Search results sorted by rating
 */
export async function searchWithoutLocation({
  city = null,
  categories = null,
  cuisines = null,
  priceRange = null,
  minRating = null,
  limit = 20,
  offset = 0,
  page = 1,
  sortBy = 'rating',
  hoursFilter = null,
  features = null,
  search = null,
  dish = null,
  priceMaxByn = null,
  dishOrSearch = null,
}) {
  // Validate pagination. Max 500 to support /api/v1/public/establishments/map
  // (Brief 1 default 200, max 500). Mobile clients historically used max 100
  // and continue to do so in practice — the higher service cap is reachable
  // from /api/v1/search/establishments by any caller, capped by the global
  // 300/hr unauth rate limit. Monitor connection-pool pressure post-deploy;
  // if abuse appears, introduce a controller-level cap on /search/* or move
  // map endpoint to a dedicated model query.
  if (limit < 1 || limit > 500) {
    throw new AppError('Limit must be between 1 and 500', 422, 'VALIDATION_ERROR');
  }

  if (offset < 0) {
    throw new AppError('Offset must be non-negative', 422, 'VALIDATION_ERROR');
  }

  // Build dynamic query
  const conditions = ['e.status = $1'];
  const params = ['active'];
  let paramIndex = 2;

  // Add city filter (supports single string or array — see searchByRadius note)
  if (city) {
    if (Array.isArray(city)) {
      conditions.push(`e.city = ANY($${paramIndex}::varchar[])`);
      params.push(city);
    } else {
      conditions.push(`e.city = $${paramIndex}`);
      params.push(city);
    }
    paramIndex++;
  }

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

  // Add price range filter (supports single value or array)
  if (priceRange) {
    if (Array.isArray(priceRange)) {
      conditions.push(`e.price_range = ANY($${paramIndex}::varchar[])`);
      params.push(priceRange);
    } else {
      conditions.push(`e.price_range = $${paramIndex}`);
      params.push(priceRange);
    }
    paramIndex++;
  }

  // Add rating filter
  if (minRating) {
    conditions.push(`e.average_rating >= $${paramIndex}`);
    params.push(minRating);
    paramIndex++;
  }

  // Add hours filter (same dual-format logic as searchByRadius)
  if (hoursFilter) {
    switch (hoursFilter) {
      case 'until_22':
        // Establishments that close by 22:00 on ALL days
        conditions.push(`
          NOT EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND (
              CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) > 22
              OR (
                CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) = 22
                AND CAST(SPLIT_PART(ct.close_time, ':', 2) AS INTEGER) > 0
              )
              OR CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
            )
          )
        `);
        break;
      case 'until_morning':
        // Late night establishments - at least one day closes after midnight (00:00-06:59)
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
          )
        `);
        break;
      case '24_hours':
        // 24-hour establishments
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE (
              ct.close_time IS NOT NULL
              AND ct.close_time IN ('23:59', '00:00')
              AND SPLIT_PART(
                CASE jsonb_typeof(val)
                  WHEN 'string' THEN val #>> '{}'
                  WHEN 'object' THEN val->>'open'
                  ELSE NULL
                END, ':', 1) IN ('0', '00') -- midnight open as 1- or 2-digit hour; string-match (not CAST) → safe on closed/malformed day values
            )
            OR (jsonb_typeof(val) = 'string' AND val #>> '{}' ILIKE '%24%')
          )
        `);
        break;
    }
  }

  // Add features filter
  if (features && features.length > 0) {
    features.forEach((feature) => {
      conditions.push(`(e.attributes->>$${paramIndex})::boolean = true`);
      params.push(feature);
      paramIndex++;
    });
  }

  // Add text search filter (ILIKE + synonyms)
  if (search) {
    paramIndex = addSearchConditions(search, conditions, params, paramIndex);
  }

  // Segment B: dish-level filter via menu_items (name OR section, optional
  // budget, optional OR-alternative) — see addDishCondition.
  if (dish) {
    paramIndex = addDishCondition({ dish, priceMaxByn, dishOrSearch }, conditions, params, paramIndex);
  }

  const whereClause = conditions.join(' AND ');

  // Main query - sorted by rating (no distance)
  const query = `
    SELECT
      e.*,
      u.name AS partner_name,
      u.email AS partner_email
    FROM establishments e
    LEFT JOIN users u ON e.partner_id = u.id
    WHERE ${whereClause}
    ORDER BY ${buildOrderByClause(sortBy, false)}
    LIMIT $${paramIndex}
    OFFSET $${paramIndex + 1}
  `;

  params.push(limit, offset);

  const result = await pool.query(query, params);

  // Count total results for pagination
  const countQuery = `
    SELECT COUNT(*) as total
    FROM establishments e
    WHERE ${whereClause}
  `;

  const countParams = params.slice(0, -2); // Remove limit and offset
  const countResult = await pool.query(countQuery, countParams);
  const total = parseInt(countResult.rows[0].total);

  // Calculate page-based pagination metadata
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrevious = page > 1;

  // Transform results (no distance field)
  const rawEstablishments = result.rows.map(row => ({
    ...row,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    average_rating: row.average_rating ? parseFloat(row.average_rating) : null,
    review_count: parseInt(row.review_count) || 0,
  }));

  // Post-query enrichment: add promotion flags without touching ORDER BY
  const enriched = await enrichWithPromotions(rawEstablishments);

  // Public projection — same exclusion list as searchByRadius. No distance_km
  // because no coordinates were supplied; projection omits distance fields.
  const establishments = enriched.map(toPublicEstablishmentListing);

  return {
    establishments,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext,
      hasPrevious,
    },
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
  hoursFilter = null,
  limit = 100,
  search = null,
}) {
  // Validate bounds (use strict null check to allow 0 values)
  if (minLat == null || maxLat == null || minLon == null || maxLon == null) {
    throw new AppError('All bounds parameters are required (minLat, maxLat, minLon, maxLon)', 422, 'VALIDATION_ERROR');
  }

  if (minLat >= maxLat) {
    throw new AppError('minLat must be less than maxLat', 422, 'VALIDATION_ERROR');
  }

  if (minLon >= maxLon) {
    throw new AppError('minLon must be less than maxLon', 422, 'VALIDATION_ERROR');
  }

  // Validate limit
  if (limit < 1 || limit > 500) {
    throw new AppError('Limit must be between 1 and 500 for bounds search', 422, 'VALIDATION_ERROR');
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

  // Add price range filter (supports single value or array)
  if (priceRange) {
    if (Array.isArray(priceRange)) {
      conditions.push(`e.price_range = ANY($${paramIndex}::varchar[])`);
      params.push(priceRange);
    } else {
      conditions.push(`e.price_range = $${paramIndex}`);
      params.push(priceRange);
    }
    paramIndex++;
  }

  // Add rating filter
  if (minRating) {
    conditions.push(`e.average_rating >= $${paramIndex}`);
    params.push(minRating);
    paramIndex++;
  }

  // Add text search filter (ILIKE + synonyms)
  if (search) {
    paramIndex = addSearchConditions(search, conditions, params, paramIndex);
  }

  // Add hours filter (same logic as searchByRadius)
  // working_hours is JSONB with two possible value formats per day:
  //   String: "10:00-22:00"
  //   Object: {"open": "10:00", "close": "22:00"} or {"is_open": false}
  if (hoursFilter) {
    switch (hoursFilter) {
      case 'until_22':
        conditions.push(`
          NOT EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND (
              CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) > 22
              OR (
                CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) = 22
                AND CAST(SPLIT_PART(ct.close_time, ':', 2) AS INTEGER) > 0
              )
              OR CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
            )
          )
        `);
        break;
      case 'until_morning':
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE ct.close_time IS NOT NULL
            AND CAST(SPLIT_PART(ct.close_time, ':', 1) AS INTEGER) <= 6
          )
        `);
        break;
      case '24_hours':
        conditions.push(`
          EXISTS (
            SELECT 1 FROM jsonb_each(e.working_hours) AS hours(day, val),
            ${CLOSE_TIME_SQL}
            WHERE (
              ct.close_time IS NOT NULL
              AND ct.close_time IN ('23:59', '00:00')
              AND SPLIT_PART(
                CASE jsonb_typeof(val)
                  WHEN 'string' THEN val #>> '{}'
                  WHEN 'object' THEN val->>'open'
                  ELSE NULL
                END, ':', 1) IN ('0', '00') -- midnight open as 1- or 2-digit hour; string-match (not CAST) → safe on closed/malformed day values
            )
            OR (jsonb_typeof(val) = 'string' AND val #>> '{}' ILIKE '%24%')
          )
        `);
        break;
    }
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
    ORDER BY
      (e.review_count * e.average_rating + ${BAYESIAN_PRIOR_COUNT} * ${BAYESIAN_PRIOR_RATING}) / (e.review_count + ${BAYESIAN_PRIOR_COUNT}) DESC,
      e.review_count DESC,
      e.name ASC
    LIMIT $${paramIndex}
  `;

  params.push(limit);

  const result = await pool.query(query, params);

  // Convert latitude/longitude from strings to numbers for JSON serialization
  const rawEstablishments = result.rows.map(row => ({
    ...row,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
  }));

  // Post-query enrichment: add promotion flags without touching ORDER BY
  const enriched = await enrichWithPromotions(rawEstablishments);

  // Public projection — same exclusion list. Mobile /search/map preserves
  // the richer listing projection (not the minimum map marker shape used
  // for the new /api/v1/public/establishments/map endpoint) so existing
  // mobile map-view UI continues working without code changes.
  const establishments = enriched.map(toPublicEstablishmentListing);

  return {
    establishments,
    total: establishments.length,
  };
}

/**
 * Get establishment by ID (public endpoint)
 *
 * @param {string} id - Establishment UUID
 * @returns {Promise<Object>} Establishment details
 */
export async function getEstablishmentById(id) {
  if (!id) {
    throw new AppError('Establishment ID is required', 422, 'VALIDATION_ERROR');
  }

  const query = `
    SELECT
      e.*,
      u.name AS partner_name,
      u.email AS partner_email
    FROM establishments e
    LEFT JOIN users u ON e.partner_id = u.id
    WHERE e.id = $1 AND e.status = 'active'
  `;

  const result = await pool.query(query, [id]);

  if (result.rows.length === 0) {
    throw new AppError('Establishment not found', 404, 'NOT_FOUND');
  }

  const row = result.rows[0];

  // Track view (non-blocking, fire-and-forget). Defensive .catch so a future
  // refactor that removes the inner try/catch in incrementViewCount cannot
  // produce unhandled promise rejection here.
  EstablishmentModel.incrementViewCount(id).catch(() => {});

  // Load media and active promotions in parallel
  // Promotions fetch is non-blocking: if it fails, detail still returns without promotions
  const [media, promotions] = await Promise.all([
    MediaModel.getEstablishmentMedia(id),
    PromotionModel.getPromotionsByEstablishment(id, false).catch(err => {
      logger.warn('Failed to fetch promotions for detail endpoint', { id, error: err.message });
      return [];
    }),
  ]);

  // Public projection — excludes partner_email/subscription_*/base_score/
  // moderation_*/is_seed/claimed_* from the response shape. Media and
  // promotions are attached and preserved via the projection's media[]/
  // promotions[] handling.
  return toPublicEstablishment({
    ...row,
    media,
    promotions,
  });
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
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

// Named exports for testing
export { buildOrderByClause, BAYESIAN_PRIOR_COUNT, BAYESIAN_PRIOR_RATING };

export default {
  searchByRadius,
  searchByBounds,
  searchWithoutLocation,
  getEstablishmentById,
  checkSearchHealth,
};
