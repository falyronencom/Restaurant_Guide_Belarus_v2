/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: searchService.js
 *
 * Tests geospatial search logic in isolation using mocked database.
 * These tests verify:
 * - Coordinate validation
 * - Radius validation
 * - Query building with dynamic filters
 * - PostGIS integration
 * - Pagination
 */

import { jest } from '@jest/globals';

// Mock database
jest.unstable_mockModule('../../config/database.js', () => ({
  default: {
    query: jest.fn(),
  },
}));

// Import after mocking
const pool = (await import('../../config/database.js')).default;

const {
  searchByRadius,
  searchWithoutLocation,
  searchByBounds,
  checkSearchHealth,
} = await import('../../services/searchService.js');

import { createMockEstablishment } from '../mocks/helpers.js';

describe('searchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('searchByRadius', () => {
    const validParams = {
      latitude: 53.9,
      longitude: 27.5,
      radius: 10,
    };

    test('should search establishments with valid parameters', async () => {
      const mockEstablishments = [
        { ...createMockEstablishment(), distance_km: 1.5 },
        { ...createMockEstablishment(), distance_km: 3.2 },
      ];

      // Mock main query
      pool.query.mockResolvedValueOnce({
        rows: mockEstablishments,
        rowCount: 2,
      });

      // Mock count query
      pool.query.mockResolvedValueOnce({
        rows: [{ total: '2' }],
        rowCount: 1,
      });

      const result = await searchByRadius(validParams);

      expect(result.establishments.length).toBe(2);
      expect(result.establishments[0]).toMatchObject({
        distance_km: 1.5,
        distance: 1.5,
      });
      expect(result.establishments[1]).toMatchObject({
        distance_km: 3.2,
        distance: 3.2,
      });
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      });

      // Verify search + count queries were called (+ promotion enrichment queries)
      expect(pool.query).toHaveBeenCalled();
      expect(pool.query.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    test('should throw error for missing coordinates', async () => {
      await expect(
        searchByRadius({ latitude: 53.9, radius: 10 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      await expect(
        searchByRadius({ longitude: 27.5, radius: 10 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });

    test('should validate latitude range', async () => {
      // Too low
      await expect(
        searchByRadius({ ...validParams, latitude: -91 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Too high
      await expect(
        searchByRadius({ ...validParams, latitude: 91 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Valid extremes
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await expect(searchByRadius({ ...validParams, latitude: -90 })).resolves.toBeDefined();
      await expect(searchByRadius({ ...validParams, latitude: 90 })).resolves.toBeDefined();
    });

    test('should validate longitude range', async () => {
      // Too low
      await expect(
        searchByRadius({ ...validParams, longitude: -181 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Too high
      await expect(
        searchByRadius({ ...validParams, longitude: 181 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });

    test('should validate radius range', async () => {
      // Zero radius
      await expect(
        searchByRadius({ ...validParams, radius: 0 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Negative radius
      await expect(
        searchByRadius({ ...validParams, radius: -5 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Too large radius
      await expect(
        searchByRadius({ ...validParams, radius: 1001 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });

    test('should validate limit range', async () => {
      // Too small
      await expect(
        searchByRadius({ ...validParams, limit: 0 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      // Too large
      await expect(
        searchByRadius({ ...validParams, limit: 101 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });

    test('should validate offset range', async () => {
      await expect(
        searchByRadius({ ...validParams, offset: -1 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });

    test('should filter by categories', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius({
        ...validParams,
        categories: ['Ресторан', 'Кофейня'],
      });

      // Verify query includes category filter
      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.categories && ');

      const params = pool.query.mock.calls[0][1];
      expect(params).toContainEqual(['Ресторан', 'Кофейня']);
    });

    test('should filter by cuisines', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius({
        ...validParams,
        cuisines: ['Народная', 'Европейская'],
      });

      // Verify query includes cuisine filter
      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.cuisines && ');

      const params = pool.query.mock.calls[0][1];
      expect(params).toContainEqual(['Народная', 'Европейская']);
    });

    test('should filter by price range', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius({
        ...validParams,
        priceRange: '$$',
      });

      // Verify query includes price range filter
      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.price_range = ');

      const params = pool.query.mock.calls[0][1];
      expect(params).toContain('$$');
    });

    test('should filter by minimum rating', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius({
        ...validParams,
        minRating: 4.0,
      });

      // Verify query includes rating filter
      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.average_rating >= ');

      const params = pool.query.mock.calls[0][1];
      expect(params).toContain(4.0);
    });

    test('should combine multiple filters', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius({
        ...validParams,
        categories: ['Ресторан'],
        cuisines: ['Европейская'],
        priceRange: '$$$',
        minRating: 4.5,
      });

      const query = pool.query.mock.calls[0][0];
      const params = pool.query.mock.calls[0][1];

      // Verify all filters in query
      expect(query).toContain('e.categories && ');
      expect(query).toContain('e.cuisines && ');
      expect(query).toContain('e.price_range = ');
      expect(query).toContain('e.average_rating >= ');

      // Verify all filter params
      expect(params).toContainEqual(['Ресторан']);
      expect(params).toContainEqual(['Европейская']);
      expect(params).toContain('$$$');
      expect(params).toContain(4.5);
    });

    test('should handle pagination correctly', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '50' }], rowCount: 1 });

      const result = await searchByRadius({
        ...validParams,
        limit: 10,
        offset: 20,
      });

      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 50,
        totalPages: 5,
        hasNext: true,
        hasPrevious: false,
      });

      const params = pool.query.mock.calls[0][1];
      expect(params).toContain(10); // limit
      expect(params).toContain(20); // offset
    });

    test('should calculate hasNext/hasPrevious correctly', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '25' }], rowCount: 1 });

      // Last page (page=3)
      let result = await searchByRadius({
        ...validParams,
        limit: 10,
        offset: 20,
        page: 3,
      });
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrevious).toBe(true);

      // First page (page=1)
      result = await searchByRadius({
        ...validParams,
        limit: 10,
        offset: 0,
        page: 1,
      });
      expect(result.pagination.hasNext).toBe(true);
      expect(result.pagination.hasPrevious).toBe(false);
    });

    test('should include distance in results', async () => {
      const mockEstablishment = {
        ...createMockEstablishment(),
        distance_km: 2.5,
      };

      pool.query.mockResolvedValueOnce({ rows: [mockEstablishment], rowCount: 1 });
      pool.query.mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 });

      const result = await searchByRadius(validParams);

      expect(result.establishments[0]).toHaveProperty('distance_km');
      expect(result.establishments[0].distance_km).toBe(2.5);
    });

    test('should order results with Bayesian weighted rating', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius(validParams);

      const query = pool.query.mock.calls[0][0];
      // Default sort is 'rating' with hasDistance=true (searchByRadius)
      // Bayesian formula: (review_count * average_rating + 5 * 3.5) / (review_count + 5)
      expect(query).toContain('ne.review_count * ne.average_rating');
      expect(query).toContain('5 * 3.5');
      expect(query).toContain('ne.review_count DESC');
      expect(query).toContain('distance_km ASC');
      expect(query).toContain('ne.name ASC');
    });

    test('should only search active establishments', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius(validParams);

      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.status = $1');

      const params = pool.query.mock.calls[0][1];
      expect(params[0]).toBe('active');
    });
  });

  describe('dish filter via menu_items — category_raw + OR-alternative (prod defect 07.09.2026)', () => {
    const validParams = {
      latitude: 53.9,
      longitude: 27.5,
      radius: 10,
    };

    beforeEach(() => {
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });
    });

    test('searchByRadius: dish matches the menu section (category_raw), not only item_name', async () => {
      await searchByRadius({ ...validParams, dish: 'пицца' });

      const [query, params] = pool.query.mock.calls[0];
      expect(query).toContain("mi.item_name ILIKE '%' || $");
      expect(query).toContain("mi.category_raw ILIKE '%' || $");
      expect(params).toContain('пицца');
    });

    test('searchWithoutLocation: dish matches the menu section (category_raw), not only item_name', async () => {
      await searchWithoutLocation({ dish: 'пицца' });

      const [query, params] = pool.query.mock.calls[0];
      expect(query).toContain("mi.item_name ILIKE '%' || $");
      expect(query).toContain("mi.category_raw ILIKE '%' || $");
      expect(params).toContain('пицца');
    });

    test('dish alone stays strict: no establishment-level ILIKE, no synonym expansion', async () => {
      await searchWithoutLocation({ dish: 'пицца' });

      const [query, params] = pool.query.mock.calls[0];
      expect(query).not.toContain('e.name ILIKE');
      expect(params).not.toContainEqual(['Итальянская']);
    });

    test('dishOrSearch: menu match OR establishment ILIKE + SEARCH_SYNONYMS, glued to the EXISTS (not AND-ed), in main and count queries', async () => {
      await searchWithoutLocation({ dish: 'пицца', dishOrSearch: 'пицца' });

      const [query, params] = pool.query.mock.calls[0];
      const [countQuery, countParams] = pool.query.mock.calls[1];

      for (const q of [query, countQuery]) {
        const idx = q.indexOf('e.name ILIKE');
        expect(idx).toBeGreaterThan(-1);
        // Immediately before the establishment-level ILIKE must come the closing
        // paren of the EXISTS and an OR — the alternative widens, never narrows.
        expect(q.slice(0, idx).trimEnd()).toMatch(/\)\s*OR$/);
        expect(q).toContain('e.categories && $');
        expect(q).toContain('e.cuisines && $');
      }
      expect(params).toContain('пицца');
      expect(params).toContain('%пицца%');
      expect(params).toContainEqual(['Пиццерия']);
      expect(params).toContainEqual(['Итальянская']);
      // count query reuses the same WHERE params minus LIMIT/OFFSET
      expect(countParams).toEqual(params.slice(0, -2));
    });

    test('searchByRadius honours dishOrSearch the same way', async () => {
      await searchByRadius({ ...validParams, dish: 'пицца', dishOrSearch: 'пицца' });

      const [query, params] = pool.query.mock.calls[0];
      const idx = query.indexOf('e.name ILIKE');
      expect(idx).toBeGreaterThan(-1);
      expect(query.slice(0, idx).trimEnd()).toMatch(/\)\s*OR$/);
      expect(params).toContainEqual(['Итальянская']);
    });
  });

  describe('searchByBounds', () => {
    test('should search establishments within map bounds', async () => {
      const mockEstablishments = [createMockEstablishment()];

      pool.query.mockResolvedValue({
        rows: mockEstablishments,
        rowCount: 1,
      });

      const result = await searchByBounds({
        minLat: 53.85,
        maxLat: 53.95,
        minLon: 27.45,
        maxLon: 27.55,
      });

      // Each establishment is now passed through toPublicEstablishmentListing
      // (Brief 1 fix-in-place). Verify identity + public fields preserved; full
      // sensitivity exclusion is asserted in projections.test.js + search.test.js.
      expect(result.establishments.length).toBe(mockEstablishments.length);
      expect(result.establishments[0].id).toBe(mockEstablishments[0].id);
      expect(result.establishments[0].name).toBe(mockEstablishments[0].name);
      expect(result.establishments[0].city).toBe(mockEstablishments[0].city);
      expect(result.establishments[0].categories).toEqual(mockEstablishments[0].categories);
      expect(result.establishments[0]).toHaveProperty('has_promotion');
      expect(result.establishments[0]).toHaveProperty('promotion_count');

      // Verify query uses bounding box
      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('e.latitude BETWEEN');
      expect(query).toContain('e.longitude BETWEEN');

      const params = pool.query.mock.calls[0][1];
      expect(params).toContain(53.85); // minLat
      expect(params).toContain(53.95); // maxLat
      expect(params).toContain(27.45); // minLon
      expect(params).toContain(27.55); // maxLon
    });

    test('should validate bounds parameters', async () => {
      await expect(
        searchByBounds({ minLat: 53.9, maxLat: 53.8, minLon: 27.4, maxLon: 27.6 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });

      await expect(
        searchByBounds({ minLat: 53.8, maxLat: 53.9, minLon: 27.6, maxLon: 27.4 })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('checkSearchHealth', () => {
    test('should return healthy when PostGIS available', async () => {
      pool.query.mockResolvedValue({
        rows: [{ version: '3.1.1' }],
        rowCount: 1,
      });

      const result = await checkSearchHealth();

      expect(result.healthy).toBe(true);
      expect(result.postgis).toBe('3.1.1');

      expect(pool.query).toHaveBeenCalledWith(`
      SELECT PostGIS_version() as version
    `);
    });

    test('should return unhealthy when PostGIS not available', async () => {
      pool.query.mockRejectedValue(new Error('function postgis_version does not exist'));

      const result = await checkSearchHealth();

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
