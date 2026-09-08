/**
 * Admin Service
 *
 * Business logic for admin-specific operations: moderation workflow.
 * Orchestrates model layer calls, enforces business rules, and manages
 * the approve/reject lifecycle for pending establishments.
 *
 * Architecture: Controller → Service → Model (same pattern as establishmentService.js)
 */

import * as EstablishmentModel from '../models/establishmentModel.js';
import * as MediaModel from '../models/mediaModel.js';
import * as MenuItemModel from '../models/menuItemModel.js';
import * as OcrJobModel from '../models/ocrJobModel.js';
import * as PartnerDocumentsModel from '../models/partnerDocumentsModel.js';
import * as AuditLogModel from '../models/auditLogModel.js';
import * as NotificationService from './notificationService.js';
import { AppError } from '../middleware/errorHandler.js';
import { BELARUS_BOUNDS, validateCityCoordinates } from './establishmentService.js';
import { upgradeUserToPartner } from './authService.js';
import { getClient, query as dbQuery } from '../config/database.js';
import logger from '../utils/logger.js';
import { invalidateCache as invalidateBadges } from './badgesService.js';
import { invalidateCache as invalidateHealth } from './qualityHealthService.js';
import { SANITY_FLAG_REASONS } from './ocr/sanityChecker.js';

/**
 * Get paginated list of pending establishments for the moderation queue
 *
 * @param {Object} params
 * @param {number} params.page - Page number (1-based)
 * @param {number} params.perPage - Items per page (max 50)
 * @returns {Promise<Object>} { establishments, meta: { total, page, per_page, pages } }
 */
export const getPendingEstablishments = async ({ page = 1, perPage = 20 } = {}) => {
  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;

    const [establishments, total] = await Promise.all([
      EstablishmentModel.getPendingEstablishments(effectivePerPage, offset),
      EstablishmentModel.countPendingEstablishments(),
    ]);

    return {
      establishments,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage),
      },
    };
  } catch (error) {
    logger.error('Error in getPendingEstablishments service', {
      error: error.message,
    });
    throw new AppError(
      'Failed to fetch pending establishments',
      500,
      'PENDING_FETCH_FAILED',
    );
  }
};

/**
 * Get full establishment details for moderation review
 *
 * Returns all data across the four moderation tabs:
 * - Данные (partner legal info, contacts)
 * - О заведении (description, hours, attributes)
 * - Медиа (photos, menu)
 * - Адрес (city, address, coordinates)
 *
 * @param {string} establishmentId - UUID
 * @param {Object} [options]
 * @param {boolean} [options.viewer=false] - Caller is the read-only panel
 *   role: partner contact person, contact e-mail and the registration
 *   document are redacted (Coordinator decision 2026-09-08, SDL CAT-C-2.11).
 * @returns {Promise<Object>} Complete establishment with media and partner docs
 */
export const getEstablishmentForModeration = async (
  establishmentId,
  { viewer = false } = {},
) => {
  try {
    // Fetch establishment (includeAll=true to see pending status)
    const establishment = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!establishment) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    // Fetch media and partner documents in parallel
    const [media, partnerDoc] = await Promise.all([
      MediaModel.getEstablishmentMedia(establishmentId),
      PartnerDocumentsModel.findByEstablishmentId(establishmentId),
    ]);

    // Who suspended it. moderation_notes carries the reason and the time but
    // no author (feedback_moderation_notes_text); the only carrier of
    // authorship is the audit log. Read it back instead of writing a second
    // copy into moderation_notes: one source of truth, and it also covers
    // suspensions made before this field existed. One extra query, only for
    // the suspended card.
    const suspension = establishment.status === 'suspended'
      ? await AuditLogModel.getLatestEntityAction({
        entityType: 'establishment',
        entityId: establishmentId,
        action: 'suspend',
      })
      : null;

    // Organize media by type
    // preview_url и file_type нужны просмотрщику админки: модератор должен
    // рассмотреть снимок, а не довольствоваться миниатюрой 120×90. Меню при
    // этом бывает PDF — его нельзя отрисовать как картинку, у него смотрят
    // растр первой страницы (preview_url), а оригинал открывают отдельно.
    // Без file_type клиент этих двух случаев не различает.
    const projectMedia = m => ({
      id: m.id,
      url: m.url,
      thumbnail_url: m.thumbnail_url,
      preview_url: m.preview_url,
      file_type: m.file_type,
    });

    const interiorPhotos = media
      .filter(m => m.type === 'interior')
      .map(m => ({ ...projectMedia(m), is_primary: m.is_primary }));

    const menuMedia = media.filter(m => m.type === 'menu').map(projectMedia);

    // Convert numeric types from PostgreSQL strings
    return {
      // Core fields
      id: establishment.id,
      partner_id: establishment.partner_id,
      name: establishment.name,
      description: establishment.description,
      status: establishment.status,

      // Address tab
      city: establishment.city,
      address: establishment.address,
      latitude: establishment.latitude ? parseFloat(establishment.latitude) : null,
      longitude: establishment.longitude ? parseFloat(establishment.longitude) : null,

      // About tab
      phone: establishment.phone,
      email: establishment.email,
      website: establishment.website,
      categories: establishment.categories,
      cuisines: establishment.cuisines,
      price_range: establishment.price_range,
      working_hours: establishment.working_hours,
      special_hours: establishment.special_hours,
      attributes: establishment.attributes,

      // Data tab (legal / partner info)
      // A viewer gets the company, not the people: contact person, contact
      // e-mail and the registration document are redacted. The flag lets the
      // client say "hidden in view mode" instead of showing an empty field.
      legal_name: partnerDoc?.company_name || null,
      unp: partnerDoc?.tax_id || null,
      registration_doc_url: viewer ? null : (partnerDoc?.document_url || null),
      contact_person: viewer ? null : (partnerDoc?.contact_person || null),
      contact_email: viewer ? null : (partnerDoc?.contact_email || null),
      partner_data_redacted: viewer,

      // Media tab
      interior_photos: interiorPhotos,
      menu_media: menuMedia,

      // Moderation metadata
      // moderation_notes is TEXT column — parse JSON string to object for API consistency
      moderation_notes: typeof establishment.moderation_notes === 'string'
        ? (() => { try { return JSON.parse(establishment.moderation_notes); } catch { return null; } })()
        : (establishment.moderation_notes || null),
      moderated_by: establishment.moderated_by,
      moderated_at: establishment.moderated_at,
      // Author of the current suspension from the audit log; null when the
      // card is not suspended or the suspension predates the journal.
      suspended_by: suspension
        ? {
          id: suspension.user_id,
          name: suspension.admin_name,
          at: suspension.created_at,
        }
        : null,

      // Timestamps
      created_at: establishment.created_at,
      updated_at: establishment.updated_at,
      published_at: establishment.published_at,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Error fetching establishment for moderation', {
      error: error.message,
      establishmentId,
    });

    throw new AppError(
      'Failed to fetch establishment details',
      500,
      'ESTABLISHMENT_DETAIL_FAILED',
    );
  }
};

