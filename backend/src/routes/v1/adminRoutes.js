/**
 * Admin Routes
 *
 * Defines admin-specific API endpoints:
 * - Authentication with stricter rate limiting
 * - Moderation workflow (list pending, view details, approve/reject)
 *
 * All admin routes are mounted at /api/v1/admin/*
 *
 * Two access tiers (config/panelRoles.js, SDL CAT-C-2.11, 2026-09-08):
 *   readAccess  — admin + viewer: every GET that only shows data
 *   writeAccess — admin only: every mutation, plus reads that exist only to
 *                 serve one (users/search feeds "assign a partner")
 * The split is checked statically by tests/unit/adminRoutesAccessTiers.test.js:
 * a route without a tier, or a GET under writeAccess outside the allow-list
 * kept there, fails the gate. Do not reintroduce a raw authorize call with an
 * inline role list here — the guard treats that as a third, unnamed tier.
 */

import express from 'express';
import * as adminController from '../../controllers/adminController.js';
import * as adminModerationController from '../../controllers/adminModerationController.js';
import * as analyticsController from '../../controllers/analyticsController.js';
import * as auditLogController from '../../controllers/auditLogController.js';
import * as adminReviewController from '../../controllers/adminReviewController.js';
import * as adminMenuItemController from '../../controllers/adminMenuItemController.js';
import * as qualityHealthController from '../../controllers/qualityHealthController.js';
import * as badgesController from '../../controllers/badgesController.js';
import { validateLogin } from '../../validators/authValidation.js';
import { createRateLimiter } from '../../middleware/rateLimiter.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { PANEL_READ_ROLES, PANEL_ACTION_ROLES } from '../../config/panelRoles.js';

const router = express.Router();

/** Read tier: admin and viewer. */
const readAccess = authorize(PANEL_READ_ROLES);
/** Action tier: admin only. */
const writeAccess = authorize(PANEL_ACTION_ROLES);

// ============================================================================
// Authentication (public — no auth required)
// ============================================================================

/**
 * POST /api/v1/admin/auth/login
 *
 * Admin login endpoint. Uses the same validation as standard login
 * but with stricter rate limiting (5 req/min vs 10 for regular users)
 * and an additional role check in the controller.
 *
 * Middleware chain:
 * 1. Rate limiter: 5 requests per minute per IP (strict for admin)
 * 2. Validation: Reuses validateLogin (email/phone format + password presence)
 * 3. Controller: Verify credentials + check admin role + generate tokens
 */
router.post(
  '/auth/login',
  createRateLimiter({
    limit: 5,
    windowSeconds: 60,
    keyPrefix: 'admin-login',
  }),
  validateLogin,
  adminController.adminLogin,
);

// ============================================================================
// Moderation (protected — readAccess for lists and cards, writeAccess for actions)
// ============================================================================

/**
 * GET /api/v1/admin/establishments/pending
 *
 * List establishments awaiting moderation review.
 * Query: ?page=1&per_page=20
 */
router.get(
  '/establishments/pending',
  authenticate,
  readAccess,
  adminModerationController.listPendingEstablishments,
);

// ============================================================================
// Segment C: Active, Rejected, Search (must be BEFORE :id param route)
// ============================================================================

/**
 * GET /api/v1/admin/establishments/active
 *
 * List active (approved) establishments.
 * Query: ?page=1&per_page=20&sort=newest&city=Минск&search=name
 */
router.get(
  '/establishments/active',
  authenticate,
  readAccess,
  adminModerationController.listActiveEstablishments,
);

/**
 * GET /api/v1/admin/establishments/rejected
 *
 * List rejection history from audit log.
 * Query: ?page=1&per_page=20
 */
router.get(
  '/establishments/rejected',
  authenticate,
  readAccess,
  adminModerationController.listRejectedEstablishments,
);

/**
 * GET /api/v1/admin/establishments/suspended
 *
 * List suspended establishments.
 * Query: ?page=1&per_page=20
 */
router.get(
  '/establishments/suspended',
  authenticate,
  readAccess,
  adminModerationController.listSuspendedEstablishments,
);

/**
 * GET /api/v1/admin/establishments/search
 *
 * Search establishments across all statuses.
 * Query: ?search=name (required) &status=active&city=Минск&page=1&per_page=20
 */
router.get(
  '/establishments/search',
  authenticate,
  readAccess,
  adminModerationController.searchEstablishments,
);

