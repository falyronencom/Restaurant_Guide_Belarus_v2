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
  searchByBounds,
  checkSearchHealth,
} = await import('../../services/searchService.js');

import { createMockEstablishment } from '../mocks/helpers.js';
import { AppError } from '../../middleware/errorHandler.js';

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

      expect(result.establishments).toEqual(mockEstablishments);
      expect(result.pagination).toEqual({
        total: 2,
        limit: 20,
        offset: 0,
        hasMore: false,
      });

      // Verify query was called
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    test('should throw error for missing coordinates', async () => {
      await expect(
        searchByRadius({ latitude: 53.9, radius: 10 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'MISSING_COORDINATES',
      });

      await expect(
        searchByRadius({ longitude: 27.5, radius: 10 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'MISSING_COORDINATES',
      });
    });

    test('should validate latitude range', async () => {
      // Too low
      await expect(
        searchByRadius({ ...validParams, latitude: -91 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_LATITUDE',
      });

      // Too high
      await expect(
        searchByRadius({ ...validParams, latitude: 91 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_LATITUDE',
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
        statusCode: 400,
        code: 'INVALID_LONGITUDE',
      });

      // Too high
      await expect(
        searchByRadius({ ...validParams, longitude: 181 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_LONGITUDE',
      });
    });

    test('should validate radius range', async () => {
      // Zero radius
      await expect(
        searchByRadius({ ...validParams, radius: 0 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_RADIUS',
      });

      // Negative radius
      await expect(
        searchByRadius({ ...validParams, radius: -5 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_RADIUS',
      });

      // Too large radius
      await expect(
        searchByRadius({ ...validParams, radius: 1001 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_RADIUS',
      });
    });

    test('should validate limit range', async () => {
      // Too small
      await expect(
        searchByRadius({ ...validParams, limit: 0 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_LIMIT',
      });

      // Too large
      await expect(
        searchByRadius({ ...validParams, limit: 101 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_LIMIT',
      });
    });

    test('should validate offset range', async () => {
      await expect(
        searchByRadius({ ...validParams, offset: -1 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_OFFSET',
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
        total: 50,
        limit: 10,
        offset: 20,
        hasMore: true, // 20 + 10 < 50
      });

      const params = pool.query.mock.calls[0][1];
      expect(params).toContain(10); // limit
      expect(params).toContain(20); // offset
    });

    test('should calculate hasMore correctly', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '25' }], rowCount: 1 });

      // Last page
      let result = await searchByRadius({
        ...validParams,
        limit: 10,
        offset: 20,
      });
      expect(result.pagination.hasMore).toBe(false); // 20 + 10 >= 25

      // Has more pages
      result = await searchByRadius({
        ...validParams,
        limit: 10,
        offset: 10,
      });
      expect(result.pagination.hasMore).toBe(true); // 10 + 10 < 25
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

    test('should order results by distance, then rating, then review count', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValue({ rows: [{ total: '0' }], rowCount: 1 });

      await searchByRadius(validParams);

      const query = pool.query.mock.calls[0][0];
      expect(query).toContain('ORDER BY ne.distance_km ASC, ne.average_rating DESC, ne.review_count DESC');
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

      expect(result.establishments).toEqual(mockEstablishments);

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
        statusCode: 400,
        code: 'INVALID_BOUNDS',
      });

      await expect(
        searchByBounds({ minLat: 53.8, maxLat: 53.9, minLon: 27.6, maxLon: 27.4 })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_BOUNDS',
      });
    });
  });

  describe('checkSearchHealth', () => {
    test('should return healthy when PostGIS available', async () => {
      pool.query.mockResolvedValue({
        rows: [{ postgis_version: '3.1.1' }],
        rowCount: 1,
      });

      const result = await checkSearchHealth();

      expect(result.healthy).toBe(true);
      expect(result.postgis_version).toBe('3.1.1');

      expect(pool.query).toHaveBeenCalledWith('SELECT PostGIS_version() as postgis_version');
    });

    test('should return unhealthy when PostGIS not available', async () => {
      pool.query.mockRejectedValue(new Error('function postgis_version does not exist'));

      const result = await checkSearchHealth();

      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
