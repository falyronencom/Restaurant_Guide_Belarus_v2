/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Smart Search Integration Tests
 *
 * Tests AI-powered smart search pipeline:
 * - Input validation and sanitization
 * - AI intent parsing → filter building
 * - Fallback to ILIKE when AI unavailable
 * - Redis caching (hit/miss)
 * - Rate limiting
 * - Price mapping (price_max → price_range)
 * - End-to-end search with parsed intent
 */

import crypto from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import * as smartSearchService from '../../services/smartSearchService.js';
import redisClient, { connectRedis, deleteKey } from '../../config/redis.js';

let partnerId;

// Unique-per-file fixture to prevent collision with other test files
// that use testUsers.partner (email='partner@test.com').
const PARTNER_EMAIL = `partner-smartsearch-${Date.now()}@test.com`;
const PARTNER_PHONE = `+37529${Math.floor(1000000 + Math.random() * 9000000)}`;

const defaultWorkingHours = JSON.stringify({
  monday: { open: '10:00', close: '22:00' },
  tuesday: { open: '10:00', close: '22:00' },
  wednesday: { open: '10:00', close: '22:00' },
  thursday: { open: '10:00', close: '22:00' },
  friday: { open: '10:00', close: '23:00' },
  saturday: { open: '11:00', close: '23:00' },
  sunday: { open: '11:00', close: '22:00' },
});

beforeAll(async () => {
  const partner = await createUserAndGetTokens({
    ...testUsers.partner,
    email: PARTNER_EMAIL,
    phone: PARTNER_PHONE,
  });
  partnerId = partner.user.id;
});

beforeEach(async () => {
  await clearAllData();
  await query(
    'INSERT INTO users (id, email, password_hash, name, role, auth_method) VALUES ($1, $2, $3, $4, $5, $6)',
    [partnerId, PARTNER_EMAIL, 'hash', 'Partner', 'partner', 'email']
  );

  // Seed test establishments
  // 1: Coffee shop in Minsk center
  await query(`
    INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Кофе Тайм', gen_random_uuid()::text, 'Уютная кофейня в центре', 'Минск', 'ул. Ленина 1', 53.9, 27.5, ARRAY['Кофейня'], ARRAY['Европейская'], 'active', $2::jsonb, '$', NOW(), NOW())
  `, [partnerId, defaultWorkingHours]);

  // 2: Italian restaurant
  await query(`
    INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Итальяно', gen_random_uuid()::text, 'Итальянская кухня', 'Минск', 'пр. Независимости 50', 53.91, 27.55, ARRAY['Ресторан'], ARRAY['Итальянская'], 'active', $2::jsonb, '$$$', NOW(), NOW())
  `, [partnerId, defaultWorkingHours]);

  // 3: Budget fast food
  await query(`
    INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Бургер Хаус', gen_random_uuid()::text, 'Быстро и вкусно', 'Минск', 'ул. Сурганова 10', 53.92, 27.58, ARRAY['Фаст-фуд'], ARRAY['Американская'], 'active', $2::jsonb, '$', NOW(), NOW())
  `, [partnerId, defaultWorkingHours]);

  // 4: Georgian restaurant in Gomel
  await query(`
    INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Хинкальная', gen_random_uuid()::text, 'Грузинская кухня', 'Гомель', 'ул. Советская 5', 52.4, 31.0, ARRAY['Ресторан'], ARRAY['Грузинская'], 'active', $2::jsonb, '$$', NOW(), NOW())
  `, [partnerId, defaultWorkingHours]);
});