/**
 * Execute moderation action on a pending establishment
 *
 * Approve: status → 'active', set published_at, record audit log
 * Reject:  status → 'rejected', store per-field notes, record audit log
 *
 * @param {string} establishmentId - UUID
 * @param {Object} params
 * @param {string} params.action - 'approve' or 'reject'
 * @param {Object} params.moderation_notes - Per-field comments { field_name: "comment" }
 * @param {string} params.adminUserId - UUID of the admin performing the action
 * @param {string} params.ipAddress - Request IP (for audit log)
 * @param {string} params.userAgent - Request User-Agent (for audit log)
 * @returns {Promise<Object>} Updated establishment
 */
export const moderateEstablishment = async (establishmentId, params) => {
  const { action, moderation_notes = {}, adminUserId, ipAddress, userAgent } = params;

  // Validate action
  if (!['approve', 'reject'].includes(action)) {
    throw new AppError(
      'Invalid moderation action. Must be "approve" or "reject".',
      400,
      'INVALID_MODERATION_ACTION',
    );
  }

  try {
    // Verify establishment exists and is pending
    const existing = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!existing) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    if (existing.status !== 'pending') {
      throw new AppError(
        `Cannot moderate establishment with status '${existing.status}'. Only pending establishments can be moderated.`,
        400,
        'INVALID_STATUS_FOR_MODERATION',
      );
    }

    // Determine new status and flags
    const newStatus = action === 'approve' ? 'active' : 'rejected';
    const setPublishedAt = action === 'approve' && !existing.published_at;

    // Execute moderation
    const moderated = await EstablishmentModel.moderateEstablishment(
      establishmentId,
      {
        status: newStatus,
        moderated_by: adminUserId,
        moderation_notes,
        setPublishedAt,
      },
    );

    if (!moderated) {
      throw new AppError(
        'Moderation failed — establishment may have been modified concurrently',
        409,
        'MODERATION_CONFLICT',
      );
    }

    // Record audit log (non-blocking)
    await AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action: `moderate_${action}`,
      entity_type: 'establishment',
      entity_id: establishmentId,
      old_data: { status: existing.status },
      new_data: {
        status: newStatus,
        moderation_notes,
      },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    // Notify partner (non-blocking)
    NotificationService.notifyEstablishmentStatusChange(
      establishmentId,
      newStatus,
      action === 'reject' ? (moderation_notes || null) : null,
    ).catch(() => {});

    // Backfill OCR jobs on approve — covers establishments created before the
    // OCR pipeline existed, or media whose earlier job permanently failed.
    // Eligible media = PDF menus + menu photos (vision_image strategy).
    // Idempotency in OcrJobModel.enqueue protects against duplicates for
    // already-pending/processing jobs; hasCompletedJobForMedia filters out
    // finished ones so we never re-process done media on repeated approvals.
    if (action === 'approve') {
      (async () => {
        try {
          const eligibleMedia = await MediaModel.getOcrEligibleMedia(establishmentId);
          for (const media of eligibleMedia) {
            const alreadyDone = await OcrJobModel.hasCompletedJobForMedia(media.id);
            if (!alreadyDone) {
              await OcrJobModel.enqueue({ establishmentId, mediaId: media.id });
            }
          }
        } catch (err) {
          logger.error('Failed to backfill OCR jobs on approve', {
            error: err.message,
            establishmentId,
          });
        }
      })();
    }

    // Размер очереди изменился — счётчики рейла обязаны это увидеть
    // сразу, иначе бейдж до полминуты показывал бы число, которое
    // модератор только что сам и поменял.
    invalidateBadges();

    // Снимок здоровья сбрасывается ТОЛЬКО на отказе, и это не осторожность.
    // Счётчик «висящих флагов» с этапа 7 ограничен областью
    // CATALOGUE_TRACK_STATUSES (active + pending + suspended). Одобрение ведёт
    // pending → active, приостановка и возобновление ходят внутри той же
    // области — величина не меняется, пересчитывать нечего. А отказ выводит
    // заведение ЗА область, и все его флагованные позиции разом выпадают из
    // счёта. До появления этого JOIN отказ был безвреден, поэтому прежняя
    // формулировка «модерация заведений на здоровье не влияет» верна больше
    // не является.
    if (action === 'reject') {
      invalidateHealth();
    }

    logger.info('Establishment moderation completed', {
      establishmentId,
      action,
      oldStatus: existing.status,
      newStatus,
      adminUserId,
    });

    return moderated;
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Unexpected error during moderation', {
      error: error.message,
      establishmentId,
      action,
    });

    throw new AppError(
      'Failed to moderate establishment',
      500,
      'MODERATION_FAILED',
    );
  }
};

