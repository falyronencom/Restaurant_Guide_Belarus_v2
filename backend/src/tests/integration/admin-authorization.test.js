/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Authorization Security Tests
 *
 * Verifies that the authenticate → tier middleware chain is correctly
 * applied across the admin route groups. Two tiers (config/panelRoles.js):
 *   readAccess  — admin + viewer (every GET that only shows data)
 *   writeAccess — admin only (every mutation, plus reads that serve one)
 *
 * For each representative endpoint, tests:
 *   1. No token             → 401 MISSING_TOKEN
 *   2. Invalid token        → 401 MALFORMED_TOKEN
 *   3. Valid user token     → 403 FORBIDDEN
 *   4. Valid partner token  → 403 FORBIDDEN
 *   5. Valid viewer token   → passes on the read tier, 403 on the action tier
 *   6. Valid admin token    → not 401/403 (auth passes)
 *
 * Read tier (one route per group):
 *   - Moderation:   GET /api/v1/admin/establishments/pending
 *   - Analytics:    GET /api/v1/admin/analytics/overview
 *   - Reviews:      GET /api/v1/admin/reviews
 *   - Audit Log:    GET /api/v1/admin/audit-log
 * Action tier:
 *   - POST /api/v1/admin/establishments/:id/suspend
 *   - POST /api/v1/admin/reviews/:id/delete
 *   - GET  /api/v1/admin/users/search — a read kept admin-only on purpose:
 *     it serves "assign a partner" and returns e-mails and phones of users
 *
 * The full classification of every route is guarded statically by
 * tests/unit/adminRoutesAccessTiers.test.js; this file proves the tiers
 * behave over HTTP for real tokens.
 */

import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { clearAllData } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';
import {
  createAdminAndGetToken,
  createViewerAndGetToken,
} from '../utils/adminTestHelpers.js';

let adminToken;
let viewerToken;
let userToken;
let partnerToken;

beforeAll(async () => {
  const admin = await createAdminAndGetToken();
  const viewer = await createViewerAndGetToken();
  const user = await createUserAndGetTokens(testUsers.regularUser);
  const partner = await createUserAndGetTokens(testUsers.partner);

  adminToken = admin.accessToken;
  viewerToken = viewer.accessToken;
  userToken = user.accessToken;
  partnerToken = partner.accessToken;
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// Helper: generate auth tests for one endpoint
// ============================================================================

/**
 * Creates a suite of authorization tests for a single admin endpoint.
 * Called inside a parent describe block.
 *
 * @param {'get'|'post'} method
 * @param {string} path
 * @param {'read'|'action'} tier - which tier the route is expected to sit in
 */
function authSuiteFor(method, path, tier) {
  const label = `${method.toUpperCase()} ${path}`;

  describe(label, () => {
    test('should return 401 MISSING_TOKEN when no token provided', async () => {
      const response = await request(app)[method](path).expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_TOKEN');
    });

    test('should return 401 when token is malformed / invalid', async () => {
      const response = await request(app)[method](path)
        .set('Authorization', 'Bearer this.is.not.a.real.jwt')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(['MALFORMED_TOKEN', 'INVALID_TOKEN']).toContain(
        response.body.error.code,
      );
    });

    test('should return 403 FORBIDDEN for regular user token', async () => {
      const response = await request(app)[method](path)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    test('should return 403 FORBIDDEN for partner token', async () => {
      const response = await request(app)[method](path)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    if (tier === 'read') {
      test('should pass auth (not 401/403) for valid viewer token', async () => {
        const response = await request(app)[method](path)
          .set('Authorization', `Bearer ${viewerToken}`);

        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
      });
    } else {
      test('should return 403 FORBIDDEN for viewer token', async () => {
        const response = await request(app)[method](path)
          .set('Authorization', `Bearer ${viewerToken}`)
          .expect(403);

        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe('FORBIDDEN');
      });
    }

    test('should pass auth (not 401/403) for valid admin token', async () => {
      const response = await request(app)[method](path)
        .set('Authorization', `Bearer ${adminToken}`);

      // We only verify auth passes — endpoint may return any 2xx/4xx/5xx
      // depending on data state (empty DB, unknown id, missing body, etc.)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });
  });
}

// ============================================================================
// Read tier — one endpoint per route group
// ============================================================================

describe('Admin Authorization — Moderation Group', () => {
  authSuiteFor('get', '/api/v1/admin/establishments/pending', 'read');
});

describe('Admin Authorization — Analytics Group', () => {
  authSuiteFor('get', '/api/v1/admin/analytics/overview', 'read');
});

describe('Admin Authorization — Reviews Group', () => {
  authSuiteFor('get', '/api/v1/admin/reviews', 'read');
});

describe('Admin Authorization — Audit Log Group', () => {
  authSuiteFor('get', '/api/v1/admin/audit-log', 'read');
});

// ============================================================================
// Action tier — the viewer stops at the door, the admin gets through
// ============================================================================

describe('Admin Authorization — Action tier', () => {
  // Unknown ids: the admin reaches the controller (404 / 400), which is all
  // this file asserts; the viewer must never get that far.
  authSuiteFor('post', `/api/v1/admin/establishments/${randomUUID()}/suspend`, 'action');
  authSuiteFor('post', `/api/v1/admin/reviews/${randomUUID()}/delete`, 'action');
  authSuiteFor('get', '/api/v1/admin/users/search?q=test', 'action');
});
