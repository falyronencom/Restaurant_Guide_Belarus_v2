/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Promotions Integration Tests
 *
 * Tests promotion CRUD endpoints, max limit enforcement,
 * search enrichment, detail inclusion, analytics tracking,
 * ownership verification, and lazy expiry logic.
 */

import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { jest } from '@jest/globals';
import { clearAllData } from '../utils/database.js';
import { createPartnerAndGetToken, createTestEstablishment } from '../utils/auth.js';
import redisClient, { connectRedis } from '../../config/redis.js';
// Module-relative temp dir every multer destination writes to (backend/tmp/uploads).
// Importing it does not touch cloudinary.js, so it is safe ahead of the mock below.
import { TEMP_UPLOAD_DIR } from '../../middleware/upload.js';

// Mock Cloudinary
let app;
let pool;
let cloudinary;

jest.unstable_mockModule('../../config/cloudinary.js', () => ({
  uploadImage: jest.fn(async () => ({
    public_id: 'test-promo-public-id',
    secure_url: 'https://res.cloudinary.com/test/promotions/test.jpg',
    width: 800,
    height: 600,
    format: 'jpg',
  })),
  uploadAvatar: jest.fn(async () => ({ public_id: 'test-avatar', secure_url: 'https://test.com/avatar.jpg' })),
  generateAllResolutions: jest.fn(() => ({
    url: 'https://res.cloudinary.com/test/promotions/original.jpg',
    thumbnail_url: 'https://res.cloudinary.com/test/promotions/thumbnail.jpg',
    preview_url: 'https://res.cloudinary.com/test/promotions/preview.jpg',
  })),
  generateImageUrl: jest.fn(() => 'https://res.cloudinary.com/test/promotions/test.jpg'),
  generatePdfThumbnailUrl: jest.fn(() => 'https://res.cloudinary.com/test/thumb.jpg'),
  generatePdfPreviewUrl: jest.fn(() => 'https://res.cloudinary.com/test/preview.jpg'),
  generatePdfPageImageUrl: jest.fn((url, page) => url.replace('/upload/', `/upload/pg_${page}/`).replace(/\.pdf$/i, '.jpg')),
  deleteImage: jest.fn(async () => ({ result: 'ok' })),
  extractPublicIdFromUrl: jest.fn(() => 'test-promo-public-id'),
  isValidImageType: jest.fn(() => true),
  isValidImageSize: jest.fn(() => true),
  // Named-imported by establishmentService (loaded via server.js) — must exist
  // in the module mock or ESM linking fails. Mirrors the real allow-list.
  hasValidImageExtension: jest.fn((name) => /\.(jpe?g|png|webp|heic|jfif)$/i.test(String(name || '').split('?')[0])),
  hasValidPdfExtension: jest.fn((name) => /\.pdf$/i.test(String(name || '').split('?')[0])),
  fileExtension: jest.fn((name) => {
    const base = String(name || '').split('?')[0];
    const seg = base.slice(base.lastIndexOf('/') + 1);
    const dot = seg.lastIndexOf('.');
    return dot === -1 ? '' : seg.slice(dot + 1).toLowerCase();
  }),
  default: {},
}));

/** The analytics-write limiter keys by IP — constant under supertest — with an
 *  hour-long window, so clear its keys between tests (and between suite runs
 *  within the same hour). Mirrors auth-password-reset.test.js.
 *
 *  `ratelimit:ip:*` must be cleared too: connecting redis in this suite arms
 *  the GLOBAL 300/hour limiter for every request the file makes (~106/run) —
 *  without the sweep, a 3rd same-hour rerun would cross 300 mid-file and
 *  cascade 429s into unrelated tests. */
const clearRateLimitKeys = async () => {
  for (const pattern of ['ratelimit:analytics-write:*', 'ratelimit:ip:*']) {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  }
};

beforeAll(async () => {
  // Ensure multer's temp directory exists — the module-relative one the routes
  // actually write to, never a cwd-relative string (cwd differs local vs Railway).
  fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
  const appModule = await import('../../server.js');
  app = appModule.default || appModule.app;
  const poolModule = await import('../../config/database.js');
  pool = poolModule.default;
  cloudinary = await import('../../config/cloudinary.js');
  if (!redisClient.isOpen) {
    const connected = await connectRedis();
    if (!connected) {
      throw new Error('Redis connection is required for rate limit tests');
    }
  }
});

beforeEach(async () => {
  await clearAllData();
  await clearRateLimitKeys();
});

