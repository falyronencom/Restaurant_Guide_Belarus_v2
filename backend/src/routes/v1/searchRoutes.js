/**
 * Search Routes
 *
 * Defines routes for establishment search and discovery.
 */

import express from 'express';
import * as searchController from '../../controllers/searchController.js';

const router = express.Router();

/**
 * GET /api/v1/search/health
 *
 * Health check for search system (PostGIS availability)
 * Public endpoint - no authentication required
 */
router.get('/health', searchController.searchHealth);

/**
 * GET /api/v1/search/establishments
 *
 * Search establishments by radius (list view)
 * Public endpoint - no authentication required
 *
 * Query Parameters:
 * - latitude (required): Center point latitude
 * - longitude (required): Center point longitude
 * - radius (optional): Search radius in km (default: 10, max: 1000)
 * - categories (optional): Comma-separated categories filter
 * - cuisines (optional): Comma-separated cuisines filter
 * - priceRange (optional): Price range filter ($, $$, $$$, $$$$)
 * - minRating (optional): Minimum average rating (1-5)
 * - limit (optional): Results per page (default: 20, max: 100)
 * - offset (optional): Pagination offset (default: 0)
 *
 * Response includes:
 * - establishments: Array of establishment objects with distance
 * - pagination: Total count and pagination metadata
 *
 * Results are ordered by distance (closest first), then by rating
 */
router.get('/establishments', searchController.searchEstablishments);

/**
 * GET /api/v1/search/map
 *
 * Search establishments within geographic bounds (map view)
 * Public endpoint - no authentication required
 *
 * Query Parameters:
 * - minLat (required): Southwest corner latitude
 * - maxLat (required): Northeast corner latitude
 * - minLon (required): Southwest corner longitude
 * - maxLon (required): Northeast corner longitude
 * - categories (optional): Comma-separated categories filter
 * - cuisines (optional): Comma-separated cuisines filter
 * - priceRange (optional): Price range filter ($, $$, $$$, $$$$)
 * - minRating (optional): Minimum average rating (1-5)
 * - limit (optional): Max results (default: 100, max: 500)
 *
 * Response includes:
 * - establishments: Array of establishment objects within bounds
 * - total: Total count of results
 *
 * Results are ordered by rating (highest first), then by review count
 */
router.get('/map', searchController.searchMap);

export default router;
