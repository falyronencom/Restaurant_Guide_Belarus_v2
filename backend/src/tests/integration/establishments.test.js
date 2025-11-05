/**
 * Establishments Management System Integration Tests
 *
 * Tests all establishment management functionality:
 * - Create establishment (partner only, draft status)
 * - List establishments (pagination, filtering, ownership)
 * - Get establishment details
 * - Update establishment (ownership verification, status transitions)
 * - Submit for moderation (status workflow)
 * - Belarus-specific validation (cities, coordinates, categories, cuisines)
 * - Authorization and ownership checks
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query, countRecords } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import {
  testEstablishments,
  invalidEstablishments,
  minimalEstablishment
} from '../fixtures/establishments.js';

let partnerToken;
let partner2Token;
let userToken;
let partnerId;
let partner2Id;

// Setup and teardown
beforeAll(async () => {
  // Create test users
  const partner1 = await createUserAndGetTokens(testUsers.partner);
  const partner2 = await createUserAndGetTokens(testUsers.partner2);
  const user = await createUserAndGetTokens(testUsers.regularUser);

  partnerToken = partner1.accessToken;
  partner2Token = partner2.accessToken;
  userToken = user.accessToken;
  partnerId = partner1.user.id;
  partner2Id = partner2.user.id;
});

beforeEach(async () => {
  // Clear establishments before each test
  await query('TRUNCATE TABLE establishments CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

describe('Establishments System - Create Establishment', () => {
  describe('POST /api/v1/partner/establishments - Basic Creation', () => {
    test('should create new establishment in draft status', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(testEstablishments[0])
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.establishment).toBeDefined();

      const establishment = response.body.data.establishment;
      expect(establishment.name).toBe(testEstablishments[0].name);
      expect(establishment.city).toBe('Минск');
      expect(establishment.status).toBe('draft');
      expect(establishment.partner_id).toBe(partnerId);
      expect(establishment.id).toBeDefined();
    });

    test('should create establishment with all fields', async () => {
      const establishmentData = testEstablishments[0];

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(establishmentData)
        .expect(201);

      const establishment = response.body.data.establishment;
      expect(establishment.name).toBe(establishmentData.name);
      expect(establishment.description).toBe(establishmentData.description);
      expect(establishment.city).toBe(establishmentData.city);
      expect(establishment.address).toBe(establishmentData.address);
      expect(establishment.latitude).toBe(establishmentData.latitude);
      expect(establishment.longitude).toBe(establishmentData.longitude);
      expect(establishment.phone).toBe(establishmentData.phone);
      expect(establishment.email).toBe(establishmentData.email);
      expect(establishment.website).toBe(establishmentData.website);
      expect(establishment.categories).toEqual(establishmentData.categories);
      expect(establishment.cuisines).toEqual(establishmentData.cuisines);
      expect(establishment.price_range).toBe(establishmentData.priceRange);
    });

    test('should create establishment with minimal required fields', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(minimalEstablishment)
        .expect(201);

      const establishment = response.body.data.establishment;
      expect(establishment.name).toBe(minimalEstablishment.name);
      expect(establishment.phone).toBeNull();
      expect(establishment.email).toBeNull();
      expect(establishment.website).toBeNull();
    });

    test('should reject creation without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .send(testEstablishments[0])
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    test('should reject creation by regular user (not partner)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${userToken}`)
        .send(testEstablishments[0])
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/v1/partner/establishments - Belarus City Validation', () => {
    test('should accept Минск', async () => {
      const data = { ...testEstablishments[0], city: 'Минск' };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Минск');
    });

    test('should accept Гродно', async () => {
      const data = { ...testEstablishments[0], city: 'Гродно' };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Гродно');
    });

    test('should accept Брест', async () => {
      const data = { ...testEstablishments[0], city: 'Брест' };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Брест');
    });

    test('should accept Гомель', async () => {
      const data = { ...testEstablishments[0], city: 'Гомель' };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.city).toBe('Гомель');
    });

    test('should accept Витебск, Могилев, Бобруйск', async () => {
      const cities = ['Витебск', 'Могилев', 'Бобруйск'];

      for (const city of cities) {
        const data = { ...testEstablishments[0], name: `Test ${city}`, city };

        const response = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(data)
          .expect(201);

        expect(response.body.data.establishment.city).toBe(city);
      }
    });

    test('should reject invalid city (Москва)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.invalidCity)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('city');
    });

    test('should reject invalid city (Kiev)', async () => {
      const data = { ...testEstablishments[0], city: 'Киев' };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Geographic Coordinates Validation', () => {
    test('should accept valid Minsk coordinates', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 53.9,
        longitude: 27.5
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.latitude).toBe(53.9);
      expect(response.body.data.establishment.longitude).toBe(27.5);
    });

    test('should accept coordinates at Belarus boundaries', async () => {
      // North-East corner
      const neData = {
        ...testEstablishments[0],
        name: 'NE Corner',
        latitude: 56.0,
        longitude: 33.0
      };

      await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(neData)
        .expect(201);

      // South-West corner
      const swData = {
        ...testEstablishments[0],
        name: 'SW Corner',
        latitude: 51.0,
        longitude: 23.0
      };

      await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(swData)
        .expect(201);
    });

    test('should reject coordinates outside Belarus (Moscow)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.outsideBelarus)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('coordinate');
    });

    test('should reject coordinates north of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 57.0, // Above 56.0
        longitude: 27.5
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject coordinates south of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 50.0, // Below 51.0
        longitude: 27.5
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject coordinates west of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 53.9,
        longitude: 22.0 // Below 23.0
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject coordinates east of Belarus', async () => {
      const data = {
        ...testEstablishments[0],
        latitude: 53.9,
        longitude: 34.0 // Above 33.0
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Categories Validation', () => {
    test('should accept 1 category', async () => {
      const data = {
        ...testEstablishments[0],
        categories: ['Ресторан']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.categories).toEqual(['Ресторан']);
    });

    test('should accept 2 categories', async () => {
      const data = {
        ...testEstablishments[0],
        categories: ['Ресторан', 'Бар']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.categories).toEqual(['Ресторан', 'Бар']);
    });

    test('should reject 0 categories', async () => {
      const data = {
        ...testEstablishments[0],
        categories: []
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject 3 categories (max is 2)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.tooManyCategories)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should accept all valid category types', async () => {
      const validCategories = [
        'Ресторан', 'Кофейня', 'Фаст-фуд', 'Бар', 'Кондитерская',
        'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальян',
        'Боулинг', 'Караоке', 'Бильярд'
      ];

      for (const category of validCategories) {
        const data = {
          ...testEstablishments[0],
          name: `Test ${category}`,
          categories: [category]
        };

        const response = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(data)
          .expect(201);

        expect(response.body.data.establishment.categories).toContain(category);
      }
    });

    test('should reject invalid category', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.invalidCategory)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Cuisines Validation', () => {
    test('should accept 1 cuisine', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: ['Европейская']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.cuisines).toEqual(['Европейская']);
    });

    test('should accept 2 cuisines', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: ['Европейская', 'Итальянская']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.cuisines).toHaveLength(2);
    });

    test('should accept 3 cuisines (maximum)', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: ['Европейская', 'Итальянская', 'Японская']
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(201);

      expect(response.body.data.establishment.cuisines).toHaveLength(3);
    });

    test('should reject 0 cuisines', async () => {
      const data = {
        ...testEstablishments[0],
        cuisines: []
      };

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject 4 cuisines (max is 3)', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.tooManyCuisines)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should accept all valid cuisine types', async () => {
      const validCuisines = [
        'Народная', 'Авторская', 'Азиатская', 'Американская',
        'Вегетарианская', 'Японская', 'Грузинская', 'Итальянская',
        'Смешанная', 'Континентальная', 'Европейская'
      ];

      for (const cuisine of validCuisines) {
        const data = {
          ...testEstablishments[0],
          name: `Test ${cuisine}`,
          cuisines: [cuisine]
        };

        const response = await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send(data)
          .expect(201);

        expect(response.body.data.establishment.cuisines).toContain(cuisine);
      }
    });

    test('should reject invalid cuisine', async () => {
      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(invalidEstablishments.invalidCuisine)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/partner/establishments - Required Fields Validation', () => {
    test('should reject missing name', async () => {
      const data = { ...testEstablishments[0] };
      delete data.name;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details).toContainEqual(
        expect.objectContaining({ path: 'name' })
      );
    });

    test('should reject missing description', async () => {
      const data = { ...testEstablishments[0] };
      delete data.description;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject missing city', async () => {
      const data = { ...testEstablishments[0] };
      delete data.city;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject missing coordinates', async () => {
      const data = { ...testEstablishments[0] };
      delete data.latitude;
      delete data.longitude;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject missing categories', async () => {
      const data = { ...testEstablishments[0] };
      delete data.categories;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject missing cuisines', async () => {
      const data = { ...testEstablishments[0] };
      delete data.cuisines;

      const response = await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .send(data)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

describe('Establishments System - List & Read Operations', () => {
  let establishment1Id;
  let establishment2Id;

  beforeEach(async () => {
    // Create test establishments
    const response1 = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send(testEstablishments[0]);
    establishment1Id = response1.body.data.establishment.id;

    const response2 = await request(app)
      .post('/api/v1/partner/establishments')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ ...testEstablishments[1], name: 'Second Establishment' });
    establishment2Id = response2.body.data.establishment.id;
  });

  describe('GET /api/v1/partner/establishments - List Own Establishments', () => {
    test('should list all partner establishments', async () => {
      const response = await request(app)
        .get('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data.establishments).toHaveLength(2);
      expect(response.body.data.pagination).toBeDefined();
    });

    test('should only show own establishments (ownership filter)', async () => {
      // Partner 2 creates establishment
      await request(app)
        .post('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partner2Token}`)
        .send({ ...testEstablishments[2], name: 'Partner 2 Restaurant' });

      // Partner 1 lists - should only see their 2 establishments
      const response = await request(app)
        .get('/api/v1/partner/establishments')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data.establishments).toHaveLength(2);
      response.body.data.establishments.forEach(est => {
        expect(est.partner_id).toBe(partnerId);
      });
    });

    test('should support pagination', async () => {
      // Create more establishments
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/v1/partner/establishments')
          .set('Authorization', `Bearer ${partnerToken}`)
          .send({ ...testEstablishments[0], name: `Establishment ${i}` });
      }

      // Get page 1
      const page1 = await request(app)
        .get('/api/v1/partner/establishments?page=1&limit=5')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(page1.body.data.establishments).toHaveLength(5);
      expect(page1.body.data.pagination.page).toBe(1);
      expect(page1.body.data.pagination.hasNext).toBe(true);

      // Get page 2
      const page2 = await request(app)
        .get('/api/v1/partner/establishments?page=2&limit=5')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(page2.body.data.establishments).toHaveLength(5);
      expect(page2.body.data.pagination.page).toBe(2);
    });

    test('should filter by status', async () => {
      // Submit one for moderation
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment1Id}/submit`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      // Filter by draft
      const drafts = await request(app)
        .get('/api/v1/partner/establishments?status=draft')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(drafts.body.data.establishments).toHaveLength(1);
      expect(drafts.body.data.establishments[0].status).toBe('draft');

      // Filter by pending
      const pending = await request(app)
        .get('/api/v1/partner/establishments?status=pending')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(pending.body.data.establishments).toHaveLength(1);
      expect(pending.body.data.establishments[0].status).toBe('pending');
    });
  });

  describe('GET /api/v1/partner/establishments/:id - Get Single Establishment', () => {
    test('should get establishment details', async () => {
      const response = await request(app)
        .get(`/api/v1/partner/establishments/${establishment1Id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data.establishment.id).toBe(establishment1Id);
      expect(response.body.data.establishment.name).toBe(testEstablishments[0].name);
    });

    test('should reject getting other partner establishment', async () => {
      const response = await request(app)
        .get(`/api/v1/partner/establishments/${establishment1Id}`)
        .set('Authorization', `Bearer ${partner2Token}`)
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    test('should reject non-existent establishment', async () => {
      const response = await request(app)
        .get('/api/v1/partner/establishments/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    test('should reject invalid UUID format', async () => {
      const response = await request(app)
        .get('/api/v1/partner/establishments/invalid-uuid')
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

// Status workflow tests, update tests, and more to be added...
describe('Establishments System - Update Operations', () => {
  test.todo('should update establishment name');
  test.todo('should update establishment description');
  test.todo('should update coordinates');
  test.todo('should update categories and cuisines');
  test.todo('should reject updates by non-owner');
});

describe('Establishments System - Status Workflow', () => {
  test.todo('should submit draft for moderation (draft → pending)');
  test.todo('should reject submitting already pending establishment');
  test.todo('should reset to pending on major changes to active establishment');
  test.todo('should track status history');
});
