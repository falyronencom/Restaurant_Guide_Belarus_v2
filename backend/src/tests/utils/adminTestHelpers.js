/* eslint comma-dangle: 0 */
/**
 * Admin Test Helpers
 *
 * Utility functions for admin endpoint tests.
 * Follows the same patterns as auth.js and database.js in this directory.
 *
 * Used by:
 *   - admin-auth.test.js
 *   - admin-authorization.test.js
 *   - admin-moderation.test.js
 */

import { randomUUID } from 'crypto';
import { createUserAndGetTokens } from './auth.js';
import { query } from './database.js';
import { testUsers } from '../fixtures/users.js';

// ============================================================================
// Credentials for login endpoint testing
// ============================================================================

/**
 * Known admin credentials — used to test POST /api/v1/admin/auth/login.
 * Mirrors testUsers.admin from fixtures/users.js.
 */
export const ADMIN_CREDENTIALS = {
  email: testUsers.admin.email,
  password: testUsers.admin.password,
};

/**
 * Known viewer credentials — the read-only panel role (migration 034).
 * Mirrors testUsers.viewer from fixtures/users.js.
 */
export const VIEWER_CREDENTIALS = {
  email: testUsers.viewer.email,
  password: testUsers.viewer.password,
};

// ============================================================================
// User creation helpers
// ============================================================================

/**
 * Create an admin user and return { user, accessToken, refreshToken }.
 * Reuses testUsers.admin fixture from fixtures/users.js.
 *
 * @returns {Promise<{ user: Object, accessToken: string, refreshToken: string }>}
 */
export async function createAdminAndGetToken() {
  return createUserAndGetTokens(testUsers.admin);
}

/**
 * Create a viewer (read-only panel role) and return { user, accessToken, refreshToken }.
 * Reuses testUsers.viewer fixture from fixtures/users.js.
 *
 * @returns {Promise<{ user: Object, accessToken: string, refreshToken: string }>}
 */
export async function createViewerAndGetToken() {
  return createUserAndGetTokens(testUsers.viewer);
}

// ============================================================================
// Establishment creation helpers
// ============================================================================

const DEFAULT_WORKING_HOURS = JSON.stringify({
  monday: { open: '10:00', close: '22:00' },
  tuesday: { open: '10:00', close: '22:00' },
  wednesday: { open: '10:00', close: '22:00' },
  thursday: { open: '10:00', close: '22:00' },
  friday: { open: '10:00', close: '23:00' },
  saturday: { open: '11:00', close: '23:00' },
  sunday: { open: '11:00', close: '22:00' },
});

/**
 * Create a partner user and an establishment with the specified status.
 * Each call creates a unique partner email to avoid DB unique constraint conflicts.
 *
 * @param {'draft'|'pending'|'active'|'suspended'|'archived'} status
 * @returns {Promise<{ partner: { user, accessToken }, establishment: Object }>}
 */
export async function createPartnerWithEstablishment(status = 'pending') {
  const partner = await createUserAndGetTokens({
    email: `partner-${randomUUID()}@test.com`,
    phone: null,
    password: 'Partner123!@#',
    name: 'Test Partner',
    role: 'partner',
    authMethod: 'email',
  });

  const establishmentId = randomUUID();
  const slug = `test-${establishmentId.slice(0, 8)}`;

  const result = await query(
    `INSERT INTO establishments (
      id, partner_id, name, slug, description, city, address,
      latitude, longitude, categories, cuisines, price_range,
      working_hours, status, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
    RETURNING *`,
    [
      establishmentId,
      partner.user.id,
      'Test Establishment',
      slug,
      'Test description for moderation',
      'Минск',
      'ул. Тестовая 1',
      53.9,
      27.5,
      ['Ресторан'],
      ['Европейская'],
      '$$',
      DEFAULT_WORKING_HOURS,
      status,
    ],
  );

  return {
    partner,
    establishment: result.rows[0],
  };
}