// ============================================================================
// Establishment detail and actions (parameterized :id routes)
// ============================================================================

/**
 * GET /api/v1/admin/establishments/:id
 *
 * Get full establishment details for moderation review.
 * Returns data organized for four-tab display.
 */
router.get(
  '/establishments/:id',
  authenticate,
  readAccess,
  adminModerationController.getEstablishmentDetails,
);

/**
 * POST /api/v1/admin/establishments/:id/moderate
 *
 * Execute moderation action (approve or reject).
 * Body: { action: "approve"|"reject", moderation_notes: { field: "comment" } }
 */
router.post(
  '/establishments/:id/moderate',
  authenticate,
  writeAccess,
  adminModerationController.moderateEstablishment,
);

/**
 * POST /api/v1/admin/establishments/:id/suspend
 *
 * Suspend an active establishment.
 * Body: { reason: "string" }
 */
router.post(
  '/establishments/:id/suspend',
  authenticate,
  writeAccess,
  adminModerationController.suspendEstablishment,
);

/**
 * POST /api/v1/admin/establishments/:id/unsuspend
 *
 * Reactivate a suspended establishment.
 */
router.post(
  '/establishments/:id/unsuspend',
  authenticate,
  writeAccess,
  adminModerationController.unsuspendEstablishment,
);

/**
 * PATCH /api/v1/admin/establishments/:id/coordinates
 *
 * Update establishment coordinates (admin correction).
 * Body: { latitude: number, longitude: number }
 */
router.patch(
  '/establishments/:id/coordinates',
  authenticate,
  writeAccess,
  adminModerationController.updateCoordinates,
);

/**
 * PATCH /api/v1/admin/establishments/:id/slug
 *
 * Update establishment slug (admin correction).
 * Body: { slug: string }
 */
router.patch(
  '/establishments/:id/slug',
  authenticate,
  writeAccess,
  adminModerationController.updateSlug,
);

/**
 * POST /api/v1/admin/establishments/:id/claim
 *
 * Transfer establishment ownership to a target user.
 * User is automatically upgraded to partner role.
 * Body: { user_id: "UUID of target user" }
 */
router.post(
  '/establishments/:id/claim',
  authenticate,
  writeAccess,
  adminModerationController.claimEstablishment,
);

// ============================================================================
// User search (for claiming UI)
// ============================================================================

/**
 * GET /api/v1/admin/users/search?q=email_or_name
 *
 * Search users by email or name (for claim dialog).
 *
 * Action tier on purpose although it is a GET: the search exists only to
 * serve "assign a partner" and returns e-mails and phones of platform users.
 * A viewer has no action to serve with it. Listed in the allow-list of
 * tests/unit/adminRoutesAccessTiers.test.js.
 */
router.get(
  '/users/search',
  authenticate,
  writeAccess,
  adminModerationController.searchUsers,
);

// ============================================================================
// User management
// ============================================================================

/**
 * POST /api/v1/admin/users/:id/upgrade-to-partner
 *
 * Upgrade a regular user to partner role (without claiming).
 */
router.post(
  '/users/:id/upgrade-to-partner',
  authenticate,
  writeAccess,
  adminModerationController.upgradeToPartner,
);

// ============================================================================
// Segment D: Analytics & Dashboard
// ============================================================================

/**
 * GET /api/v1/admin/analytics/overview
 *
 * Dashboard overview metrics (users, establishments, reviews, moderation).
 * Query: ?period=7d|30d|90d  or  ?from=2026-01-01&to=2026-01-31
 */
router.get(
  '/analytics/overview',
  authenticate,
  readAccess,
  analyticsController.getOverview,
);

/**
 * GET /api/v1/admin/analytics/users
 *
 * User analytics: registration timeline, role distribution.
 * Query: ?period=30d
 */
router.get(
  '/analytics/users',
  authenticate,
  readAccess,
  analyticsController.getUsersAnalytics,
);

/**
 * GET /api/v1/admin/analytics/establishments
 *
 * Establishment analytics: creation timeline, status/city/category distributions.
 * Query: ?period=30d
 */
router.get(
  '/analytics/establishments',
  authenticate,
  readAccess,
  analyticsController.getEstablishmentsAnalytics,
);

/**
 * GET /api/v1/admin/analytics/reviews
 *
 * Review analytics: review timeline, rating distribution, response stats.
 * Query: ?period=30d
 */
