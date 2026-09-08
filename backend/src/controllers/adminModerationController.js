/**
 * Admin Moderation Controller
 *
 * HTTP handlers for admin moderation endpoints.
 * Thin layer: extracts request data, delegates to adminService, formats response.
 *
 * Endpoints (Segment B):
 *   GET  /api/v1/admin/establishments/pending      — list pending queue
 *   GET  /api/v1/admin/establishments/:id           — full details for review
 *   POST /api/v1/admin/establishments/:id/moderate  — approve or reject
 *
 * Endpoints (Segment C):
 *   GET  /api/v1/admin/establishments/active        — list active establishments
 *   GET  /api/v1/admin/establishments/rejected      — rejection history
 *   POST /api/v1/admin/establishments/:id/suspend   — suspend active establishment
 *   POST /api/v1/admin/establishments/:id/unsuspend — reactivate suspended
 *   GET  /api/v1/admin/establishments/search        — search across all statuses
 */

import * as adminService from '../services/adminService.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { isViewer } from '../config/panelRoles.js';
import logger from '../utils/logger.js';

/**
 * GET /api/v1/admin/establishments/pending
 *
 * Returns paginated list of establishments awaiting moderation.
 * Query params: page (default 1), per_page (default 20, max 50)
 */
export const listPendingEstablishments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;

  const result = await adminService.getPendingEstablishments({ page, perPage });

  logger.info('Admin fetched pending establishments', {
    adminId: req.user.userId,
    count: result.establishments.length,
    total: result.meta.total,
    endpoint: 'GET /api/v1/admin/establishments/pending',
  });

  res.status(200).json({
    success: true,
    data: result.establishments,
    meta: result.meta,
  });
});

/**
 * GET /api/v1/admin/establishments/:id
 *
 * Returns complete establishment data for moderation review.
 * Organized for four-tab display: Данные, О заведении, Медиа, Адрес.
 * A viewer gets the same card with partner contacts redacted (the service
 * decides what; the role comes from the token, never from the query).
 */
export const getEstablishmentDetails = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;

  const establishment = await adminService.getEstablishmentForModeration(
    establishmentId,
    { viewer: isViewer(req.user.role) },
  );

  logger.info('Admin fetched establishment details for moderation', {
    adminId: req.user.userId,
    establishmentId,
    status: establishment.status,
    endpoint: 'GET /api/v1/admin/establishments/:id',
  });

  res.status(200).json({
    success: true,
    data: establishment,
  });
});

/**
 * POST /api/v1/admin/establishments/:id/moderate
 *
 * Execute moderation action (approve or reject).
 * Body: { action: "approve"|"reject", moderation_notes: { field: "comment" } }
 */
export const moderateEstablishment = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;
  const { action, moderation_notes } = req.body;

  const result = await adminService.moderateEstablishment(
    establishmentId,
    {
      action,
      moderation_notes: moderation_notes || {},
      adminUserId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  );

  const message = action === 'approve'
    ? 'Establishment approved and published'
    : 'Establishment rejected and returned to draft';

  logger.info('Admin moderated establishment', {
    adminId: req.user.userId,
    establishmentId,
    action,
    newStatus: result.status,
    endpoint: 'POST /api/v1/admin/establishments/:id/moderate',
  });

  res.status(200).json({
    success: true,
    data: result,
    message,
  });
});

// ============================================================================
// Segment C: Active, Rejected, Suspend, Unsuspend, Search
// ============================================================================

/**
 * GET /api/v1/admin/establishments/active
 *
 * Returns paginated list of active (approved) establishments.
 * Query params: page, per_page, sort (newest|oldest|rating|views), city, search
 */
export const listActiveEstablishments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;
  const { sort, city, search } = req.query;

  const result = await adminService.getActiveEstablishments({
    page,
    perPage,
    sort,
    city,
    search,
  });

  logger.info('Admin fetched active establishments', {
    adminId: req.user.userId,
    count: result.establishments.length,
    total: result.meta.total,
    endpoint: 'GET /api/v1/admin/establishments/active',
  });

  res.status(200).json({
    success: true,
    data: result.establishments,
    meta: result.meta,
  });
});

/**
 * GET /api/v1/admin/establishments/rejected
 *
 * Returns paginated rejection history from audit log.
 * Query params: page, per_page
 */
export const listRejectedEstablishments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;

  const result = await adminService.getRejectedEstablishments({ page, perPage });

  logger.info('Admin fetched rejection history', {
    adminId: req.user.userId,
    count: result.rejections.length,
    total: result.meta.total,
    endpoint: 'GET /api/v1/admin/establishments/rejected',
  });

  res.status(200).json({
    success: true,
    data: result.rejections,
    meta: result.meta,
  });
});

/**
 * GET /api/v1/admin/establishments/suspended
 *
 * Returns paginated list of suspended establishments.
 * Query params: page (default 1), per_page (default 20, max 50)
 */
export const listSuspendedEstablishments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;

  const result = await adminService.getSuspendedEstablishments({ page, perPage });

  logger.info('Admin fetched suspended establishments', {
    adminId: req.user.userId,
    count: result.establishments.length,
    total: result.meta.total,
    endpoint: 'GET /api/v1/admin/establishments/suspended',
  });

  res.status(200).json({
    success: true,
    data: result.establishments,
    meta: result.meta,
  });
});

/**
 * POST /api/v1/admin/establishments/:id/suspend
 *
 * Suspend an active establishment.
 * Body: { reason: "string" }
 */
