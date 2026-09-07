/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Analytics Integration Tests
 *
 * Tests 4 analytics endpoints (Segment C):
 *   #10  GET /api/v1/admin/analytics/overview          — dashboard metric cards
 *   #11  GET /api/v1/admin/analytics/users             — user registration analytics
 *   #12  GET /api/v1/admin/analytics/establishments    — establishment pipeline analytics
 *   #13  GET /api/v1/admin/analytics/reviews           — review activity analytics
 *
 * Setup: controlled dataset created once in beforeAll
 *   - 1 admin user
 *   - 3 regular users
 *   - 4 establishments: 2 active, 1 pending, 1 suspended (plus partner users)
 *   - 3 reviews on the first active establishment (ratings 2, 3, 5)
 *
 * Ghost table finding: establishment_analytics is not queried by any analytics
 * function. All queries target: users, establishments, reviews, audit_log directly.
 *
 * Aggregation note: windows are whole UTC days, so N days means exactly N
 * buckets — 7d and 30d both aggregate by 'day', 90d by 'week'. (Before the
 * stage-6 fix the upper bound was the current instant, which stretched 30d past
 * the 30-day threshold and silently produced weekly buckets.)
 *
 * All analytics endpoints are read-only — no beforeEach cleanup needed.
 * afterAll clears all test data.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import {
  createAdminAndGetToken,
  createPartnerWithEstablishment,
  createTestReview,
} from '../utils/adminTestHelpers.js';

const BASE_URL = '/api/v1/admin/analytics';

let adminToken;
let userToken; // non-admin, for 403 tests
let firstActiveEstablishmentId;

