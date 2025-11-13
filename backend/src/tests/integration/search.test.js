/**
 * Search & Discovery System Integration Tests
 *
 * Tests PostGIS geospatial queries and search functionality:
 * - Radius-based search (1km, 5km, 10km, 50km)
 * - Bounds-based search (map view)
 * - Distance calculations (haversine formula via PostGIS)
 * - Filtering (categories, cuisines, price range, rating)
 * - Combined filters (category + cuisine + distance + rating)
 * - Intelligent ranking (distance + rating + review_count + boost_score)
 * - Pagination
 * - Belarus coordinates validation
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import { testEstablishments } from '../fixtures/establishments.js';
import { belarusCities, invalidCoordinates } from '../fixtures/coordinates.js';

let partnerToken;
let partnerId;

// Default working hours for test establishments
const defaultWorkingHours = JSON.stringify({
  monday: { open: '10:00', close: '22:00' },
  tuesday: { open: '10:00', close: '22:00' },
  wednesday: { open: '10:00', close: '22:00' },
  thursday: { open: '10:00', close: '22:00' },
  friday: { open: '10:00', close: '23:00' },
  saturday: { open: '11:00', close: '23:00' },
  sunday: { open: '11:00', close: '22:00' }
});

beforeAll(async () => {
  const partner = await createUserAndGetTokens(testUsers.partner);
  partnerToken = partner.accessToken;
  partnerId = partner.user.id;
});

beforeEach(async () => {
  await clearAllData();
  // Create partner for establishments
  await query(
    'INSERT INTO users (id, email, password_hash, name, role, auth_method) VALUES ($1, $2, $3, $4, $5, $6)',
    [partnerId, 'partner@test.com', 'hash', 'Partner', 'partner', 'email']
  );
});

afterAll(async () => {
  await clearAllData();
});

describe('Search System - Radius-Based Search', () => {
  beforeEach(async () => {
    // Seed establishments at known distances from Minsk center (53.9, 27.5)

    // Establishment 1: At Minsk center (0km)
    await query(`
      INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Центр Минска', 'В центре', 'Минск', 'Центр', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);

    // Establishment 2: 3km from center
    await query(`
      INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Близко', 'Рядом', 'Минск', 'Рядом', 53.92, 27.48, ARRAY['Кофейня'], ARRAY['Европейская'], 'active', $2::jsonb, '$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);

    // Establishment 3: 300km away (Gomel)
    await query(`
      INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Далеко', 'Гомель', 'Гомель', 'Далеко', 52.4, 31.0, ARRAY['Ресторан'], ARRAY['Народная'], 'active', $2::jsonb, '$$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);
  });

  test('should find establishments within 1km radius', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 1
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(1);
    expect(response.body.data.establishments[0].name).toBe('Центр Минска');
  });

  test('should find establishments within 5km radius', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 5
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(2);
    const names = response.body.data.establishments.map(e => e.name);
    expect(names).toContain('Центр Минска');
    expect(names).toContain('Близко');
  });

  test('should find establishments within 500km radius', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 500
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(3);
  });

  test('should return empty array for search with no results', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 90.0, // North Pole
        longitude: 0.0,
        radius: 10
      })
      .expect(200);

    expect(response.body.data.establishments).toEqual([]);
  });

  test('should include distance in response', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10
      })
      .expect(200);

    response.body.data.establishments.forEach(establishment => {
      expect(establishment.distance).toBeDefined();
      expect(typeof establishment.distance).toBe('number');
      expect(establishment.distance).toBeGreaterThanOrEqual(0);
    });
  });

  test('should order results by distance (closest first)', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 500
      })
      .expect(200);

    const distances = response.body.data.establishments.map(e => e.distance);

    // Check if sorted ascending
    for (let i = 0; i < distances.length - 1; i++) {
      expect(distances[i]).toBeLessThanOrEqual(distances[i + 1]);
    }
  });
});

describe('Search System - Filtering', () => {
  beforeEach(async () => {
    // Create diverse establishments for filtering tests
    const establishments = [
      { name: 'Ресторан 1', categories: ['Ресторан'], cuisines: ['Европейская'], price: '$$' },
      { name: 'Кофейня 1', categories: ['Кофейня'], cuisines: ['Европейская'], price: '$' },
      { name: 'Бар 1', categories: ['Бар'], cuisines: ['Американская'], price: '$$$' },
      { name: 'Ресторан Итальянский', categories: ['Ресторан'], cuisines: ['Итальянская'], price: '$$$$' },
      { name: 'Ресторан Японский', categories: ['Ресторан'], cuisines: ['Японская'], price: '$$$' }
    ];

    for (const est of establishments) {
      await query(`
        INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, price_range, status, working_hours, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, 'Test', 'Минск', 'Test', 53.9, 27.5, $3, $4, $5, 'active', $6::jsonb, NOW(), NOW())
      `, [partnerId, est.name, est.categories, est.cuisines, est.price, defaultWorkingHours]);
    }
  });

  test('should filter by single category', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        categories: 'Ресторан'
      })
      .expect(200);

    expect(response.body.data.establishments.length).toBe(3);
    response.body.data.establishments.forEach(est => {
      expect(est.categories).toContain('Ресторан');
    });
  });

  test('should filter by multiple categories', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        categories: ['Ресторан', 'Кофейня']
      })
      .expect(200);

    expect(response.body.data.establishments.length).toBe(4);
  });

  test('should filter by single cuisine', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        cuisines: 'Итальянская'
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(1);
    expect(response.body.data.establishments[0].name).toBe('Ресторан Итальянский');
  });

  test('should filter by price range', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        priceRange: '$$$'
      })
      .expect(200);

    expect(response.body.data.establishments.length).toBe(2);
    response.body.data.establishments.forEach(est => {
      expect(est.price_range).toBe('$$$');
    });
  });

  test('should combine multiple filters', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        categories: 'Ресторан',
        cuisines: 'Европейская',
        priceRange: '$$'
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(1);
    expect(response.body.data.establishments[0].name).toBe('Ресторан 1');
  });

  test('should return empty for filter with no matches', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        cuisines: 'Мексиканская' // Not in test data
      })
      .expect(200);

    expect(response.body.data.establishments).toEqual([]);
  });
});

describe('Search System - Pagination', () => {
  beforeEach(async () => {
    // Create 25 establishments for pagination testing
    for (let i = 1; i <= 25; i++) {
      await query(`
        INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $3::jsonb, '$$', NOW(), NOW())
      `, [partnerId, `Establishment ${i}`, defaultWorkingHours]);
    }
  });

  test('should paginate results (page 1)', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        page: 1,
        limit: 10
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(10);
    expect(response.body.data.pagination).toMatchObject({
      page: 1,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNext: true,
      hasPrevious: false
    });
  });

  test('should paginate results (page 2)', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        page: 2,
        limit: 10
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(10);
    expect(response.body.data.pagination).toMatchObject({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNext: true,
      hasPrevious: true
    });
  });

  test('should handle last page correctly', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        page: 3,
        limit: 10
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(5); // Last 5 items
    expect(response.body.data.pagination).toMatchObject({
      page: 3,
      hasNext: false,
      hasPrevious: true
    });
  });
});

describe('Search System - Bounds-Based Search (Map View)', () => {
  test('should search within geographic bounds', async () => {
    // Create establishment in Minsk
    await query(`
      INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Minsk Center', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);

    const response = await request(app)
      .get('/api/v1/search/map')
      .query({
        neLat: 53.95,
        neLon: 27.6,
        swLat: 53.85,
        swLon: 27.4
      })
      .expect(200);

    expect(response.body.data.establishments).toHaveLength(1);
    expect(response.body.data.establishments[0].name).toBe('Minsk Center');
  });

  test('should exclude establishments outside bounds', async () => {
    await query(`
      INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Outside Bounds', 'Test', 'Гомель', 'Test', 52.4, 31.0, ARRAY['Ресторан'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NOW(), NOW())
    `, [partnerId, defaultWorkingHours]);

    const response = await request(app)
      .get('/api/v1/search/map')
      .query({
        neLat: 53.95,
        neLon: 27.6,
        swLat: 53.85,
        swLon: 27.4
      })
      .expect(200);

    expect(response.body.data.establishments).toEqual([]);
  });
});

describe('Search System - Validation', () => {
  test('should reject missing latitude', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        longitude: 27.5,
        radius: 5
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject invalid radius (negative)', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 53.9,
        longitude: 27.5,
        radius: -5
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject invalid coordinates (out of range)', async () => {
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({
        latitude: 200, // Invalid
        longitude: 27.5,
        radius: 5
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// Advanced ranking and performance tests
describe('Search System - Intelligent Ranking', () => {
  test.todo('should rank by combined distance + rating + review_count');
  test.todo('should prioritize establishments with boost_score');
  test.todo('should handle establishments with no reviews (NULL rating)');
});

describe('Search System - Performance', () => {
  test.todo('should perform well with 1000+ establishments');
  test.todo('should use PostGIS indexes efficiently');
});