export const suspendEstablishment = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;
  const { reason } = req.body;

  const result = await adminService.suspendEstablishment(
    establishmentId,
    {
      reason,
      adminUserId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  );

  logger.info('Admin suspended establishment', {
    adminId: req.user.userId,
    establishmentId,
    endpoint: 'POST /api/v1/admin/establishments/:id/suspend',
  });

  res.status(200).json({
    success: true,
    data: result,
    message: 'Establishment suspended',
  });
});

/**
 * POST /api/v1/admin/establishments/:id/unsuspend
 *
 * Reactivate a suspended establishment.
 */
export const unsuspendEstablishment = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;

  const result = await adminService.unsuspendEstablishment(
    establishmentId,
    {
      adminUserId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  );

  logger.info('Admin unsuspended establishment', {
    adminId: req.user.userId,
    establishmentId,
    endpoint: 'POST /api/v1/admin/establishments/:id/unsuspend',
  });

  res.status(200).json({
    success: true,
    data: result,
    message: 'Establishment reactivated',
  });
});

/**
 * PATCH /api/v1/admin/establishments/:id/coordinates
 *
 * Update establishment coordinates (admin correction).
 * Body: { latitude: number, longitude: number }
 */
export const updateCoordinates = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;
  const { latitude, longitude } = req.body;

  if (latitude === undefined || longitude === undefined) {
    throw new AppError(
      'latitude and longitude are required',
      422,
      'MISSING_COORDINATES',
    );
  }

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new AppError(
      'latitude and longitude must be numbers',
      422,
      'INVALID_COORDINATES',
    );
  }

  const result = await adminService.updateEstablishmentCoordinates(
    establishmentId,
    {
      latitude,
      longitude,
      adminUserId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  );

  logger.info('Admin updated establishment coordinates', {
    adminId: req.user.userId,
    establishmentId,
    latitude,
    longitude,
    endpoint: 'PATCH /api/v1/admin/establishments/:id/coordinates',
  });

  res.status(200).json({
    success: true,
    data: result,
    message: 'Coordinates updated',
  });
});

/**
 * PATCH /api/v1/admin/establishments/:id/slug
 *
 * Update establishment slug (admin correction).
 * Body: { slug: string }
 *
 * Admin overrides slug directly — auto-generation does not run here because
 * admin intentionally picks the final string. Service layer validates format
 * and uniqueness.
 */
export const updateSlug = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;
  const { slug } = req.body;

  if (slug === undefined) {
    throw new AppError(
      'slug is required in request body',
      422,
      'MISSING_SLUG',
    );
  }

  const result = await adminService.updateEstablishmentSlug(
    establishmentId,
    {
      slug,
      adminUserId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    },
  );

  logger.info('Admin updated establishment slug', {
    adminId: req.user.userId,
    establishmentId,
    newSlug: slug,
    endpoint: 'PATCH /api/v1/admin/establishments/:id/slug',
  });

  res.status(200).json({
    success: true,
    data: result,
    message: 'Slug updated',
  });
});

/**
 * GET /api/v1/admin/establishments/search
 *
 * Search establishments across all statuses.
 * Query params: search (required), status, city, page, per_page
 */
export const searchEstablishments = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(req.query.per_page, 10) || 20;
  const { search, status, city } = req.query;

  const result = await adminService.searchAllEstablishments({
    search,
    status,
    city,
    page,
    perPage,
  });

  logger.info('Admin searched establishments', {
    adminId: req.user.userId,
    search,
    count: result.establishments.length,
    total: result.meta.total,
    endpoint: 'GET /api/v1/admin/establishments/search',
  });

  res.status(200).json({
    success: true,
    data: result.establishments,
    meta: result.meta,
  });
});

// ============================================================================
// User search (for claiming UI)
// ============================================================================

/**
 * GET /api/v1/admin/users/search?q=email_or_name
 *
 * Search active users by email or name for the claiming dialog.
 */
export const searchUsers = asyncHandler(async (req, res) => {
  const { q } = req.query;

  const users = await adminService.searchUsers(q);

  res.status(200).json({
    success: true,
    data: users,
  });
});

// ============================================================================
// Claiming: Admin assigns establishment to a registered user
// ============================================================================

/**
 * POST /api/v1/admin/establishments/:id/claim
 *
 * Transfer establishment ownership to a target user.
 * Body: { user_id: "UUID of target user" }
 */
export const claimEstablishment = asyncHandler(async (req, res) => {
  const establishmentId = req.params.id;
  const { user_id } = req.body;

  if (!user_id) {
    throw new AppError(
      'user_id is required',
      422,
      'MISSING_USER_ID',
    );
  }

  // Basic UUID format check
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(user_id)) {
    throw new AppError(
      'user_id must be a valid UUID',
      422,
      'INVALID_USER_ID',
    );
  }

  const result = await adminService.claimEstablishment(
    establishmentId,
    user_id,
    req.user.userId,
    req,
  );

  logger.info('Admin claimed establishment', {
    adminId: req.user.userId,
    establishmentId,
    newPartnerId: user_id,
    endpoint: 'POST /api/v1/admin/establishments/:id/claim',
  });

  res.status(200).json({
    success: true,
    data: { establishment: result },
    message: 'Establishment claimed successfully',
  });
});

/**
 * POST /api/v1/admin/users/:id/upgrade-to-partner
 *
 * Upgrade a regular user to partner role.
 */
export const upgradeToPartner = asyncHandler(async (req, res) => {
  const targetUserId = req.params.id;

  const result = await adminService.adminUpgradeUserToPartner(
    targetUserId,
    req.user.userId,
    req,
  );

  logger.info('Admin upgraded user to partner', {
    adminId: req.user.userId,
    targetUserId,
    endpoint: 'POST /api/v1/admin/users/:id/upgrade-to-partner',
  });

  res.status(200).json({
    success: true,
    data: { user: result },
    message: 'User upgraded to partner',
  });
});