beforeAll(async () => {
  // Admin user (reused across all tests)
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;

  // Non-admin user for 403 assertions
  const regularUser = await createUserAndGetTokens({
    email: `analytics-user-${randomUUID()}@test.com`,
    phone: null,
    password: 'User123!@#',
    name: 'Analytics Regular User',
    role: 'user',
    authMethod: 'email',
  });
  userToken = regularUser.accessToken;

  // 3 additional regular users (contributes to user analytics totals)
  await Promise.all([
    createUserAndGetTokens({
      email: `analytics-reg1-${randomUUID()}@test.com`,
      phone: null,
      password: 'User123!@#',
      name: 'Regular 1',
      role: 'user',
      authMethod: 'email',
    }),
    createUserAndGetTokens({
      email: `analytics-reg2-${randomUUID()}@test.com`,
      phone: null,
      password: 'User123!@#',
      name: 'Regular 2',
      role: 'user',
      authMethod: 'email',
    }),
    createUserAndGetTokens({
      email: `analytics-reg3-${randomUUID()}@test.com`,
      phone: null,
      password: 'User123!@#',
      name: 'Regular 3',
      role: 'user',
      authMethod: 'email',
    }),
  ]);

  // 4 establishments in different statuses
  const active1 = await createPartnerWithEstablishment('active');
  firstActiveEstablishmentId = active1.establishment.id;

  await Promise.all([
    createPartnerWithEstablishment('active'),    // active #2
    createPartnerWithEstablishment('pending'),   // pending #1
    createPartnerWithEstablishment('suspended'), // suspended #1
  ]);

  // 3 reviews on the first active establishment (ratings 2, 3, 5).
  // Exactly one carries a partner response, on purpose: 1 из 3 = 0,3333… — a
  // ratio that two decimal places cannot express. A fixture where every review
  // is unanswered makes response_rate 0, and a test on its precision then passes
  // no matter how the number is rounded.
  await Promise.all([
    createTestReview(null, firstActiveEstablishmentId, { rating: 2 }),
    createTestReview(null, firstActiveEstablishmentId, { rating: 3 }),
    createTestReview(null, firstActiveEstablishmentId, {
      rating: 5,
      partner_response: 'Спасибо за отзыв!',
      partner_response_hours: 5,
    }),
  ]);
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Auth guards — shared across all 4 analytics endpoints
// ============================================================================

describe('Auth guards — analytics endpoints', () => {
  const endpoints = [
    `${BASE_URL}/overview`,
    `${BASE_URL}/users`,
    `${BASE_URL}/establishments`,
    `${BASE_URL}/reviews`,
  ];

  test.each(endpoints)('GET %s returns 401 without token', async (endpoint) => {
    const res = await request(app).get(endpoint).expect(401);
    expect(res.body.success).toBe(false);
  });

  test.each(endpoints)('GET %s returns 403 for non-admin role', async (endpoint) => {
    const res = await request(app)
      .get(endpoint)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    expect(res.body.success).toBe(false);
  });
});

// ============================================================================
// #10 — GET /api/v1/admin/analytics/overview
// ============================================================================

describe('GET /api/v1/admin/analytics/overview (#10)', () => {
  test('returns 200 with success: true', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/overview`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('response.data contains all expected top-level keys', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data).toHaveProperty('users');
    expect(body.data).toHaveProperty('establishments');
    expect(body.data).toHaveProperty('reviews');
    expect(body.data).toHaveProperty('moderation');
  });

  test('users section has total, new_in_period, change_percent', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { users } = body.data;
    expect(users).toHaveProperty('total');
    expect(users).toHaveProperty('new_in_period');
    expect(users).toHaveProperty('change_percent');
    expect(typeof users.total).toBe('number');
    expect(users.total).toBeGreaterThanOrEqual(1);
  });

  test('establishments counts reflect seeded test data', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { establishments } = body.data;
    expect(establishments.total).toBeGreaterThanOrEqual(4);
    expect(establishments.active).toBeGreaterThanOrEqual(2);
    expect(establishments.pending).toBeGreaterThanOrEqual(1);
    expect(establishments.suspended).toBeGreaterThanOrEqual(1);
  });

  test('reviews metrics reflect seeded reviews', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { reviews } = body.data;
    expect(reviews.total).toBeGreaterThanOrEqual(3);
    expect(typeof reviews.average_rating).toBe('number');
    // average of 2, 3, 5 = 3.33...
    expect(reviews.average_rating).toBeGreaterThan(0);
  });

  test('moderation section has pending_count and actions_in_period', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { moderation } = body.data;
    expect(moderation).toHaveProperty('pending_count');
    expect(moderation).toHaveProperty('actions_in_period');
    expect(moderation.pending_count).toBeGreaterThanOrEqual(1);
  });

  test('accepts ?period=7d query parameter', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/overview?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('users');
  });

  test('accepts custom date range via from/to parameters', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/overview?from=2026-01-01&to=2026-12-31`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
  });
});

// ============================================================================
// #11 — GET /api/v1/admin/analytics/users
// ============================================================================

describe('GET /api/v1/admin/analytics/users (#11)', () => {
  test('returns 200 with success: true', async () => {
    await request(app)
      .get(`${BASE_URL}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  test('response.data has all expected schema fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users`)
      .set('Authorization', `Bearer ${adminToken}`);

    const data = body.data;
    expect(data).toHaveProperty('registration_timeline');
    expect(data).toHaveProperty('role_distribution');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('new_in_period');
    expect(data).toHaveProperty('change_percent');
    expect(data).toHaveProperty('aggregation');
    expect(Array.isArray(data.registration_timeline)).toBe(true);
    expect(Array.isArray(data.role_distribution)).toBe(true);
  });

  test('total reflects all users created in test (at least admin + 4 regular)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    // admin (1) + regularUser (1) + 3 more regular + 4 partners + 3 review authors ≥ 12
    expect(body.data.total).toBeGreaterThanOrEqual(4);
  });

  test('?period=7d → aggregation is day', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.aggregation).toBe('day');
  });

  // Этот тест раньше запирал дефект: он утверждал 'week' и был прав про код,
  // но код был неправ про «30 дней». Верхней границей окна брался текущий
  // момент, диапазон выходил на полсуток длиннее тридцати, и `ceil` давал 31 —
  // то есть подпись «30 дней» означала тридцать один день, разложенный по
  // неделям. Окно теперь ровно в тридцать суток UTC, и корзины дневные.
  test('?period=30d → aggregation is day (window is exactly 30 whole days)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=30d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.aggregation).toBe('day');
  });

  test('?period=30d → registration_timeline has exactly 30 buckets', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=30d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.registration_timeline).toHaveLength(30);
  });

  test('registration_timeline entries have date and count fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const timeline = body.data.registration_timeline;
    expect(timeline.length).toBeGreaterThan(0);
    timeline.forEach(entry => {
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('count');
      expect(typeof entry.count).toBe('number');
    });
  });

  test('role_distribution entries have role and count', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users`)
      .set('Authorization', `Bearer ${adminToken}`);

    const roles = body.data.role_distribution;
    expect(roles.length).toBeGreaterThan(0);
    roles.forEach(entry => {
      expect(entry).toHaveProperty('role');
      expect(entry).toHaveProperty('count');
    });
  });

  test('future date range → new_in_period is 0, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/users?from=2030-01-01&to=2030-01-07`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.new_in_period).toBe(0);
    expect(res.body.data.total).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// #12 — GET /api/v1/admin/analytics/establishments