router.get(
  '/analytics/reviews',
  authenticate,
  readAccess,
  analyticsController.getReviewsAnalytics,
);

// ============================================================================
// Segment E: Reviews Management
// ============================================================================

/**
 * GET /api/v1/admin/reviews
 *
 * List all reviews (admin view — includes deleted/hidden).
 * Query: ?page=1&per_page=20&status=visible|hidden|deleted&rating=1-5
 *        &search=text&sort=newest|oldest|rating_high|rating_low
 *        &establishment_id=uuid&user_id=uuid&from=date&to=date
 */
router.get(
  '/reviews',
  authenticate,
  readAccess,
  adminReviewController.listReviews,
);

/**
 * POST /api/v1/admin/reviews/:id/toggle-visibility
 *
 * Toggle review visibility (is_visible = NOT is_visible).
 * Writes audit_log entry.
 */
router.post(
  '/reviews/:id/toggle-visibility',
  authenticate,
  writeAccess,
  adminReviewController.toggleVisibility,
);

/**
 * POST /api/v1/admin/reviews/:id/delete
 *
 * Soft-delete a review and recalculate establishment aggregates.
 * Body: { reason: "string" } (optional)
 * Writes audit_log entry.
 */
router.post(
  '/reviews/:id/delete',
  authenticate,
  writeAccess,
  adminReviewController.deleteReview,
);

// ============================================================================
// Segment B: Menu-item moderation (Smart Search Этап 2)
// ============================================================================

/**
 * GET /api/v1/admin/menu-items/flagged
 *
 * List parsed menu items flagged by the OCR sanity checker.
 * Query: ?page=1&per_page=20&reason=price_below_threshold
 */
router.get(
  '/menu-items/flagged',
  authenticate,
  readAccess,
  adminMenuItemController.listFlaggedMenuItems,
);

/**
 * POST /api/v1/admin/menu-items/:id/hide
 *
 * Hide a menu item from user-facing search (moderator action).
 * Body: { reason: string }
 */
router.post(
  '/menu-items/:id/hide',
  authenticate,
  writeAccess,
  adminMenuItemController.hideMenuItem,
);

/**
 * POST /api/v1/admin/menu-items/:id/unhide
 *
 * Reverse a prior hide action — menu item reappears in search.
 */
router.post(
  '/menu-items/:id/unhide',
  authenticate,
  writeAccess,
  adminMenuItemController.unhideMenuItem,
);

/**
 * POST /api/v1/admin/menu-items/:id/dismiss-flag
 *
 * Clear sanity_flag on a menu item (mark as false positive).
 * Does NOT affect is_hidden_by_admin.
 */
router.post(
  '/menu-items/:id/dismiss-flag',
  authenticate,
  writeAccess,
  adminMenuItemController.dismissMenuItemFlag,
);

// ============================================================================
// Segment E: Audit Log
// ============================================================================

/**
 * GET /api/v1/admin/audit-log
 *
 * Paginated audit log entries with admin info and action summary.
 * Query: ?page=1&per_page=20&action=moderate_approve&entity_type=establishment
 *        &user_id=uuid&from=2026-01-01&to=2026-01-31&sort=newest&include_metadata=true
 */
router.get(
  '/audit-log',
  authenticate,
  readAccess,
  auditLogController.listAuditLog,
);

// ============================================================================
// Segment F: Quality Health (AI-ops Brick-1 — Tier-0 immunity, read-only)
// ============================================================================

/**
 * GET /api/v1/admin/quality/health
 *
 * Read-only quality-immunity snapshot over active establishments: canon/slug
 * reachability, menu completeness, geo bounds, working-hours sanity, attribute
 * census, hanging OCR flags. Zero writes, zero LLM.
 */
router.get(
  '/quality/health',
  authenticate,
  readAccess,
  qualityHealthController.getHealth,
);

// ============================================================================
// Segment G: Badges (счётчики очередей для рейла админки)
// ============================================================================

/**
 * GET /api/v1/admin/badges
 *
 * Размеры очередей одним запросом: заведения на модерации и приостановленные,
 * висящие флаги позиций меню. Рейл живёт в шелле и спрашивает счётчики на
 * каждом экране — отсюда кэш 30 с в сервисе. Read-only.
 */
router.get(
  '/badges',
  authenticate,
  readAccess,
  badgesController.getBadges,
);

export default router;
