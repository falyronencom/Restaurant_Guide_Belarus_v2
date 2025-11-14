/**
 * E2E Journey Test: Search & Discovery Complete Flow
 *
 * This test simulates how users discover restaurants using the search system:
 * 1. User searches by location (radius-based)
 * 2. User applies filters (category, cuisine, price, rating)
 * 3. User uses map view (bounds-based search)
 * 4. User finds specific restaurant
 * 5. User refines search with multiple filters
 *
 * This journey verifies the PostGIS search system works correctly with:
 * - Geospatial queries
 * - Dynamic filtering
 * - Distance calculations
 * - Multiple search modes
 */

import { query } from '../utils/database.js';
import {
  app,
  cleanDatabase,
  registerUser,
  createEstablishment,
  searchEstablishments
} from './helpers.js';
import { testUsers } from '../fixtures/users.js';
import request from 'supertest';

describe('E2E Journey: Search & Discovery Complete Flow', () => {
  let partner;
  let establishments = [];

  beforeAll(async () => {
    await cleanDatabase();

    // Setup: Create partner
    partner = await registerUser({
      ...testUsers.partner,
      email: 'partner@search.test',
      phone: '+375296666666'
    });

    // Seed establishments at different locations with variety
    const establishmentsData = [
      {
        name: 'Центральный Ресторан',
        description: 'В самом центре',
        city: 'Минск',
        address: 'Центр',
        latitude: 53.9,
        longitude: 27.5,
        categories: ['Ресторан'],
        cuisines: ['Европейская'],
        price_range: '$$$',
        phone: '+375291111111',
        working_hours: {
          monday: '09:00-22:00',
          tuesday: '09:00-22:00',
          wednesday: '09:00-22:00',
          thursday: '09:00-22:00',
          friday: '09:00-23:00',
          saturday: '10:00-23:00',
          sunday: '10:00-22:00'
        }
      },
      {
        name: 'Уютная Кофейня',
        description: 'Близко к центру',
        city: 'Минск',
        address: 'Рядом',
        latitude: 53.92,
        longitude: 27.48,
        categories: ['Кофейня'],
        cuisines: ['Европейская'],
        price_range: '$',
        phone: '+375292222222',
        working_hours: {
          monday: '08:00-20:00',
          tuesday: '08:00-20:00',
          wednesday: '08:00-20:00',
          thursday: '08:00-20:00',
          friday: '08:00-21:00',
          saturday: '09:00-21:00',
          sunday: '09:00-20:00'
        }
      },
      {
        name: 'Народная Харчевня',
        description: 'Белорусская кухня',
        city: 'Минск',
        address: 'Окраина',
        latitude: 53.88,
        longitude: 27.52,
        categories: ['Ресторан'],
        cuisines: ['Народная'],
        price_range: '$$',
        phone: '+375293333333',
        working_hours: {
          monday: '10:00-21:00',
          tuesday: '10:00-21:00',
          wednesday: '10:00-21:00',
          thursday: '10:00-21:00',
          friday: '10:00-22:00',
          saturday: '11:00-22:00',
          sunday: '11:00-21:00'
        }
      },
      {
        name: 'Пиццерия Италия',
        description: 'Итальянская пицца',
        city: 'Минск',
        address: 'Район',
        latitude: 53.91,
        longitude: 27.49,
        categories: ['Пиццерия'],
        cuisines: ['Итальянская'],
        price_range: '$$',
        phone: '+375294444444',
        working_hours: {
          monday: '11:00-23:00',
          tuesday: '11:00-23:00',
          wednesday: '11:00-23:00',
          thursday: '11:00-23:00',
          friday: '11:00-00:00',
          saturday: '12:00-00:00',
          sunday: '12:00-23:00'
        }
      }
    ];

    // Create all establishments
    for (const data of establishmentsData) {
      const estab = await createEstablishment(partner.accessToken, data);

      // Manually update to active status for search
      await query(
        'UPDATE establishments SET status = $1 WHERE id = $2',
        ['active', estab.establishment.id]
      );

      establishments.push(estab.establishment);
    }
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  describe('Complete Search & Discovery Journey', () => {
    test('STEP 1: User searches near Minsk center (wide radius)', async () => {
      // User opens app and searches nearby
      const result = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10 // 10km
      });

      // Verify all nearby establishments found
      expect(result.response.status).toBe(200);
      expect(result.establishments.length).toBeGreaterThan(0);
      expect(result.establishments.length).toBeLessThanOrEqual(4);

      // Verify results include distance
      result.establishments.forEach(estab => {
        expect(estab).toHaveProperty('distance_km');
        expect(typeof estab.distance_km).toBe('number');
        expect(estab.distance_km).toBeLessThanOrEqual(10);
      });

      // Verify ordered by distance (closest first)
      for (let i = 1; i < result.establishments.length; i++) {
        expect(result.establishments[i].distance_km).toBeGreaterThanOrEqual(
          result.establishments[i - 1].distance_km
        );
      }
    });

    test('STEP 2: User filters by category (Кофейня)', async () => {
      // User wants to find coffee shop
      const result = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        categories: 'Кофейня'
      });

      // Verify only coffee shops returned
      expect(result.response.status).toBe(200);
      expect(result.establishments.length).toBeGreaterThan(0);

      result.establishments.forEach(estab => {
        expect(estab.categories).toContain('Кофейня');
      });
    });

    test('STEP 3: User filters by cuisine (Народная)', async () => {
      // User wants Belarusian food
      const result = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        cuisines: 'Народная'
      });

      // Verify only Belarusian cuisine returned
      expect(result.response.status).toBe(200);
      expect(result.establishments.length).toBeGreaterThan(0);

      result.establishments.forEach(estab => {
        expect(estab.cuisines).toContain('Народная');
      });
    });

    test('STEP 4: User filters by price range ($)', async () => {
      // User looking for cheap option
      const result = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        priceRange: '$'
      });

      // Verify only budget establishments returned
      expect(result.response.status).toBe(200);
      expect(result.establishments.length).toBeGreaterThan(0);

      result.establishments.forEach(estab => {
        expect(estab.price_range).toBe('$');
      });
    });

    test('STEP 5: User combines multiple filters', async () => {
      // User wants: Restaurant + European cuisine + Medium price
      const result = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        categories: 'Ресторан',
        cuisines: 'Европейская',
        priceRange: '$$$'
      });

      // Verify all filters applied
      expect(result.response.status).toBe(200);

      if (result.establishments.length > 0) {
        result.establishments.forEach(estab => {
          expect(estab.categories).toContain('Ресторан');
          expect(estab.cuisines).toContain('Европейская');
          expect(estab.price_range).toBe('$$$');
        });
      }
    });

    test('STEP 6: User uses map view (bounds-based search)', async () => {
      // User switches to map and searches visible area
      const response = await request(app)
        .get('/api/v1/search/map')
        .query({
          minLat: 53.85,
          maxLat: 53.95,
          minLon: 27.45,
          maxLon: 27.55
        });

      // Verify bounds search works
      expect(response.status).toBe(200);
      expect(response.body.data.establishments).toBeInstanceOf(Array);
      expect(response.body.data.establishments.length).toBeGreaterThan(0);

      // Verify all results within bounds
      response.body.data.establishments.forEach(estab => {
        expect(estab.latitude).toBeGreaterThanOrEqual(53.85);
        expect(estab.latitude).toBeLessThanOrEqual(53.95);
        expect(estab.longitude).toBeGreaterThanOrEqual(27.45);
        expect(estab.longitude).toBeLessThanOrEqual(27.55);
      });
    });

    test('STEP 7: User narrows search radius', async () => {
      // User wants very close options only
      const result = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 2 // Only 2km
      });

      // Verify only very close establishments returned
      expect(result.response.status).toBe(200);

      if (result.establishments.length > 0) {
        result.establishments.forEach(estab => {
          expect(estab.distance_km).toBeLessThanOrEqual(2);
        });
      }
    });

    test('STEP 8: User searches with pagination', async () => {
      // First page
      const page1 = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        limit: 2,
        offset: 0
      });

      // Second page
      const page2 = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10,
        limit: 2,
        offset: 2
      });

      // Verify pagination works
      expect(page1.response.status).toBe(200);
      expect(page2.response.status).toBe(200);

      expect(page1.pagination).toHaveProperty('total');
      expect(page1.pagination).toHaveProperty('hasMore');
      expect(page1.establishments.length).toBeLessThanOrEqual(2);
      expect(page2.establishments.length).toBeLessThanOrEqual(2);

      // Verify different results
      if (page1.establishments.length > 0 && page2.establishments.length > 0) {
        expect(page1.establishments[0].id).not.toBe(page2.establishments[0].id);
      }
    });
  });

  describe('Search Edge Cases', () => {
    test('Search with invalid coordinates fails gracefully', async () => {
      const response = await request(app)
        .get('/api/v1/search/establishments')
        .query({
          latitude: 999, // Invalid
          longitude: 999, // Invalid
          radius: 10
        });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Search with zero radius fails', async () => {
      const response = await request(app)
        .get('/api/v1/search/establishments')
        .query({
          latitude: 53.9,
          longitude: 27.5,
          radius: 0 // Invalid
        });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Search with very large radius limited', async () => {
      const response = await request(app)
        .get('/api/v1/search/establishments')
        .query({
          latitude: 53.9,
          longitude: 27.5,
          radius: 2000 // Too large
        });

      // Should reject radius > 1000km
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('Search without coordinates fails', async () => {
      const response = await request(app)
        .get('/api/v1/search/establishments')
        .query({
          radius: 10
          // Missing latitude/longitude
        });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PostGIS Integration Verification', () => {
    test('Distance calculations are accurate', async () => {
      // Search from exact establishment location
      const establishment = establishments[0];

      const result = await searchEstablishments({
        latitude: establishment.latitude,
        longitude: establishment.longitude,
        radius: 1 // 1km
      });

      expect(result.response.status).toBe(200);

      // Find the establishment we're searching from
      const found = result.establishments.find(e => e.id === establishment.id);

      if (found) {
        // Distance should be approximately 0
        expect(found.distance_km).toBeLessThan(0.1);
      }
    });

    test('Results ordered correctly by distance', async () => {
      const result = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10
      });

      expect(result.response.status).toBe(200);

      // Verify ascending distance order
      for (let i = 1; i < result.establishments.length; i++) {
        expect(result.establishments[i].distance_km).toBeGreaterThanOrEqual(
          result.establishments[i - 1].distance_km
        );
      }
    });
  });
});