// ============================================================================

describe('GET /api/v1/admin/analytics/establishments (#12)', () => {
  test('returns 200 with success: true', async () => {
    await request(app)
      .get(`${BASE_URL}/establishments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  test('response.data has all expected schema fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments`)
      .set('Authorization', `Bearer ${adminToken}`);

    const data = body.data;
    expect(data).toHaveProperty('creation_timeline');
    expect(data).toHaveProperty('status_distribution');
    expect(data).toHaveProperty('city_distribution');
    expect(data).toHaveProperty('category_distribution');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('active');
    expect(data).toHaveProperty('new_in_period');
    expect(data).toHaveProperty('change_percent');
    expect(data).toHaveProperty('aggregation');
  });

  test('total and active reflect seeded establishments', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.total).toBeGreaterThanOrEqual(4); // 2 active + 1 pending + 1 suspended
    expect(body.data.active).toBeGreaterThanOrEqual(2);
  });

  // Stage 6 — the «На модерации» metric of frame 08. The count came out of the
  // same query all along and was projected only by /overview.
  test('pending is projected and matches /overview', async () => {
    const [establishments, overview] = await Promise.all([
      request(app).get(`${BASE_URL}/establishments?period=7d`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(app).get(`${BASE_URL}/overview?period=7d`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);

    expect(establishments.body.data.pending).toBeGreaterThanOrEqual(1);
    expect(establishments.body.data.pending)
      .toBe(overview.body.data.establishments.pending);
  });

  test('status_distribution includes active, pending, suspended', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments`)
      .set('Authorization', `Bearer ${adminToken}`);

    const statuses = body.data.status_distribution.map(s => s.status);
    expect(statuses).toContain('active');
    expect(statuses).toContain('pending');
    expect(statuses).toContain('suspended');
  });

  test('status_distribution entries have status and count fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments`)
      .set('Authorization', `Bearer ${adminToken}`);

    body.data.status_distribution.forEach(entry => {
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('count');
      expect(typeof entry.count).toBe('number');
    });
  });

  test('city_distribution contains Минск from test data', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(Array.isArray(body.data.city_distribution)).toBe(true);
    const cities = body.data.city_distribution.map(c => c.city);
    expect(cities).toContain('Минск');
  });

  test('creation_timeline is an array of entries with date and count', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/establishments?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const timeline = body.data.creation_timeline;
    expect(Array.isArray(timeline)).toBe(true);
    expect(timeline.length).toBeGreaterThan(0);
    timeline.forEach(entry => {
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('count');
    });
  });

  test('future date range → new_in_period is 0, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/establishments?from=2030-01-01&to=2030-01-31`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.new_in_period).toBe(0);
  });
});

// ============================================================================
// Hidden review exclusion (is_visible=false must be excluded from analytics)
// ============================================================================