// ============================================================================
// Segment C: Active, Rejected, Suspend, Unsuspend, Search
// ============================================================================

/**
 * Get paginated list of active (approved) establishments
 *
 * @param {Object} params
 * @param {number} params.page - Page number (1-based)
 * @param {number} params.perPage - Items per page (max 50)
 * @param {string} params.sort - Sort: 'newest', 'oldest', 'rating', 'views'
 * @param {string} params.city - City filter
 * @param {string} params.search - Name search (ILIKE)
 * @returns {Promise<Object>} { establishments, meta }
 */
export const getActiveEstablishments = async ({ page = 1, perPage = 20, sort, city, search } = {}) => {
  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;
    const filters = { sort, city, search };

    const [establishments, total] = await Promise.all([
      EstablishmentModel.getActiveEstablishments(effectivePerPage, offset, filters),
      EstablishmentModel.countActiveEstablishments(filters),
    ]);

    return {
      establishments,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage) || 1,
      },
    };
  } catch (error) {
    logger.error('Error in getActiveEstablishments service', {
      error: error.message,
    });
    throw new AppError(
      'Failed to fetch active establishments',
      500,
      'ACTIVE_FETCH_FAILED',
    );
  }
};

/**
 * Get rejection history from audit log
 *
 * @param {Object} params
 * @param {number} params.page - Page number (1-based)
 * @param {number} params.perPage - Items per page (max 50)
 * @returns {Promise<Object>} { rejections, meta }
 */
export const getRejectedEstablishments = async ({ page = 1, perPage = 20 } = {}) => {
  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;

    const [rejections, total] = await Promise.all([
      AuditLogModel.getRejectionHistory(effectivePerPage, offset),
      AuditLogModel.countRejections(),
    ]);

    // Normalize moderation_notes from TEXT column (string → object) for each rejection
    const normalizedRejections = rejections.map(r => ({
      ...r,
      moderation_notes: typeof r.moderation_notes === 'string'
        ? (() => { try { return JSON.parse(r.moderation_notes); } catch { return null; } })()
        : (r.moderation_notes || null),
    }));

    return {
      rejections: normalizedRejections,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage) || 1,
      },
    };
  } catch (error) {
    logger.error('Error in getRejectedEstablishments service', {
      error: error.message,
    });
    throw new AppError(
      'Failed to fetch rejected establishments',
      500,
      'REJECTED_FETCH_FAILED',
    );
  }
};

/**
 * Suspend an active establishment
 *
 * Changes status: active → suspended
 * Records reason in moderation_notes and audit log
 *
 * @param {string} establishmentId - UUID
 * @param {Object} params
 * @param {string} params.reason - Suspension reason
 * @param {string} params.adminUserId - Admin UUID
 * @param {string} params.ipAddress - Request IP
 * @param {string} params.userAgent - Request User-Agent
 * @returns {Promise<Object>} Updated establishment
 */
export const suspendEstablishment = async (establishmentId, params) => {
  const { reason, adminUserId, ipAddress, userAgent } = params;

  if (!reason || !reason.trim()) {
    throw new AppError(
      'Suspension reason is required',
      400,
      'REASON_REQUIRED',
    );
  }

  try {
    const existing = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!existing) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    if (existing.status !== 'active') {
      throw new AppError(
        `Cannot suspend establishment with status '${existing.status}'. Only active establishments can be suspended.`,
        400,
        'INVALID_STATUS_FOR_SUSPEND',
      );
    }

    // Merge suspend reason into existing moderation_notes
    const currentNotes = typeof existing.moderation_notes === 'string'
      ? JSON.parse(existing.moderation_notes || '{}')
      : (existing.moderation_notes || {});
    const updatedNotes = {
      ...currentNotes,
      suspend_reason: reason,
      suspended_at: new Date().toISOString(),
    };

    const updated = await EstablishmentModel.changeEstablishmentStatus(
      establishmentId,
      {
        fromStatus: 'active',
        toStatus: 'suspended',
        moderationNotes: updatedNotes,
      },
    );

    if (!updated) {
      throw new AppError(
        'Suspension failed — establishment may have been modified concurrently',
        409,
        'SUSPEND_CONFLICT',
      );
    }

    // Audit log — awaited for parity with moderateEstablishment and to avoid a
    // race when tests assert the row right after the response. createAuditLog
    // swallows its own errors, so awaiting cannot fail the suspension.
    await AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action: 'suspend',
      entity_type: 'establishment',
      entity_id: establishmentId,
      old_data: { status: 'active' },
      new_data: { status: 'suspended', reason },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    // Notify partner (non-blocking)
    NotificationService.notifyEstablishmentStatusChange(
      establishmentId,
      'suspended',
      reason,
    ).catch(() => {});

    // Размер очереди изменился — счётчики рейла обязаны это увидеть
    // сразу, иначе бейдж до полминуты показывал бы число, которое
    // модератор только что сам и поменял.
    invalidateBadges();

    logger.info('Establishment suspended', {
      establishmentId,
      adminUserId,
      reason,
    });

    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Unexpected error during suspension', {
      error: error.message,
      establishmentId,
    });

    throw new AppError(
      'Failed to suspend establishment',
      500,
      'SUSPEND_FAILED',
    );
  }
};