// ============================================================================
// Review creation helpers
// ============================================================================

/**
 * Create a test review directly in the database.
 * Used by admin-reviews.test.js to set up test data.
 *
 * The reviews table has a UNIQUE(user_id, establishment_id) constraint.
 * Pass userId=null to auto-create a fresh unique user, avoiding constraint
 * violations in tests that need multiple reviews for the same establishment.
 *
 * @param {string|null} userId - UUID of the reviewing user, or null to auto-create
 * @param {string} establishmentId - UUID of the reviewed establishment
 * @param {Object} overrides - Optional field overrides { rating, content, is_visible, is_deleted }
 * @returns {Promise<Object>} Created review record
 */
export async function createTestReview(userId, establishmentId, overrides = {}) {
  let effectiveUserId = userId;

  // Auto-create a fresh user when none provided — avoids UNIQUE(user_id, establishment_id)
  // violations in tests that create multiple reviews for the same establishment
  if (!effectiveUserId) {
    const { createUserAndGetTokens } = await import('./auth.js');
    const freshUser = await createUserAndGetTokens({
      email: `review-author-${randomUUID()}@test.com`,
      phone: null,
      password: 'User123!@#',
      name: 'Test Author',
      role: 'user',
      authMethod: 'email',
    });
    effectiveUserId = freshUser.user.id;
  }

  const reviewId = randomUUID();
  const rating = overrides.rating ?? 4;
  const content = overrides.content ?? 'Test review content for admin testing';
  const isVisible = overrides.is_visible ?? true;
  const isDeleted = overrides.is_deleted ?? false;
  // Ответ партнёра. По умолчанию его нет — существующие вызовы не меняются.
  // Метка времени ставится только вместе с текстом: строка с `partner_response_at`
  // и без ответа попала бы в среднее время ответа, которого не было.
  const partnerResponse = overrides.partner_response ?? null;
  const partnerResponseHours = overrides.partner_response_hours ?? 0;

  const result = await query(
    `INSERT INTO reviews (
       id, user_id, establishment_id, rating, content, text,
       is_visible, is_deleted, partner_response, partner_response_at,
       created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $5,
       $6, $7, $8,
       CASE WHEN $8::text IS NULL THEN NULL ELSE NOW() + ($9 || ' hours')::interval END,
       NOW(), NOW()
     )
     RETURNING *`,
    [
      reviewId, effectiveUserId, establishmentId, rating, content,
      isVisible, isDeleted, partnerResponse, String(partnerResponseHours),
    ],
  );

  return result.rows[0];
}

// ============================================================================
// Database query helpers
// ============================================================================

/**
 * Fetch an establishment record directly from the DB (bypasses API).
 * Used in assertions to verify DB state after moderation actions.
 *
 * @param {string} establishmentId
 * @returns {Promise<Object|null>}
 */
export async function getEstablishmentFromDb(establishmentId) {
  const result = await query(
    'SELECT * FROM establishments WHERE id = $1',
    [establishmentId],
  );
  return result.rows[0] || null;
}

/**
 * Check if an audit_log entry exists for a given entity + action.
 *
 * Возвращает строго boolean. Терпимость к отсутствию таблицы (null) снята
 * 2026-08-25: audit_log создаётся миграцией 010 и входит в production_schema,
 * то есть развёрнут локально, в CI и на проде. Она перестала что-либо включать
 * и начала прятать: guard-условия на null делали около 25 проверок аудита
 * молча пропускаемыми, а в ocr-end-to-end целый блок не исполнялся ни разу.
 *
 * @param {string} entityId
 * @param {string} action - e.g. 'moderate_approve', 'suspend_establishment'
 * @returns {Promise<boolean>}
 */
export async function checkAuditLogExists(entityId, action) {
  const result = await query(
    'SELECT id FROM audit_log WHERE entity_id = $1 AND action = $2 LIMIT 1',
    [entityId, action],
  );
  return result.rows.length > 0;
}