afterAll(async () => {
  await clearAllData();
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('Smart Search - Input Validation', () => {
  test('should reject request without query', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('should reject empty query string', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  test('should reject invalid latitude', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе', latitude: 999 });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('latitude');
  });

  test('should reject invalid longitude', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе', longitude: -200 });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('longitude');
  });

  test('should sanitize query with control characters', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе\x00\x01 рядом' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test('should truncate query longer than 150 characters', async () => {
    const longQuery = 'а'.repeat(200);
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: longQuery });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});

// ─── Fallback (no API key) ───────────────────────────────────────────────────

describe('Smart Search - Fallback Mode', () => {
  test('should return results via fallback when AI unavailable', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.fallback).toBe(true);
    expect(response.body.data.intent).toBeNull();
    expect(Array.isArray(response.body.data.establishments)).toBe(true);
  });

  test('should find coffee shop via fallback ILIKE', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'Кофе Тайм' });

    expect(response.status).toBe(200);
    expect(response.body.data.establishments.length).toBeGreaterThanOrEqual(1);
    expect(response.body.data.establishments.some(e => e.name === 'Кофе Тайм')).toBe(true);
  });

  test('should find establishments via SEARCH_SYNONYMS fallback', async () => {
    // Segment B: AI may now return dish="бургер" (category=null) per the
    // dish-vs-category distinction in the new prompt. When that happens,
    // search filters on menu_items, so we seed one so that Бургер Хаус is
    // reachable via either the category path (legacy) or the dish path (new).
    const burgerEst = await query(
      `SELECT id FROM establishments WHERE name = $1 LIMIT 1`,
      ['Бургер Хаус'],
    );
    if (burgerEst.rows.length > 0) {
      const estId = burgerEst.rows[0].id;
      const mediaRes = await query(
        `INSERT INTO establishment_media
           (establishment_id, type, file_type, url, thumbnail_url, preview_url)
         VALUES ($1, 'menu', 'pdf', 'http://test/m.pdf', 'http://test/t.png', 'http://test/p.png')
         RETURNING id`,
        [estId],
      );
      const mediaId = mediaRes.rows[0].id;
      await query(
        `INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, position)
         VALUES ($1, $2, 'Классический бургер', 12.00, 0)`,
        [estId, mediaId],
      );
    }

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'бургер' });

    expect(response.status).toBe(200);
    // Should find via either: (a) synonym: бургер → Фаст-фуд category + Американская cuisine
    // or (b) dish="бургер" → menu_items.item_name ILIKE '%бургер%'
    expect(response.body.data.establishments.length).toBeGreaterThanOrEqual(1);
  });

  test('should filter by city in fallback mode', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'ресторан', city: 'Гомель' });

    expect(response.status).toBe(200);
    const establishments = response.body.data.establishments;
    if (establishments.length > 0) {
      establishments.forEach(e => {
        expect(e.city).toBe('Гомель');
      });
    }
  });

  test('should work with coordinates in fallback mode', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({
        query: 'кофе',
        latitude: 53.9,
        longitude: 27.5,
      });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(true);
    expect(Array.isArray(response.body.data.establishments)).toBe(true);
  });
});

// ─── Response Format ─────────────────────────────────────────────────────────

describe('Smart Search - Response Format', () => {
  test('should include all required response fields', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе' });

    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(data).toHaveProperty('intent');
    expect(data).toHaveProperty('establishments');
    expect(data).toHaveProperty('pagination');
    expect(data).toHaveProperty('fallback');
    expect(data.pagination).toHaveProperty('total');
    expect(data.pagination).toHaveProperty('page');
    expect(data.pagination).toHaveProperty('limit');
    expect(data.pagination).toHaveProperty('totalPages');
  });

  test('should respect limit parameter', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'ресторан', limit: 2 });

    expect(response.status).toBe(200);
    expect(response.body.data.establishments.length).toBeLessThanOrEqual(2);
  });

  test('should respect page parameter', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'ресторан', limit: 1, page: 2 });

    expect(response.status).toBe(200);
    expect(response.body.data.pagination.page).toBe(2);
  });

  test('should cap limit at 100', async () => {
    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'кофе', limit: 999 });

    expect(response.status).toBe(200);
    expect(response.body.data.pagination.limit).toBe(100);
  });
});

// ─── buildSmartSearchFilters unit tests ──────────────────────────────────────