/**
 * Unsuspend (reactivate) a suspended establishment
 *
 * Changes status: suspended → active
 * Records event in audit log
 *
 * @param {string} establishmentId - UUID
 * @param {Object} params
 * @param {string} params.adminUserId - Admin UUID
 * @param {string} params.ipAddress - Request IP
 * @param {string} params.userAgent - Request User-Agent
 * @returns {Promise<Object>} Updated establishment
 */
export const unsuspendEstablishment = async (establishmentId, params) => {
  const { adminUserId, ipAddress, userAgent } = params;

  try {
    const existing = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!existing) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    if (existing.status !== 'suspended') {
      throw new AppError(
        `Cannot unsuspend establishment with status '${existing.status}'. Only suspended establishments can be reactivated.`,
        400,
        'INVALID_STATUS_FOR_UNSUSPEND',
      );
    }

    const updated = await EstablishmentModel.changeEstablishmentStatus(
      establishmentId,
      {
        fromStatus: 'suspended',
        toStatus: 'active',
      },
    );

    if (!updated) {
      throw new AppError(
        'Unsuspension failed — establishment may have been modified concurrently',
        409,
        'UNSUSPEND_CONFLICT',
      );
    }

    // Audit log — awaited for parity with moderateEstablishment and to avoid a
    // race when tests assert the row right after the response. createAuditLog
    // swallows its own errors, so awaiting cannot fail the reactivation.
    await AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action: 'unsuspend',
      entity_type: 'establishment',
      entity_id: establishmentId,
      old_data: { status: 'suspended' },
      new_data: { status: 'active' },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    // Notify partner (non-blocking) — distinct unsuspend notification
    NotificationService.notifyEstablishmentStatusChange(
      establishmentId,
      'unsuspended',
    ).catch(() => {});

    // Размер очереди изменился — счётчики рейла обязаны это увидеть
    // сразу, иначе бейдж до полминуты показывал бы число, которое
    // модератор только что сам и поменял.
    invalidateBadges();

    logger.info('Establishment unsuspended', {
      establishmentId,
      adminUserId,
    });

    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Unexpected error during unsuspension', {
      error: error.message,
      establishmentId,
    });

    throw new AppError(
      'Failed to unsuspend establishment',
      500,
      'UNSUSPEND_FAILED',
    );
  }
};

/**
 * Get paginated list of suspended establishments
 *
 * @param {Object} params
 * @param {number} params.page - Page number (1-based)
 * @param {number} params.perPage - Items per page (max 50)
 * @returns {Promise<Object>} { establishments, meta: { total, page, per_page, pages } }
 */
export const getSuspendedEstablishments = async ({ page = 1, perPage = 20 } = {}) => {
  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;

    const [establishments, total] = await Promise.all([
      EstablishmentModel.getSuspendedEstablishments(effectivePerPage, offset),
      EstablishmentModel.countSuspendedEstablishments(),
    ]);

    // Normalize moderation_notes from TEXT column (string → object)
    const normalizedEstablishments = establishments.map((e) => ({
      ...e,
      moderation_notes:
        typeof e.moderation_notes === 'string'
          ? (() => {
              try {
                return JSON.parse(e.moderation_notes);
              } catch {
                return null;
              }
            })()
          : e.moderation_notes || null,
    }));

    return {
      establishments: normalizedEstablishments,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage) || 1,
      },
    };
  } catch (error) {
    logger.error('Error in getSuspendedEstablishments service', {
      error: error.message,
    });
    throw new AppError(
      'Failed to fetch suspended establishments',
      500,
      'SUSPENDED_FETCH_FAILED',
    );
  }
};

/**
 * Update establishment coordinates (admin correction)
 *
 * Allows admin to fix geocoding errors by directly setting lat/lon.
 * Validates coordinates against Belarus bounds and city bounds.
 *
 * @param {string} establishmentId - UUID
 * @param {Object} params
 * @param {number} params.latitude - New latitude
 * @param {number} params.longitude - New longitude
 * @param {string} params.adminUserId - Admin UUID
 * @param {string} params.ipAddress - Request IP
 * @param {string} params.userAgent - Request User-Agent
 * @returns {Promise<Object>} Updated establishment
 */
export const updateEstablishmentCoordinates = async (establishmentId, params) => {
  const { latitude, longitude, adminUserId, ipAddress, userAgent } = params;

  try {
    const existing = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!existing) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    // Validate Belarus bounds
    if (latitude < BELARUS_BOUNDS.LAT_MIN || latitude > BELARUS_BOUNDS.LAT_MAX) {
      throw new AppError(
        `Latitude must be between ${BELARUS_BOUNDS.LAT_MIN} and ${BELARUS_BOUNDS.LAT_MAX} (Belarus bounds)`,
        422,
        'INVALID_LATITUDE',
      );
    }

    if (longitude < BELARUS_BOUNDS.LON_MIN || longitude > BELARUS_BOUNDS.LON_MAX) {
      throw new AppError(
        `Longitude must be between ${BELARUS_BOUNDS.LON_MIN} and ${BELARUS_BOUNDS.LON_MAX} (Belarus bounds)`,
        422,
        'INVALID_LONGITUDE',
      );
    }

    // Validate coordinates match the establishment's city
    const cityValidation = validateCityCoordinates(existing.city, latitude, longitude);
    if (!cityValidation.valid) {
      throw new AppError(
        cityValidation.message,
        422,
        'COORDINATES_CITY_MISMATCH',
      );
    }

    const updated = await EstablishmentModel.updateEstablishment(
      establishmentId,
      { latitude, longitude },
    );

    // Audit log (non-blocking)
    await AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action: 'admin_update_coordinates',
      entity_type: 'establishment',
      entity_id: establishmentId,
      old_data: {
        latitude: existing.latitude ? parseFloat(existing.latitude) : null,
        longitude: existing.longitude ? parseFloat(existing.longitude) : null,
      },
      new_data: { latitude, longitude },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    logger.info('Admin updated establishment coordinates', {
      establishmentId,
      adminUserId,
      oldCoords: { lat: existing.latitude, lon: existing.longitude },
      newCoords: { lat: latitude, lon: longitude },
    });

    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Unexpected error updating coordinates', {
      error: error.message,
      establishmentId,
    });

    throw new AppError(
      'Failed to update establishment coordinates',
      500,
      'COORDINATES_UPDATE_FAILED',
    );
  }
};

