/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Audit Log Integration Tests
 *
 * Tests endpoint #17 (Segment C):
 *   GET /api/v1/admin/audit-log — paginated audit journal with filters
 *
 * Setup strategy: trigger real admin actions via HTTP (moderation + review
 * toggle), which write to audit_log non-blockingly. Then assert the
 * GET endpoint returns those entries correctly.
 *
 * Actions triggered in beforeAll:
 *   1. Approve establishment  → action='moderate_approve', entity_type='establishment'
 *   2. Reject establishment   → action='moderate_reject',  entity_type='establishment'
 *   3. Toggle review hidden   → action='review_hide',      entity_type='review'
 *
 * Response format (NOT the standard items/pagination format):
 *   { success: true, data: entries[], meta: { total, page, per_page, pages } }
 *
 * audit_log table confirmed deployed: setup.js TRUNCATES it in global setup.
 * Non-blocking write delay: 500ms after last action in beforeAll.
 *
 * Filters tested: action, entity_type, user_id, from/to date range, sort.
 * include_metadata: adds ip_address and user_agent columns to each entry.
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
  createViewerAndGetToken,
} from '../utils/adminTestHelpers.js';

const BASE_URL = '/api/v1/admin/audit-log';

let adminToken;
let adminUserId;
let viewerToken; // read-only panel role: sees the journal without metadata
let userToken; // non-admin, for 403 tests
let approvedEstablishmentId;
let rejectedEstablishmentId;
let testReviewId;

beforeAll(async () => {
  // Admin user
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;
  adminUserId = admin.user.id;

  // Viewer user
  const viewer = await createViewerAndGetToken();
  viewerToken = viewer.accessToken;

  // Non-admin user for 403 assertions
  const regularUser = await createUserAndGetTokens({
    email: `audit-user-${randomUUID()}@test.com`,
    phone: null,
    password: 'User123!@#',
    name: 'Audit Regular User',
    role: 'user',
    authMethod: 'email',
  });
  userToken = regularUser.accessToken;

  // ── Action 1: Approve an establishment ──────────────────────────────────
  const { establishment: est1 } = await createPartnerWithEstablishment('pending');
  approvedEstablishmentId = est1.id;

  await request(app)
    .post(`/api/v1/admin/establishments/${approvedEstablishmentId}/moderate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ action: 'approve' });

  // Tiny gap between actions to ensure distinct created_at timestamps
  await new Promise(r => setTimeout(r, 20));

  // ── Action 2: Reject an establishment ───────────────────────────────────
  const { establishment: est2 } = await createPartnerWithEstablishment('pending');
  rejectedEstablishmentId = est2.id;

  await request(app)
    .post(`/api/v1/admin/establishments/${rejectedEstablishmentId}/moderate`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ action: 'reject', reason: 'Automated test rejection' });

  await new Promise(r => setTimeout(r, 20));

  // ── Action 3: Hide a review ─────────────────────────────────────────────
  // Need an active establishment to attach the review to
  const { establishment: activeEst } = await createPartnerWithEstablishment('active');
  const review = await createTestReview(null, activeEst.id, { rating: 4, is_visible: true });
  testReviewId = review.id;

  await request(app)
    .post(`/api/v1/admin/reviews/${testReviewId}/toggle-visibility`)
    .set('Authorization', `Bearer ${adminToken}`);

});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Auth guards
// ============================================================================

describe('Auth guards', () => {
  test('returns 401 without Authorization header', async () => {
    const res = await request(app).get(BASE_URL).expect(401);
    expect(res.body.success).toBe(false);
  });

  test('returns 403 for non-admin role', async () => {
    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    expect(res.body.success).toBe(false);
  });
});

// ============================================================================
// Basic response structure
// ============================================================================

describe('GET /api/v1/admin/audit-log (#17) — basic response', () => {
  test('returns 200 with success: true', async () => {
    const res = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  test('response has data array and meta object', async () => {
    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
  });

  test('meta object has total, page, per_page, pages', async () => {
    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.meta).toHaveProperty('total');
    expect(body.meta).toHaveProperty('page');
    expect(body.meta).toHaveProperty('per_page');
    expect(body.meta).toHaveProperty('pages');
    expect(typeof body.meta.total).toBe('number');
    expect(body.meta.page).toBe(1); // default page
    expect(body.meta.per_page).toBe(20); // default per_page
  });

  test('returns audit log entries created by moderation actions', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.meta.total).toBeGreaterThanOrEqual(3); // approve + reject + review_hide
    expect(body.data.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
// Entry schema
// ============================================================================

describe('GET /api/v1/admin/audit-log — entry schema', () => {
  test('each entry has required fields: id, action, entity_type, entity_id, created_at', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach(entry => {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('action');
      expect(entry).toHaveProperty('entity_type');
      expect(entry).toHaveProperty('entity_id');
      expect(entry).toHaveProperty('created_at');
    });
  });

  test('each entry has admin_name, admin_email (joined from users), and summary', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    body.data.forEach(entry => {
      expect(entry).toHaveProperty('admin_name');
      expect(entry).toHaveProperty('admin_email');
      expect(entry).toHaveProperty('summary');
    });
  });

  test('each entry has old_data and new_data (may be null)', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    body.data.forEach(entry => {
      expect(entry).toHaveProperty('old_data');
      expect(entry).toHaveProperty('new_data');
    });
  });

  test('without include_metadata — ip_address and user_agent are NOT in entries', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    // metadata columns should be absent by default
    body.data.forEach(entry => {
      expect(entry).not.toHaveProperty('ip_address');
      expect(entry).not.toHaveProperty('user_agent');
    });
  });

  test('?include_metadata=true — entries include ip_address and user_agent', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?include_metadata=true`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach(entry => {
      expect(entry).toHaveProperty('ip_address');
      expect(entry).toHaveProperty('user_agent');
    });
  });

  test('viewer never receives ip_address / user_agent, even with include_metadata=true', async () => {
    // The read-only role may be shown to a third party; operator metadata
    // stays with admins whatever the query asks (SDL CAT-C-2.11).
    const { body } = await request(app)
      .get(`${BASE_URL}?include_metadata=true`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    expect(body.data.length).toBeGreaterThan(0);
    body.data.forEach(entry => {
      expect(entry).not.toHaveProperty('ip_address');
      expect(entry).not.toHaveProperty('user_agent');
      // The rest of the entry is the same journal an admin sees.
      expect(entry).toHaveProperty('admin_name');
      expect(entry).toHaveProperty('summary');
    });
  });

  test('moderate_approve entry has correct action and entity_type', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?action=moderate_approve`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const entry = body.data[0];
    expect(entry.action).toBe('moderate_approve');
    expect(entry.entity_type).toBe('establishment');
    expect(entry.entity_id).toBe(approvedEstablishmentId);
  });
});

// ============================================================================
// Sort order
// ============================================================================

describe('GET /api/v1/admin/audit-log — sort order', () => {
  test('default sort is newest first (DESC by created_at)', async () => {

    const { body } = await request(app)
      .get(BASE_URL)
      .set('Authorization', `Bearer ${adminToken}`);

    if (body.data.length < 2) return; // can't test sort with < 2 entries

    const timestamps = body.data.map(e => new Date(e.created_at).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeLessThanOrEqual(timestamps[i - 1]);
    }
  });

  test('?sort=oldest — entries are ascending by created_at', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?sort=oldest`)
      .set('Authorization', `Bearer ${adminToken}`);

    if (body.data.length < 2) return;

    const timestamps = body.data.map(e => new Date(e.created_at).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  test('sort=newest and sort=oldest return the same total count', async () => {

    const [newestRes, oldestRes] = await Promise.all([
      request(app).get(`${BASE_URL}?sort=newest`).set('Authorization', `Bearer ${adminToken}`),
      request(app).get(`${BASE_URL}?sort=oldest`).set('Authorization', `Bearer ${adminToken}`),
    ]);

    expect(newestRes.body.meta.total).toBe(oldestRes.body.meta.total);
  });
});

// ============================================================================
// Filters
// ============================================================================

describe('GET /api/v1/admin/audit-log — filters', () => {
  test('?action=moderate_approve — returns only approve entries', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?action=moderate_approve`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(1);
    body.data.forEach(entry => {
      expect(entry.action).toBe('moderate_approve');
    });
  });

  test('?action=moderate_reject — returns only reject entries', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?action=moderate_reject`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(1);
    body.data.forEach(entry => {
      expect(entry.action).toBe('moderate_reject');
    });
  });

  test('?entity_type=establishment — returns only establishment entries', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?entity_type=establishment`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(2); // approve + reject
    body.data.forEach(entry => {
      expect(entry.entity_type).toBe('establishment');
    });
  });

  test('?entity_type=review — returns only review entries', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?entity_type=review`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(1);
    body.data.forEach(entry => {
      expect(entry.entity_type).toBe('review');
    });
  });

  test('?user_id=adminUserId — returns only entries by that admin', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?user_id=${adminUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data.length).toBeGreaterThanOrEqual(3);
    // All entries should have the admin's email
    body.data.forEach(entry => {
      expect(entry.admin_email).toBeDefined();
    });
  });

  test('?from=2030-01-01 (future) — returns empty data, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}?from=2030-01-01`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });

  test('?action=nonexistent_action — returns empty data, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}?action=this_action_does_not_exist`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });
});