describe('Analytics excludes hidden reviews (is_visible=false)', () => {
  let totalBeforeHidden;
  let hiddenReview;

  test('baseline: capture current review total', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    totalBeforeHidden = body.data.reviews.total;
    expect(totalBeforeHidden).toBeGreaterThanOrEqual(3);
  });

  test('create a hidden review (is_visible=false, is_deleted=false)', async () => {
    hiddenReview = await createTestReview(null, firstActiveEstablishmentId, {
      rating: 1,
      is_visible: false,
      is_deleted: false,
    });
    expect(hiddenReview.is_visible).toBe(false);
    expect(hiddenReview.is_deleted).toBe(false);
  });

  test('overview review total does NOT increase after hidden review', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/overview?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.reviews.total).toBe(totalBeforeHidden);
  });

  test('reviews timeline excludes hidden review from counts', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.total).toBe(totalBeforeHidden);
  });

  test('rating distribution excludes hidden review', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    const totalFromDist = body.data.rating_distribution.reduce(
      (sum, entry) => sum + entry.count, 0
    );
    expect(totalFromDist).toBe(totalBeforeHidden);
  });

  test('response stats exclude hidden review (total_with_response unaffected)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    // response_stats.total_with_response should not include the hidden review
    // (hidden review has no partner_response, so count should stay the same)
    expect(typeof body.data.response_stats.total_with_response).toBe('number');
    expect(body.data.response_stats.total_with_response).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// #13 — GET /api/v1/admin/analytics/reviews
// ============================================================================

describe('GET /api/v1/admin/analytics/reviews (#13)', () => {
  test('returns 200 with success: true', async () => {
    await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  test('response.data has all expected schema fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    const data = body.data;
    expect(data).toHaveProperty('review_timeline');
    expect(data).toHaveProperty('rating_distribution');
    expect(data).toHaveProperty('response_stats');
    expect(data).toHaveProperty('total');
    expect(data).toHaveProperty('new_in_period');
    expect(data).toHaveProperty('change_percent');
    expect(data).toHaveProperty('aggregation');
  });

  test('total reflects seeded reviews (at least 3)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.total).toBeGreaterThanOrEqual(3);
  });

  test('rating_distribution has exactly 5 entries (ratings 1-5)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    const dist = body.data.rating_distribution;
    expect(dist).toHaveLength(5);
    dist.forEach(entry => {
      expect(entry).toHaveProperty('rating');
      expect(entry).toHaveProperty('count');
      expect(entry).toHaveProperty('percentage');
      expect(entry.rating).toBeGreaterThanOrEqual(1);
      expect(entry.rating).toBeLessThanOrEqual(5);
    });
  });

  test('rating counts reflect seeded reviews (ratings 2, 3, 5 each have count >= 1)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    const dist = body.data.rating_distribution;
    const rating2 = dist.find(d => d.rating === 2);
    const rating3 = dist.find(d => d.rating === 3);
    const rating5 = dist.find(d => d.rating === 5);

    expect(rating2.count).toBeGreaterThanOrEqual(1);
    expect(rating3.count).toBeGreaterThanOrEqual(1);
    expect(rating5.count).toBeGreaterThanOrEqual(1);
  });

  test('rating_distribution percentages are numeric', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    body.data.rating_distribution.forEach(entry => {
      expect(typeof entry.percentage).toBe('number');
      expect(entry.percentage).toBeGreaterThanOrEqual(0);
    });
  });

  test('response_stats has all expected fields', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { response_stats } = body.data;
    expect(response_stats).toHaveProperty('total_with_response');
    expect(response_stats).toHaveProperty('response_rate');
    expect(response_stats).toHaveProperty('avg_response_time_hours');
    expect(typeof response_stats.total_with_response).toBe('number');
  });

  test('review_timeline entries have date, count, and average_rating', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const timeline = body.data.review_timeline;
    expect(Array.isArray(timeline)).toBe(true);
    expect(timeline.length).toBeGreaterThan(0);
    timeline.forEach(entry => {
      expect(entry).toHaveProperty('date');
      expect(entry).toHaveProperty('count');
      expect(entry).toHaveProperty('average_rating');
    });
  });

  test('future date range → new_in_period is 0, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}/reviews?from=2030-01-01&to=2030-01-07`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.new_in_period).toBe(0);
  });

  // Stage 6 — projection additions the «Отзывы» tab draws its first metric row
  // from. Both numbers were already computed by the very same queries and
  // reached only /overview.

  test('average_rating is projected and matches /overview', async () => {
    const [reviews, overview] = await Promise.all([
      request(app).get(`${BASE_URL}/reviews?period=7d`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(app).get(`${BASE_URL}/overview?period=7d`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);

    expect(typeof reviews.body.data.average_rating).toBe('number');
    expect(reviews.body.data.average_rating).toBe(overview.body.data.reviews.average_rating);
  });

  test('response_stats carries its own denominator', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { response_stats, total } = body.data;
    expect(typeof response_stats.total_reviews).toBe('number');
    // Same predicate as `total`, but read in one shot with the numerator so the
    // card's three numbers cannot come from two different snapshots.
    expect(response_stats.total_reviews).toBe(total);
    expect(response_stats.total_with_response)
      .toBeLessThanOrEqual(response_stats.total_reviews);
  });

  test('response_rate keeps enough precision for one decimal of a percent', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/reviews`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { response_rate, total_reviews, total_with_response } = body.data.response_stats;
    const exact = total_reviews > 0 ? total_with_response / total_reviews : 0;

    // Fixture guard. A tolerance assertion is only a test while the exact ratio
    // needs more than two decimals; on a round ratio it passes under any
    // rounding and quietly proves nothing.
    expect(Math.abs(exact - Number(exact.toFixed(2)))).toBeGreaterThan(0.0005);

    // Rounded to 4 decimals of a ratio: the displayed percent may not drift by
    // as much as 0.005pp from the division a reader can do themselves.
    expect(Math.abs(response_rate - exact)).toBeLessThanOrEqual(0.00005);
  });
});

// ============================================================================
// Resolved period window — reported so the screen header states what was queried
// ============================================================================

describe('Period window is reported back', () => {
  const endpoints = ['overview', 'users', 'establishments', 'reviews'];

  test.each(endpoints)('%s returns period.start and period.end as ISO strings', async (endpoint) => {
    const { body } = await request(app)
      .get(`${BASE_URL}/${endpoint}?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { period } = body.data;
    expect(period).toBeDefined();
    expect(new Date(period.start).toISOString()).toBe(period.start);
    expect(new Date(period.end).toISOString()).toBe(period.end);
  });

  test.each(endpoints)('%s: 7d window spans exactly 7 whole UTC days', async (endpoint) => {
    const { body } = await request(app)
      .get(`${BASE_URL}/${endpoint}?period=7d`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { period } = body.data;
    const start = new Date(period.start);
    const end = new Date(period.end);

    expect(end - start).toBe(7 * 24 * 60 * 60 * 1000);
    // Whole days measured in UTC — the ruler `DATE(created_at)` buckets by.
    expect(start.toISOString()).toMatch(/T00:00:00\.000Z$/);
    expect(end.toISOString()).toMatch(/T00:00:00\.000Z$/);
  });

  test('90d aggregates by week and buckets start on Mondays', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=90d`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.aggregation).toBe('week');

    // The bucket keys have to be the ones SQL groups by. Stepping forward from
    // the window start instead lands on a different weekday every time, the two
    // key spaces never meet, and the chart is a flat zero beside a non-zero
    // metric card. `DATE_TRUNC('week')` returns Mondays.
    const buckets = body.data.registration_timeline.map(p => p.date);
    expect(buckets.length).toBeGreaterThan(0);
    for (const bucket of buckets) {
      expect(new Date(`${bucket}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  // Daily buckets (7d, 30d) and weekly ones (90d) alike. The fixture creates
  // its users now, so every window must contain them, and the bucket sum must
  // equal the card's count: a zero total means the buckets and the rows
  // disagree. Gate run 34062250741 saw exactly that for 90d (`Expected: 13,
  // Received: 0`) between 00:00 and 03:00 Minsk on a Monday: the fixture wrote
  // `created_at` as the Minsk wall clock, so the row carried tomorrow's UTC
  // date — a new ISO week, beyond the axis. Daily buckets hit the same wall
  // every night; weekly ones only when the local date crosses into a new
  // week. Fixtures now write UTC (`tests/utils/auth.js` `utcTimestamp`), and
  // this holds under any process timezone. Proven red on the old helper under
  // TZ=GMT+15:59 (local date ahead of UTC): 7d and 30d dropped every row.
  test.each(['7d', '30d', '90d'])('%s timeline carries the users it counted', async (period) => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=${period}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const inTimeline = body.data.registration_timeline
      .reduce((sum, p) => sum + p.count, 0);
    expect(inTimeline).toBe(body.data.new_in_period);
    expect(inTimeline).toBeGreaterThan(0);
  });

  test('custom range includes the last day named by `to`', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?from=2026-03-01&to=2026-03-05`)
      .set('Authorization', `Bearer ${adminToken}`);

    const { period } = body.data;
    expect(period.start).toBe('2026-03-01T00:00:00.000Z');
    // Exclusive bound sits at the midnight after 5 March, so 5 March is in.
    expect(period.end).toBe('2026-03-06T00:00:00.000Z');
  });
});

// ============================================================================
// Refused input — a question declined beats an answer that looks like data
// ============================================================================

describe('Invalid period parameters', () => {
  const badRequests = [
    ['month out of range', 'from=2026-13-45&to=2026-13-46'],
    ['day out of range', 'from=2026-02-30&to=2026-03-01'],
    ['start after end', 'from=2026-08-10&to=2026-08-01'],
    ['unparseable', 'from=вчера&to=сегодня'],
  ];

  test.each(badRequests)('%s → 400', async (_label, query) => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?${query}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(body.error?.code ?? body.code).toBe('INVALID_PERIOD');
  });

  test('negative period is refused, not silently inverted', async () => {
    await request(app)
      .get(`${BASE_URL}/users?period=-5d`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);
  });

  test('a rolled-over date is not answered as if it were real', async () => {
    // `Date.UTC(2026, 12, 45)` is a valid instant — 14 February 2027 — so the
    // request used to succeed and report a window nobody asked for.
    const res = await request(app)
      .get(`${BASE_URL}/users?from=2026-13-45&to=2026-13-46`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.data).toBeUndefined();
  });

  test('unknown period code still falls back to 30 days', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}/users?period=all`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const span = new Date(body.data.period.end) - new Date(body.data.period.start);
    expect(span).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