/**
 * Update establishment slug (admin correction).
 *
 * Allows admin to override the auto-generated slug — typically for SEO
 * refinement or partner-requested URL adjustments. Partner-side slug is
 * frozen post-approve (immutability gate in establishmentService); this
 * endpoint is the only way to change a slug on an active establishment.
 *
 * Slug format requirements:
 *   - lowercase, [a-z0-9-] only
 *   - no leading/trailing/consecutive dashes
 *   - length 1-150
 *
 * @param {string} establishmentId - UUID
 * @param {Object} params
 * @param {string} params.slug - New slug
 * @param {string} params.adminUserId
 * @param {string} params.ipAddress
 * @param {string} params.userAgent
 * @returns {Promise<Object>} Updated establishment
 */
export const updateEstablishmentSlug = async (establishmentId, params) => {
  const { slug, adminUserId, ipAddress, userAgent } = params;

  // Format validation
  if (typeof slug !== 'string') {
    throw new AppError(
      'Slug must be a string',
      422,
      'INVALID_SLUG_TYPE',
    );
  }

  const trimmed = slug.trim();

  if (trimmed.length === 0 || trimmed.length > 150) {
    throw new AppError(
      'Slug length must be 1-150 characters',
      422,
      'INVALID_SLUG_LENGTH',
    );
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
    throw new AppError(
      'Slug must be lowercase alphanumeric with single dashes between groups (no leading/trailing/consecutive dashes)',
      422,
      'INVALID_SLUG_FORMAT',
    );
  }

  try {
    const existing = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true,
    );

    if (!existing) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND',
      );
    }

    // Uniqueness check (excluding self — admin can re-submit current slug as no-op)
    const isDuplicate = await EstablishmentModel.checkDuplicateSlug(trimmed, establishmentId);
    if (isDuplicate) {
      throw new AppError(
        'Slug is already in use by another establishment',
        409,
        'SLUG_ALREADY_TAKEN',
      );
    }

    const updated = await EstablishmentModel.updateEstablishment(
      establishmentId,
      { slug: trimmed },
    );

    await AuditLogModel.createAuditLog({
      user_id: adminUserId,
      action: 'admin_update_slug',
      entity_type: 'establishment',
      entity_id: establishmentId,
      old_data: { slug: existing.slug },
      new_data: { slug: trimmed },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    logger.info('Admin updated establishment slug', {
      establishmentId,
      adminUserId,
      oldSlug: existing.slug,
      newSlug: trimmed,
    });

    return updated;
  } catch (error) {
    if (error instanceof AppError) throw error;

    // Race condition: another transaction took the slug between our check and update
    if (error.code === '23505' && error.constraint === 'establishments_slug_unique') {
      throw new AppError(
        'Slug is already in use by another establishment',
        409,
        'SLUG_ALREADY_TAKEN',
      );
    }

    logger.error('Unexpected error updating slug', {
      error: error.message,
      establishmentId,
    });

    throw new AppError(
      'Failed to update establishment slug',
      500,
      'SLUG_UPDATE_FAILED',
    );
  }
};

/**
 * Search establishments across all statuses
 *
 * @param {Object} params
 * @param {string} params.search - Name search (required)
 * @param {string} params.status - Optional status filter
 * @param {string} params.city - Optional city filter
 * @param {number} params.page - Page number (1-based)
 * @param {number} params.perPage - Items per page (max 50)
 * @returns {Promise<Object>} { establishments, meta }
 */
export const searchAllEstablishments = async ({ search, status, city, page = 1, perPage = 20 } = {}) => {
  if (!search || !search.trim()) {
    throw new AppError(
      'Search query is required',
      400,
      'SEARCH_REQUIRED',
    );
  }

  try {
    const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
    const offset = (Math.max(page, 1) - 1) * effectivePerPage;
    const filters = { status, city, limit: effectivePerPage, offset };

    const [establishments, total] = await Promise.all([
      EstablishmentModel.searchAllEstablishments(search.trim(), filters),
      EstablishmentModel.countSearchResults(search.trim(), { status, city }),
    ]);

    return {
      establishments,
      meta: {
        total,
        page: Math.max(page, 1),
        per_page: effectivePerPage,
        pages: Math.ceil(total / effectivePerPage) || 1,
      },
    };
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error('Error in searchAllEstablishments service', {
      error: error.message,
      search,
    });

    throw new AppError(
      'Failed to search establishments',
      500,
      'SEARCH_FAILED',
    );
  }
};

// ============================================================================
// User search (for claiming UI)
// ============================================================================

/**
 * Search users by email or name for the claiming dialog.
 *
 * @param {string} query - Search query (matches email or name via ILIKE)
 * @param {number} limit - Max results (default 10)
 * @returns {Promise<Array>} Array of { id, email, name, role }
 */
export const searchUsers = async (query, limit = 10) => {
  if (!query || query.trim().length < 2) {
    return [];
  }

  const result = await dbQuery(
    `SELECT id, email, name, role
     FROM users
     WHERE is_active = true
       AND (email ILIKE $1 OR name ILIKE $1)
     ORDER BY name ASC
     LIMIT $2`,
    [`%${query.trim()}%`, limit],
  );

  return result.rows;
};