describe('Smart Search - Filter Building', () => {
  test('should map category from intent', () => {
    const intent = {
      cuisine: null, category: 'Кофейня', meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.categories).toEqual(['Кофейня']);
  });

  test('should map cuisines array from intent', () => {
    const intent = {
      cuisine: ['Итальянская', 'Европейская'], category: null, meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.cuisines).toEqual(['Итальянская', 'Европейская']);
  });

  test('should map price_max <= 15 to ["$"]', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: 10, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.priceRange).toEqual(['$']);
  });

  test('should map price_max <= 30 to ["$", "$$"]', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: 25, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.priceRange).toEqual(['$', '$$']);
  });

  test('should map price_max > 30 to ["$", "$$", "$$$"]', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: 50, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.priceRange).toEqual(['$', '$$', '$$$']);
  });

  test('should use distance sort when coordinates provided and sort is null', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {
      latitude: 53.9, longitude: 27.5,
    });
    expect(filters.sortBy).toBe('distance');
  });

  test('should use rating sort when no coordinates and sort is null', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.sortBy).toBe('rating');
  });

  test('should pass explicit sort from intent', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: null, sort: 'price_asc', tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.sortBy).toBe('price_asc');
  });

  test('should join tags into search string', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: null, sort: null, tags: ['терраса', 'wifi'], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, {});
    expect(filters.search).toBe('терраса wifi');
  });

  test('should use AI location over context city', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: 'Гродно', sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, { city: 'Минск' });
    expect(filters.city).toBe('Гродно');
  });

  test('should fall back to context city when AI location is null', () => {
    const intent = {
      cuisine: null, category: null, meal_type: null,
      price_max: null, location: null, sort: null, tags: [], error: null,
    };
    const filters = smartSearchService.buildSmartSearchFilters(intent, { city: 'Минск' });
    expect(filters.city).toBe('Минск');
  });
});

// ─── Cache ───────────────────────────────────────────────────────────────────

describe('Smart Search - Caching', () => {
  let redisReady = false;

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      redisReady = await connectRedis();
    } else {
      redisReady = true;
    }

    // Падать честно, а не зеленеть молча: без Redis в этом блоке проверять
    // нечего. Та же позиция, что в reviews / promotions / auth-password-reset.
    if (!redisReady) {
      throw new Error('Redis connection is required for the intent cache test');
    }
  });

  afterAll(async () => {
    if (redisReady) {
      await deleteKey('smartsearch:test_hash_001');
    }
  });

  test('cacheIntent and getCachedIntent roundtrip', async () => {
    const intent = {
      cuisine: ['Итальянская'], category: 'Ресторан', meal_type: null,
      price_max: null, location: null, sort: 'rating', tags: [], error: null,
    };
    const hash = 'test_hash_001';

    await smartSearchService.cacheIntent(hash, intent, 60);
    const cached = await smartSearchService.getCachedIntent(hash);

    expect(cached).toEqual(intent);
  });

  test('getCachedIntent returns null for missing key', async () => {
    const cached = await smartSearchService.getCachedIntent('nonexistent_hash');
    expect(cached).toBeNull();
  });
});

// ─── Dish path: AI intent replayed from the Redis cache ──────────────────────
//
// Prod defect 07.09.2026 (20 Minsk establishments with parsed menus):
// POST /search/smart «пицца» → intent {dish:"пицца", tags:["пицца"]} → total 0,
// while GET /search/establishments?search=пицца found 2 (SEARCH_SYNONYMS).
// Two causes: (1) tags became an establishment-level ILIKE AND-ed with the
// menu_items EXISTS; (2) the EXISTS matched item_name only — pizzas are named
// «Маргарита», the menu section (category_raw) is «Пицца».
//
// OpenRouter is unavailable in tests, so the AI path is reached the way prod
// reaches it on a cache hit: the parsed intent is seeded under the key
// executeSmartSearch derives (smartsearch:<sha256(normalized query)[0..32)>).
// Redis is a hard requirement here (local redis-test, CI service): a missing
// Redis must fail these tests, not skip them.