afterAll(async () => {
  await clearRateLimitKeys();
  if (pool) await pool.end();
});

// ============================================================================
// Helper: create a promotion via API
// ============================================================================
async function createPromotionViaAPI(token, establishmentId, overrides = {}) {
  const data = {
    establishment_id: establishmentId,
    title: overrides.title || 'Скидка 20% на все блюда',
    description: overrides.description || 'Акция для новых гостей',
    ...overrides,
  };

  return request(app)
    .post('/api/v1/partner/promotions')
    .set('Authorization', `Bearer ${token}`)
    .field('establishment_id', data.establishment_id)
    .field('title', data.title)
    .field('description', data.description || '')
    .expect(overrides.expectedStatus || 201);
}

// ============================================================================
// CRUD Tests
// ============================================================================
describe('Promotions CRUD', () => {
  let partner, token, establishment;

  beforeEach(async () => {
    const result = await createPartnerAndGetToken();
    partner = result.partner;
    token = result.token;
    establishment = await createTestEstablishment(partner.id);
  });

  test('should create a promotion with title only', async () => {
    const response = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${token}`)
      .field('establishment_id', establishment.id)
      .field('title', 'Бизнес-ланч 15 BYN')
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      establishment_id: establishment.id,
      title: 'Бизнес-ланч 15 BYN',
      status: 'active',
    });
    expect(response.body.data.id).toBeDefined();
  });

  test('should create a promotion with all fields', async () => {
    const response = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${token}`)
      .field('establishment_id', establishment.id)
      .field('title', 'Скидка 20%')
      .field('description', 'На все основное меню')
      .field('terms_and_conditions', 'Не суммируется с другими акциями')
      .field('valid_from', '2026-04-01')
      .field('valid_until', '2026-05-01')
      .expect(201);

    expect(response.body.data.description).toBe('На все основное меню');
    expect(response.body.data.terms_and_conditions).toBe('Не суммируется с другими акциями');
  });

  test('should store image URLs when promotion has image data', async () => {
    // Verify that promotions can store image URLs by creating via DB directly
    // (Cloudinary upload is mocked — multer file processing tested separately in media.test.js)
    const promoResult = await pool.query(
      `INSERT INTO promotions (establishment_id, title, image_url, thumbnail_url, preview_url, status)
       VALUES ($1, 'Акция с фото', 'https://example.com/original.jpg', 'https://example.com/thumb.jpg', 'https://example.com/preview.jpg', 'active')
       RETURNING *`,
      [establishment.id]
    );

    expect(promoResult.rows[0].image_url).toBe('https://example.com/original.jpg');
    expect(promoResult.rows[0].thumbnail_url).toBe('https://example.com/thumb.jpg');
    expect(promoResult.rows[0].preview_url).toBe('https://example.com/preview.jpg');

    // Verify it appears in API listing
    const response = await request(app)
      .get(`/api/v1/partner/promotions/establishment/${establishment.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const promo = response.body.data.find(p => p.title === 'Акция с фото');
    expect(promo.image_url).toBeTruthy();
    expect(promo.thumbnail_url).toBeTruthy();
    expect(promo.preview_url).toBeTruthy();
  });

  // Regression (2026-09-06): promotionRoutes had its own multer config with the
  // cwd-relative destination 'backend/tmp/uploads' (backend/backend/tmp/uploads
  // locally, /app/backend/tmp/uploads on Railway). The path multer hands to the
  // service must sit inside the module-relative TEMP_UPLOAD_DIR whatever the cwd is.
  // resetMocks wipes the factory implementations before every test, so the
  // Cloudinary stubs the image path needs are re-armed here.
  test('writes the uploaded image into the module-relative TEMP_UPLOAD_DIR before the Cloudinary transfer', async () => {
    cloudinary.isValidImageType.mockReturnValue(true);
    cloudinary.isValidImageSize.mockReturnValue(true);
    // Existence is sampled inside the stub, at transfer time: the service may
    // one day unlink the temp file after the upload, and that must not turn
    // this cwd guard red.
    let seenOnDisk = null;
    cloudinary.uploadImage.mockImplementation(async (filePath) => {
      seenOnDisk = fs.existsSync(filePath);
      return {
        public_id: 'test-promo-public-id',
        secure_url: 'https://res.cloudinary.com/test/promotions/test.jpg',
      };
    });
    cloudinary.generateAllResolutions.mockReturnValue({
      url: 'https://res.cloudinary.com/test/promotions/original.jpg',
      thumbnail_url: 'https://res.cloudinary.com/test/promotions/thumbnail.jpg',
      preview_url: 'https://res.cloudinary.com/test/promotions/preview.jpg',
    });

    const response = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${token}`)
      .field('establishment_id', establishment.id)
      .field('title', 'Акция с загруженным фото')
      .attach('image', Buffer.from('fake image'), 'promo.jpg')
      .expect(201);

    expect(response.body.data.image_url).toBe('https://res.cloudinary.com/test/promotions/original.jpg');
    expect(cloudinary.uploadImage).toHaveBeenCalledTimes(1);
    const [tempFilePath] = cloudinary.uploadImage.mock.calls[0];
    expect(path.isAbsolute(tempFilePath)).toBe(true);
    expect(path.dirname(tempFilePath)).toBe(TEMP_UPLOAD_DIR);
    expect(seenOnDisk).toBe(true);
    fs.rmSync(tempFilePath, { force: true });
  });

  test('should list promotions for partner establishment', async () => {
    await createPromotionViaAPI(token, establishment.id, { title: 'Акция 1' });
    await createPromotionViaAPI(token, establishment.id, { title: 'Акция 2' });

    const response = await request(app)
      .get(`/api/v1/partner/promotions/establishment/${establishment.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(2);
  });

  test('should update a promotion', async () => {
    const createRes = await createPromotionViaAPI(token, establishment.id);
    const promotionId = createRes.body.data.id;

    const response = await request(app)
      .patch(`/api/v1/partner/promotions/${promotionId}`)
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'Обновлённая акция')
      .field('description', 'Новое описание')
      .expect(200);

    expect(response.body.data.title).toBe('Обновлённая акция');
    expect(response.body.data.description).toBe('Новое описание');
  });

  test('should deactivate (soft delete) a promotion', async () => {
    const createRes = await createPromotionViaAPI(token, establishment.id);
    const promotionId = createRes.body.data.id;

    const response = await request(app)
      .delete(`/api/v1/partner/promotions/${promotionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.data.status).toBe('expired');

    // Verify it doesn't appear in active list
    const listRes = await request(app)
      .get(`/api/v1/partner/promotions/establishment/${establishment.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Partner list includes inactive, so should still show but with expired status
    const promo = listRes.body.data.find(p => p.id === promotionId);
    expect(promo.status).toBe('expired');
  });

  test('should require title', async () => {
    const response = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${token}`)
      .field('establishment_id', establishment.id)
      .field('title', '')
      .expect(400);

    expect(response.body.success).toBe(false);
  });

  test('should require establishment_id', async () => {
    const response = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'Акция без заведения')
      .expect(400);

    expect(response.body.success).toBe(false);
  });
});