// ============================================================================
// Claiming: Admin assigns establishment to a registered user
// ============================================================================

/**
 * Claim an establishment for a target user.
 *
 * Atomically transfers ownership (partner_id) and upgrades the target user
 * to partner role. Follows the moderateEstablishment pattern (lines 192-296)
 * with the addition of a database transaction wrapping both operations.
 *
 * @param {string} establishmentId - UUID of the establishment to claim
 * @param {string} targetUserId - UUID of the user receiving ownership
 * @param {string} adminUserId - UUID of the admin performing the action
 * @param {Object} req - Express request (for audit log ip/user-agent)
 * @returns {Promise<Object>} Updated establishment
 */
export const claimEstablishment = async (establishmentId, targetUserId, adminUserId, req) => {
  // 1. Validate establishment exists and is suitable for claiming
  const establishment = await EstablishmentModel.findEstablishmentById(
    establishmentId,
    true,
  );

  if (!establishment) {
    throw new AppError(
      'Establishment not found',
      404,
      'ESTABLISHMENT_NOT_FOUND',
    );
  }

  if (establishment.status === 'archived') {
    throw new AppError(
      'Cannot claim an archived establishment',
      400,
      'ESTABLISHMENT_ARCHIVED',
    );
  }

  if (establishment.partner_id === targetUserId) {
    throw new AppError(
      'Establishment already belongs to this user',
      400,
      'ALREADY_OWNED',
    );
  }

  // 2. Validate target user exists and is active
  const userResult = await dbQuery(
    'SELECT id, role, is_active FROM users WHERE id = $1',
    [targetUserId],
  );

  if (userResult.rows.length === 0) {
    throw new AppError(
      'Target user not found',
      404,
      'USER_NOT_FOUND',
    );
  }

  const targetUser = userResult.rows[0];

  if (!targetUser.is_active) {
    throw new AppError(
      'Target user account is inactive',
      400,
      'USER_INACTIVE',
    );
  }

  // 3. TRANSACTION — atomic partner_id change + role upgrade
  const previousPartnerId = establishment.partner_id;
  let updated;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 3a. Update establishment partner_id
    updated = await EstablishmentModel.claimEstablishment(
      establishmentId,
      targetUserId,
      adminUserId,
      client,
    );

    // 3b. Upgrade user to partner role (idempotent)
    // Execute within transaction using same client for atomicity
    if (targetUser.role === 'user') {
      await client.query(
        "UPDATE users SET role = 'partner', updated_at = $1 WHERE id = $2",
        [new Date(), targetUserId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Claiming transaction failed', {
      error: err.message,
      establishmentId,
      targetUserId,
    });
    throw new AppError(
      'Failed to claim establishment',
      500,
      'CLAIM_FAILED',
    );
  } finally {
    client.release();
  }

  // 4. Audit log (non-blocking, outside transaction)
  await AuditLogModel.createAuditLog({
    user_id: adminUserId,
    action: 'claim_establishment',
    entity_type: 'establishment',
    entity_id: establishmentId,
    old_data: { partner_id: previousPartnerId },
    new_data: { partner_id: targetUserId },
    ip_address: req.ip,
    user_agent: req.get('User-Agent'),
  });

  // 5. Notify new partner (non-blocking)
  NotificationService.notifyEstablishmentClaimed(
    establishmentId,
    targetUserId,
  ).catch(() => {});

  logger.info('Establishment claimed successfully', {
    establishmentId,
    previousPartnerId,
    newPartnerId: targetUserId,
    adminUserId,
  });

  return updated;
};

/**
 * Admin-initiated upgrade of a user to partner role.
 *
 * Thin wrapper around authService.upgradeUserToPartner with
 * validation, audit logging, and proper error handling.
 *
 * @param {string} targetUserId - UUID of the user to upgrade
 * @param {string} adminUserId - UUID of the admin performing the action
 * @param {Object} req - Express request (for audit log)
 * @returns {Promise<Object>} Updated user object
 */
export const adminUpgradeUserToPartner = async (targetUserId, adminUserId, req) => {
  // Validate target user exists and is active
  const userResult = await dbQuery(
    'SELECT id, role, is_active FROM users WHERE id = $1',
    [targetUserId],
  );

  if (userResult.rows.length === 0) {
    throw new AppError(
      'User not found',
      404,
      'USER_NOT_FOUND',
    );
  }

  const targetUser = userResult.rows[0];

  if (!targetUser.is_active) {
    throw new AppError(
      'User account is inactive',
      400,
      'USER_INACTIVE',
    );
  }

  // Upgrade role (idempotent — safe for already-partner users)
  const updatedUser = await upgradeUserToPartner(targetUserId);

  // Audit log (non-blocking)
  await AuditLogModel.createAuditLog({
    user_id: adminUserId,
    action: 'upgrade_user_to_partner',
    entity_type: 'user',
    entity_id: targetUserId,
    old_data: { role: targetUser.role },
    new_data: { role: 'partner' },
    ip_address: req.ip,
    user_agent: req.get('User-Agent'),
  });

  logger.info('Admin upgraded user to partner', {
    targetUserId,
    previousRole: targetUser.role,
    adminUserId,
  });

  return updatedUser;
};

// ============================================================================
// Menu-item moderation (Segment B)
// ============================================================================

/**
 * Hide a parsed menu item from user-facing search.
 * Parallel to suspendEstablishment: validate reason, guard state, update,
 * write audit log non-blocking. Phase 1: no partner notification.
 *
 * @param {string} menuItemId - UUID
 * @param {Object} params
 * @param {string} params.reason - Admin-provided reason (required, non-empty)
 * @param {string} params.adminUserId
 * @param {string} params.ipAddress
 * @param {string} params.userAgent
 * @returns {Promise<Object>} Updated menu_items row
 */