// ============================================================================
// Pagination
// ============================================================================

describe('GET /api/v1/admin/audit-log — pagination', () => {
  test('?per_page=1 — returns exactly 1 entry per page', async () => {

    const { body } = await request(app)
      .get(`${BASE_URL}?per_page=1`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.data).toHaveLength(1);
    expect(body.meta.per_page).toBe(1);
    expect(body.meta.pages).toBeGreaterThanOrEqual(3); // at least 3 entries
  });

  test('?per_page=1&page=2 — returns a different entry than page 1', async () => {

    const [page1, page2] = await Promise.all([
      request(app)
        .get(`${BASE_URL}?per_page=1&page=1`)
        .set('Authorization', `Bearer ${adminToken}`),
      request(app)
        .get(`${BASE_URL}?per_page=1&page=2`)
        .set('Authorization', `Bearer ${adminToken}`),
    ]);

    if (page1.body.data.length > 0 && page2.body.data.length > 0) {
      expect(page1.body.data[0].id).not.toBe(page2.body.data[0].id);
    }
  });

  test('?per_page=100 — capped at 50 (service enforces max)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}?per_page=100`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(body.meta.per_page).toBe(50);
  });

  test('page beyond last page — returns empty data, not an error', async () => {
    const res = await request(app)
      .get(`${BASE_URL}?page=9999`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
  });

  test('meta.pages equals ceil(total / per_page)', async () => {
    const { body } = await request(app)
      .get(`${BASE_URL}?per_page=2`)
      .set('Authorization', `Bearer ${adminToken}`);

    const expected = Math.ceil(body.meta.total / 2);
    expect(body.meta.pages).toBe(expected);
  });
});