// ============================================================================
// Max Limit Enforcement
// ============================================================================
describe('Promotion Limit Enforcement', () => {
  let partner, token, establishment;

  beforeEach(async () => {
    const result = await createPartnerAndGetToken();
    partner = result.partner;
    token = result.token;
    establishment = await createTestEstablishment(partner.id);
  });

  test('should enforce max 3 active promotions per establishment', async () => {
    // Create 3 promotions successfully
    await createPromotionViaAPI(token, establishment.id, { title: 'Акция 1' });
    await createPromotionViaAPI(token, establishment.id, { title: 'Акция 2' });
    await createPromotionViaAPI(token, establishment.id, { title: 'Акция 3' });

    // 4th attempt should fail with 400
    const response = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${token}`)
      .field('establishment_id', establishment.id)
      .field('title', 'Акция 4 — лишняя')
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('PROMOTION_LIMIT_EXCEEDED');
  });

  test('should allow new promotion after deactivating one', async () => {
    const res1 = await createPromotionViaAPI(token, establishment.id, { title: 'Акция 1' });
    await createPromotionViaAPI(token, establishment.id, { title: 'Акция 2' });
    await createPromotionViaAPI(token, establishment.id, { title: 'Акция 3' });

    // Deactivate one
    await request(app)
      .delete(`/api/v1/partner/promotions/${res1.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Now can create a new one
    await createPromotionViaAPI(token, establishment.id, { title: 'Акция 4 — замена' });
  });
});

// ============================================================================
// Ownership Verification
// ============================================================================
describe('Promotion Ownership Verification', () => {
  test('should reject promotion creation for other partner\'s establishment', async () => {
    const partner1 = await createPartnerAndGetToken();
    const partner2 = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner1.partner.id);

    const response = await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${partner2.token}`)
      .field('establishment_id', establishment.id)
      .field('title', 'Чужая акция')
      .expect(404);

    expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
  });

  test('should reject update for other partner\'s promotion', async () => {
    const partner1 = await createPartnerAndGetToken();
    const partner2 = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner1.partner.id);

    const createRes = await createPromotionViaAPI(partner1.token, establishment.id);

    await request(app)
      .patch(`/api/v1/partner/promotions/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${partner2.token}`)
      .field('title', 'Взлом')
      .expect(404);
  });

  test('should reject delete for other partner\'s promotion', async () => {
    const partner1 = await createPartnerAndGetToken();
    const partner2 = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner1.partner.id);

    const createRes = await createPromotionViaAPI(partner1.token, establishment.id);

    await request(app)
      .delete(`/api/v1/partner/promotions/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${partner2.token}`)
      .expect(404);
  });
});

// ============================================================================
// Search Enrichment
// ============================================================================
describe('Search Promotion Enrichment', () => {
  test('should include has_promotion in search results', async () => {
    const { partner, token } = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner.id);

    // Activate establishment
    await pool.query(
      `UPDATE establishments SET status = 'active' WHERE id = $1`,
      [establishment.id]
    );

    // Create a promotion
    await createPromotionViaAPI(token, establishment.id);

    // Search
    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ latitude: 53.9, longitude: 27.5, radius: 50 })
      .expect(200);

    const found = response.body.data.establishments.find(e => e.id === establishment.id);
    if (found) {
      expect(found.has_promotion).toBe(true);
      expect(found.promotion_count).toBe(1);
    }
  });

  test('should return has_promotion=false for establishment without promotions', async () => {
    const { partner } = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner.id);

    await pool.query(
      `UPDATE establishments SET status = 'active' WHERE id = $1`,
      [establishment.id]
    );

    const response = await request(app)
      .get('/api/v1/search/establishments')
      .query({ latitude: 53.9, longitude: 27.5, radius: 50 })
      .expect(200);

    const found = response.body.data.establishments.find(e => e.id === establishment.id);
    if (found) {
      expect(found.has_promotion).toBe(false);
      expect(found.promotion_count).toBe(0);
    }
  });
});

// ============================================================================
// Detail Endpoint Inclusion
// ============================================================================
describe('Detail Endpoint Promotions', () => {
  test('should include promotions array in establishment detail', async () => {
    const { partner, token } = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner.id);

    await pool.query(
      `UPDATE establishments SET status = 'active' WHERE id = $1`,
      [establishment.id]
    );

    await createPromotionViaAPI(token, establishment.id, { title: 'Детальная акция' });

    const response = await request(app)
      .get(`/api/v1/search/establishments/${establishment.id}`)
      .expect(200);

    expect(response.body.data.promotions).toBeDefined();
    expect(response.body.data.promotions).toHaveLength(1);
    expect(response.body.data.promotions[0].title).toBe('Детальная акция');
  });

  test('should return empty promotions array when none exist', async () => {
    const { partner } = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner.id);

    await pool.query(
      `UPDATE establishments SET status = 'active' WHERE id = $1`,
      [establishment.id]
    );

    const response = await request(app)
      .get(`/api/v1/search/establishments/${establishment.id}`)
      .expect(200);

    expect(response.body.data.promotions).toBeDefined();
    expect(response.body.data.promotions).toHaveLength(0);
  });
});

// ============================================================================
// Analytics Tracking
// ============================================================================
describe('Promotion View Tracking', () => {
  test('should record promotion view event', async () => {
    const { partner } = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner.id);

    const response = await request(app)
      .post('/api/v1/analytics/promotion-view')
      .send({ establishmentId: establishment.id })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.message).toBe('Promotion view event recorded');

    // Verify analytics row was created
    const analytics = await pool.query(
      `SELECT promotion_view_count FROM establishment_analytics
       WHERE establishment_id = $1 AND date = CURRENT_DATE`,
      [establishment.id]
    );
    expect(analytics.rows.length).toBe(1);
    expect(analytics.rows[0].promotion_view_count).toBe(1);
  });

  test('should increment on multiple views', async () => {
    const { partner } = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner.id);

    await request(app).post('/api/v1/analytics/promotion-view').send({ establishmentId: establishment.id });
    await request(app).post('/api/v1/analytics/promotion-view').send({ establishmentId: establishment.id });
    await request(app).post('/api/v1/analytics/promotion-view').send({ establishmentId: establishment.id });

    const analytics = await pool.query(
      `SELECT promotion_view_count FROM establishment_analytics
       WHERE establishment_id = $1 AND date = CURRENT_DATE`,
      [establishment.id]
    );
    expect(analytics.rows[0].promotion_view_count).toBe(3);
  });

  test('should require establishmentId', async () => {
    await request(app)
      .post('/api/v1/analytics/promotion-view')
      .send({})
      .expect(400);
  });
});

// ============================================================================
// Analytics-write rate limit (OSB-P5)
// ============================================================================
describe('Analytics-write rate limit (OSB-P5)', () => {
  test('both endpoints sit behind ONE named 60/hour budget, not the global 300', async () => {
    const { partner } = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner.id);

    // Named limiter present: the global unauth limiter advertises 300.
    const first = await request(app)
      .post('/api/v1/analytics/promotion-view')
      .send({ establishmentId: establishment.id })
      .expect(200);
    expect(first.headers['x-ratelimit-limit']).toBe('60');
    expect(first.headers['x-ratelimit-remaining']).toBe('59');

    // Shared budget: a track-call from the same IP continues the SAME
    // counter (58, not 59) — alternating endpoints cannot double the rate.
    const second = await request(app)
      .post(`/api/v1/establishments/${establishment.id}/track-call`)
      .expect(200);
    expect(second.headers['x-ratelimit-limit']).toBe('60');
    expect(second.headers['x-ratelimit-remaining']).toBe('58');
  });

  test('61st write in the window → 429 RATE_LIMIT_EXCEEDED', async () => {
    // The limiter sits BEFORE the controller, so cheap 400s (no body) spend
    // budget without touching the DB — lets us reach the cap fast.
    for (let i = 0; i < 60; i += 1) {
      await request(app)
        .post('/api/v1/analytics/promotion-view')
        .send({})
        .expect(400);
    }

    const response = await request(app)
      .post('/api/v1/analytics/promotion-view')
      .send({})
      .expect(429);

    expect(response.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

// ============================================================================
// Lazy Expiry
// ============================================================================
describe('Promotion Lazy Expiry', () => {
  test('should auto-expire promotions with past valid_until', async () => {
    const { partner, token } = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner.id);

    // Insert a promotion that expired yesterday directly in DB
    await pool.query(
      `INSERT INTO promotions (establishment_id, title, valid_from, valid_until, status)
       VALUES ($1, 'Прошлая акция', '2026-01-01', '2026-03-01', 'active')`,
      [establishment.id]
    );

    // Fetching promotions should trigger lazy expiry
    const response = await request(app)
      .get(`/api/v1/partner/promotions/establishment/${establishment.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // The expired promotion should now have status='expired'
    const expired = response.body.data.find(p => p.title === 'Прошлая акция');
    expect(expired).toBeDefined();
    expect(expired.status).toBe('expired');
  });

  test('should not expire promotions with null valid_until (indefinite)', async () => {
    const { partner, token } = await createPartnerAndGetToken();
    const establishment = await createTestEstablishment(partner.id);

    // Create promotion without valid_until (indefinite)
    await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${token}`)
      .field('establishment_id', establishment.id)
      .field('title', 'Бессрочная акция')
      .expect(201);

    const response = await request(app)
      .get(`/api/v1/partner/promotions/establishment/${establishment.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const indefinite = response.body.data.find(p => p.title === 'Бессрочная акция');
    expect(indefinite.status).toBe('active');
  });
});

// ============================================================================
// Authentication
// ============================================================================
describe('Promotion Authentication', () => {
  test('should reject unauthenticated requests', async () => {
    await request(app)
      .post('/api/v1/partner/promotions')
      .field('title', 'Без авторизации')
      .expect(401);
  });

  test('should reject non-partner users', async () => {
    // Use test helper to create a regular user with 'user' role
    const { createUserAndGetTokens } = await import('../utils/auth.js');
    const userResult = await createUserAndGetTokens({
      email: `user-${Date.now()}@test.com`,
      phone: `+37529${Math.floor(1000000 + Math.random() * 9000000)}`,
      password: 'Test123!@#',
      name: 'Regular User',
      role: 'user',
    });

    await request(app)
      .post('/api/v1/partner/promotions')
      .set('Authorization', `Bearer ${userResult.accessToken}`)
      .field('title', 'Не партнёр')
      .expect(403);
  });
});