export const hideMenuItem = async (menuItemId, params) => {
  const { reason, adminUserId, ipAddress, userAgent } = params;

  if (!reason || !reason.trim()) {
    throw new AppError('Hide reason is required', 400, 'REASON_REQUIRED');
  }

  const existing = await MenuItemModel.findById(menuItemId);
  if (!existing) {
    throw new AppError('Menu item not found', 404, 'MENU_ITEM_NOT_FOUND');
  }

  if (existing.is_hidden_by_admin === true) {
    throw new AppError(
      'Menu item is already hidden',
      400,
      'MENU_ITEM_ALREADY_HIDDEN',
    );
  }

  const updated = await MenuItemModel.updateById(menuItemId, {
    is_hidden_by_admin: true,
    hidden_reason: reason,
  });

  if (!updated) {
    throw new AppError(
      'Hide failed — menu item may have been removed concurrently',
      409,
      'MENU_ITEM_HIDE_CONFLICT',
    );
  }

  await AuditLogModel.createAuditLog({
    user_id: adminUserId,
    action: 'hide_menu_item',
    entity_type: 'menu_item',
    entity_id: menuItemId,
    old_data: { is_hidden_by_admin: false },
    new_data: { is_hidden_by_admin: true, reason },
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  // Phase 1 decision (Segment C): no partner notification on hide.
  // Partners do not see hidden items in their cabinet, so a push pointing to
  // an invisible item would be a cognitive dead-end. The notifyMenuItemHidden
  // helper in notificationService is retained for potential Phase 2 reuse
  // when the partner's responsibility model may change.

  // Размер очереди изменился — счётчики рейла обязаны это увидеть
  // сразу, иначе бейдж до полминуты показывал бы число, которое
  // модератор только что сам и поменял.
  invalidateBadges();
  // Снимок «Здоровья данных» считает ровно ту же величину (hanging_flags).
  // Без сброса рейл слева показывал бы новое число, а карточка «Флаги без
  // реакции» справа — прежнее, до двух минут, в одном окне. Модерация
  // ЗАВЕДЕНИЙ снимок намеренно НЕ сбрасывает: там пересчёт достижимости
  // всего каталога на каждое одобрение, и это совсем другая цена.
  invalidateHealth();

  logger.info('Menu item hidden by admin', {
    menuItemId,
    adminUserId,
    reason,
  });

  return updated;
};

/**
 * Unhide a previously hidden menu item — restores it to search results.
 *
 * Per directive: no partner notification on unhide (opposite direction of hide,
 * partner can see state change in cabinet without extra push).
 *
 * @param {string} menuItemId - UUID
 * @param {Object} params
 * @param {string} params.adminUserId
 * @param {string} params.ipAddress
 * @param {string} params.userAgent
 * @returns {Promise<Object>} Updated menu_items row
 */
export const unhideMenuItem = async (menuItemId, params) => {
  const { adminUserId, ipAddress, userAgent } = params;

  const existing = await MenuItemModel.findById(menuItemId);
  if (!existing) {
    throw new AppError('Menu item not found', 404, 'MENU_ITEM_NOT_FOUND');
  }

  if (existing.is_hidden_by_admin !== true) {
    throw new AppError(
      'Menu item is not hidden',
      400,
      'MENU_ITEM_NOT_HIDDEN',
    );
  }

  const updated = await MenuItemModel.updateById(menuItemId, {
    is_hidden_by_admin: false,
    hidden_reason: null,
  });

  if (!updated) {
    throw new AppError(
      'Unhide failed — menu item may have been removed concurrently',
      409,
      'MENU_ITEM_UNHIDE_CONFLICT',
    );
  }

  await AuditLogModel.createAuditLog({
    user_id: adminUserId,
    action: 'unhide_menu_item',
    entity_type: 'menu_item',
    entity_id: menuItemId,
    old_data: { is_hidden_by_admin: true },
    new_data: { is_hidden_by_admin: false },
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  // Размер очереди изменился — счётчики рейла обязаны это увидеть
  // сразу, иначе бейдж до полминуты показывал бы число, которое
  // модератор только что сам и поменял.
  invalidateBadges();
  // Снимок «Здоровья данных» считает ровно ту же величину (hanging_flags).
  // Без сброса рейл слева показывал бы новое число, а карточка «Флаги без
  // реакции» справа — прежнее, до двух минут, в одном окне. Модерация
  // ЗАВЕДЕНИЙ снимок намеренно НЕ сбрасывает: там пересчёт достижимости
  // всего каталога на каждое одобрение, и это совсем другая цена.
  invalidateHealth();

  logger.info('Menu item unhidden by admin', {
    menuItemId,
    adminUserId,
  });

  return updated;
};

/**
 * Dismiss a sanity_flag on a menu item (false positive).
 * Does NOT change is_hidden_by_admin — that is a separate action.
 *
 * @param {string} menuItemId - UUID
 * @param {Object} params
 * @param {string} params.adminUserId
 * @param {string} params.ipAddress
 * @param {string} params.userAgent
 * @returns {Promise<Object>} Updated menu_items row
 */
export const dismissMenuItemFlag = async (menuItemId, params) => {
  const { adminUserId, ipAddress, userAgent } = params;

  const existing = await MenuItemModel.findById(menuItemId);
  if (!existing) {
    throw new AppError('Menu item not found', 404, 'MENU_ITEM_NOT_FOUND');
  }

  if (existing.sanity_flag === null || existing.sanity_flag === undefined) {
    throw new AppError(
      'Menu item has no sanity flag to dismiss',
      400,
      'MENU_ITEM_NO_FLAG',
    );
  }

  const updated = await MenuItemModel.updateById(menuItemId, {
    sanity_flag: null,
  });

  await AuditLogModel.createAuditLog({
    user_id: adminUserId,
    action: 'dismiss_sanity_flag',
    entity_type: 'menu_item',
    entity_id: menuItemId,
    old_data: { sanity_flag: existing.sanity_flag },
    new_data: { sanity_flag: null },
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  // Размер очереди изменился — счётчики рейла обязаны это увидеть
  // сразу, иначе бейдж до полминуты показывал бы число, которое
  // модератор только что сам и поменял.
  invalidateBadges();
  // Снимок «Здоровья данных» считает ровно ту же величину (hanging_flags).
  // Без сброса рейл слева показывал бы новое число, а карточка «Флаги без
  // реакции» справа — прежнее, до двух минут, в одном окне. Модерация
  // ЗАВЕДЕНИЙ снимок намеренно НЕ сбрасывает: там пересчёт достижимости
  // всего каталога на каждое одобрение, и это совсем другая цена.
  invalidateHealth();

  logger.info('Menu item sanity flag dismissed', {
    menuItemId,
    adminUserId,
  });

  return updated;
};

/**
 * Trim a filter string, treating blank input as "no filter".
 *
 * An empty `?city=` must not become `WHERE e.city = ''`, which matches nothing and
 * would read on screen as "no flagged items in this city".
 *
 * A repeated parameter is rejected rather than ignored. Express (qs) turns
 * `?reason=a&reason=b` — and `?reason[]=a` — into an array, and treating a non-string
 * as "absent" would silently drop the filter: the moderator would then read the WHOLE
 * queue as the output of that filter and count it as such. Same failure the unknown-value
 * checks below exist to prevent, so it gets the same answer.
 */
const optionalFilter = (value, param) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new AppError(
      `Parameter ${param} must be a single value`,
      400,
      'INVALID_FILTER_VALUE',
      { param },
    );
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * List flagged menu items with establishment context for the admin queue.
 *
 * @param {Object} params
 * @param {number} [params.page=1]
 * @param {number} [params.perPage=20]
 * @param {string} [params.reason] - Filter on sanity_flag.reason (must be canonical)
 * @param {string} [params.visibility='all'] - all | visible | hidden
 * @param {string} [params.city] - Exact establishment city
 * @param {string} [params.search] - Substring of item name OR establishment name
 * @returns {Promise<{items: Object[], meta: Object}>}
 */
export const getFlaggedMenuItems = async ({
  page = 1,
  perPage = 20,
  reason,
  visibility,
  city,
  search,
} = {}) => {
  // Числовые параметры разбираются мягко (мусор → умолчание), значения-перечисления —
  // строго (мусор → 400). Асимметрия намеренная: сбитая страница видна в футере
  // «Показано 1–20 из 34» и ничего не утверждает сверх правды, а сбитый фильтр
  // молча меняет СМЫСЛ числа, которое модератор потом считает.
  const effectivePerPage = Math.min(Math.max(perPage, 1), 50);
  const requestedPage = Math.max(page, 1);
  const offset = (requestedPage - 1) * effectivePerPage;

  const requestedReason = optionalFilter(reason, 'reason');
  // An unknown reason is rejected rather than ignored. Ignoring it would answer a
  // different question than the one asked — the moderator would read the full queue
  // as "everything flagged by this rule" and count it as such.
  if (requestedReason && !SANITY_FLAG_REASONS.includes(requestedReason)) {
    throw new AppError(
      `Unknown sanity flag reason: ${requestedReason}`,
      400,
      'INVALID_SANITY_REASON',
      { allowed: SANITY_FLAG_REASONS },
    );
  }

  // Absent visibility keeps the historical population (everything, hidden included):
  // callers that never learned about the parameter must not have their contract
  // changed under them. The admin screen sends its own choice explicitly.
  const requestedVisibility = optionalFilter(visibility, 'visibility') ?? 'all';
  if (!MenuItemModel.VISIBILITY_MODES.includes(requestedVisibility)) {
    throw new AppError(
      `Unknown visibility mode: ${requestedVisibility}`,
      400,
      'INVALID_VISIBILITY_MODE',
      { allowed: MenuItemModel.VISIBILITY_MODES },
    );
  }

  const { items, total, counts, cities } = await MenuItemModel.getFlaggedItems({
    limit: effectivePerPage,
    offset,
    reason: requestedReason,
    visibility: requestedVisibility,
    city: optionalFilter(city, 'city'),
    search: optionalFilter(search, 'search'),
  });

  return {
    items,
    meta: {
      total,
      // Обе половины популяции, независимо от выбранной видимости, — и НЕ полем
      // `hidden`, как у соседа-эндпоинта отзывов: там `hidden` считается ВНУТРИ
      // `total`, здесь на вкладке «Скрытые» он и есть `total`. Одно имя с двумя
      // смыслами на двух админских экранах даёт ложную подпись у того, кто
      // переиспользует разбор.
      counts,
      page: requestedPage,
      per_page: effectivePerPage,
      // `|| 1`, как у остальных списков этого файла: пустая выборка — это одна
      // пустая страница, а не ноль страниц. Клиент читает `pages` с фолбэком на
      // null, и ноль сквозь него проходит как настоящее число.
      pages: Math.ceil(total / effectivePerPage) || 1,
      // Filter options travel with the page: the city list is data (only cities that
      // actually have flagged items appear), the reason list is canon (all four rules
      // are offered even when nothing currently trips one — an empty result for a rule
      // is an answer, and a missing option would look like the rule does not exist).
      cities,
      reasons: SANITY_FLAG_REASONS,
    },
  };
};