function intentCacheHash(queryText) {
  // Mirrors normalizeQuery() + generateQueryHash() in smartSearchService.js
  const normalized = queryText.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

function dishIntent(dish, extra = {}) {
  return {
    cuisine: null, category: null, dish, meal_type: null, price_max: null,
    location: null, sort: null, tags: [dish], error: null, ...extra,
  };
}

describe('Smart Search - Dish path (intent replayed from cache)', () => {
  const seededHashes = new Set();

  beforeAll(async () => {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
  });

  afterAll(async () => {
    for (const hash of seededHashes) {
      await deleteKey(`smartsearch:${hash}`).catch(() => {});
    }
  });

  beforeEach(async () => {
    // 5: plain café — no synonym; name/description/categories/cuisines carry
    // neither «пицц» nor «капучино». Only its parsed menu can match.
    const est = await query(`
      INSERT INTO establishments (id, partner_id, name, slug, description, city, address, latitude, longitude, categories, cuisines, status, working_hours, price_range, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, 'Тестовое кафе', gen_random_uuid()::text, 'Обычное кафе без подсказок в описании', 'Минск', 'ул. Тестовая 7', 53.93, 27.6, ARRAY['Кафе'], ARRAY['Европейская'], 'active', $2::jsonb, '$$', NOW(), NOW())
      RETURNING id
    `, [partnerId, defaultWorkingHours]);
    const estId = est.rows[0].id;
    const media = await query(
      `INSERT INTO establishment_media
         (establishment_id, type, file_type, url, thumbnail_url, preview_url)
       VALUES ($1, 'menu', 'pdf', 'http://test/menu.pdf', 'http://test/t.png', 'http://test/p.png')
       RETURNING id`,
      [estId],
    );
    const mediaId = media.rows[0].id;
    await query(
      `INSERT INTO menu_items (establishment_id, media_id, item_name, price_byn, category_raw, is_hidden_by_admin, position)
       VALUES ($1, $2, 'Маргарита', 18.00, 'Пицца', FALSE, 0),
              ($1, $2, 'Пепперони', 12.00, 'Пицца', TRUE, 1),
              ($1, $2, 'КАПУЧИНО', 6.50, 'Напитки', FALSE, 2)`,
      [estId, mediaId],
    );
  });

  async function seedIntent(queryText, intent) {
    expect(redisClient.isOpen).toBe(true);
    const hash = intentCacheHash(queryText);
    seededHashes.add(hash);
    await smartSearchService.cacheIntent(hash, intent, 60);
    // Prove the seed landed — otherwise the request would silently take the
    // fallback path and the assertions below would test the wrong thing.
    expect(await smartSearchService.getCachedIntent(hash)).toEqual(intent);
  }

  test('environment guard: ILIKE folds Cyrillic case in the test database', async () => {
    const r = await query(`SELECT 'КАПУЧИНО' ILIKE '%капучино%' AS folded`);
    expect(r.rows[0].folded).toBe(true);
  });

  test('«пицца»: menu section «Пицца» (category_raw) finds the café; synonyms keep the Italian place — and nothing else', async () => {
    await seedIntent('пицца', dishIntent('пицца'));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'пицца', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    expect(response.body.data.intent.dish).toBe('пицца');
    const names = response.body.data.establishments.map(e => e.name).sort();
    expect(names).toEqual(['Итальяно', 'Тестовое кафе']);
    expect(response.body.data.pagination.total).toBe(2);
  });

  test('«капучино»: a dish outside SEARCH_SYNONYMS is found through item_name (case-insensitive) — tags no longer AND-filter the establishment', async () => {
    await seedIntent('капучино', dishIntent('капучино'));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'капучино', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    const names = response.body.data.establishments.map(e => e.name);
    expect(names).toEqual(['Тестовое кафе']);
  });

  test('«пицца до 20 рублей»: budget is checked against the menu (Маргарита 18 ≤ 20); unverified synonym matches are excluded', async () => {
    await seedIntent('пицца до 20 рублей', dishIntent('пицца', { price_max: 20 }));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'пицца до 20 рублей', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    expect(response.body.data.intent.price_max).toBe(20);
    const names = response.body.data.establishments.map(e => e.name);
    expect(names).toEqual(['Тестовое кафе']);
  });

  test('«пицца до 15 рублей»: over-budget (18) and admin-hidden (12) items do not count; no synonym fallback under a budget → empty', async () => {
    await seedIntent('пицца до 15 рублей', dishIntent('пицца', { price_max: 15 }));

    const response = await request(app)
      .post('/api/v1/search/smart')
      .send({ query: 'пицца до 15 рублей', city: 'Минск' });

    expect(response.status).toBe(200);
    expect(response.body.data.fallback).toBe(false);
    expect(response.body.data.establishments).toEqual([]);
    expect(response.body.data.pagination.total).toBe(0);
  });
});
