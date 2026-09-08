/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Unit Tests: adminService.js
 *
 * Inter-Horizon Audit Phase 3 Category B Task Brief #4 — fills the unit-test
 * coverage gap for the largest backend service (1288 LOC). Companion to
 * existing integration tests in admin-*.test.js — focuses on edge cases,
 * side-effect verification at service boundary, and error paths not exercised
 * at HTTP level.
 *
 * Tier 1 (must-cover): transactional methods, methods with multi-table side
 * effects, status-transition methods, Component 8 menu-item moderation.
 * Tier 2 (should-cover): JSON-parse normalization, search edge cases.
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Mocks (must be set up before service import)
// ============================================================================

jest.unstable_mockModule('../../models/establishmentModel.js', () => ({
  findEstablishmentById: jest.fn(),
  getPendingEstablishments: jest.fn(),
  countPendingEstablishments: jest.fn(),
  moderateEstablishment: jest.fn(),
  changeEstablishmentStatus: jest.fn(),
  getActiveEstablishments: jest.fn(),
  countActiveEstablishments: jest.fn(),
  getSuspendedEstablishments: jest.fn(),
  countSuspendedEstablishments: jest.fn(),
  searchAllEstablishments: jest.fn(),
  countSearchResults: jest.fn(),
  updateEstablishment: jest.fn(),
  claimEstablishment: jest.fn(),
}));

jest.unstable_mockModule('../../models/mediaModel.js', () => ({
  getEstablishmentMedia: jest.fn(),
  getOcrEligibleMedia: jest.fn(),
}));

jest.unstable_mockModule('../../models/menuItemModel.js', () => ({
  findById: jest.fn(),
  updateById: jest.fn(),
  getFlaggedItems: jest.fn(),
  // Не функция, но экспорт: `getFlaggedMenuItems` сверяет по нему режим видимости.
  // Мок без него молча отдал бы undefined, и валидация упала бы на `.includes`
  // вместо того, чтобы отвергнуть неизвестный режим.
  VISIBILITY_MODES: ['all', 'visible', 'hidden'],
}));

jest.unstable_mockModule('../../models/ocrJobModel.js', () => ({
  hasCompletedJobForMedia: jest.fn(),
  enqueue: jest.fn(),
}));

jest.unstable_mockModule('../../models/partnerDocumentsModel.js', () => ({
  findByEstablishmentId: jest.fn(),
}));

jest.unstable_mockModule('../../models/auditLogModel.js', () => ({
  createAuditLog: jest.fn(),
  getRejectionHistory: jest.fn(),
  countRejections: jest.fn(),
  getLatestEntityAction: jest.fn(),
}));

jest.unstable_mockModule('../../services/notificationService.js', () => ({
  notifyEstablishmentStatusChange: jest.fn(),
  notifyEstablishmentClaimed: jest.fn(),
}));

jest.unstable_mockModule('../../services/establishmentService.js', () => ({
  BELARUS_BOUNDS: {
    LAT_MIN: 51.0,
    LAT_MAX: 56.5,
    LON_MIN: 23.0,
    LON_MAX: 33.0,
  },
  CITY_BOUNDS: {},
  validateCityCoordinates: jest.fn(),
}));

jest.unstable_mockModule('../../services/authService.js', () => ({
  upgradeUserToPartner: jest.fn(),
}));

jest.unstable_mockModule('../../services/badgesService.js', () => ({
  invalidateCache: jest.fn(),
}));

jest.unstable_mockModule('../../config/database.js', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  // pool/default must exist: modules deeper in adminService's graph
  // (badgesModel, reached via badgesService) do `import pool from '../config/database.js'`.
  // An ESM mock factory that omits them fails the WHOLE suite at link time.
  pool: { query: jest.fn(), connect: jest.fn(), end: jest.fn() },
  default: { query: jest.fn(), connect: jest.fn(), end: jest.fn() },
}));

jest.unstable_mockModule('../../middleware/errorHandler.js', () => ({
  AppError: class AppError extends Error {
    constructor(message, statusCode, code) {
      super(message);
      this.name = 'AppError';
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ============================================================================
// Imports (after mocking)
// ============================================================================

const EstablishmentModel = await import('../../models/establishmentModel.js');
const MediaModel = await import('../../models/mediaModel.js');
const MenuItemModel = await import('../../models/menuItemModel.js');
const OcrJobModel = await import('../../models/ocrJobModel.js');
const PartnerDocumentsModel = await import('../../models/partnerDocumentsModel.js');
const AuditLogModel = await import('../../models/auditLogModel.js');
const NotificationService = await import('../../services/notificationService.js');
const EstablishmentService = await import('../../services/establishmentService.js');
const AuthService = await import('../../services/authService.js');
const DB = await import('../../config/database.js');

const {
  moderateEstablishment,
  suspendEstablishment,
  unsuspendEstablishment,
  claimEstablishment,
  adminUpgradeUserToPartner,
  updateEstablishmentCoordinates,
  searchUsers,
  hideMenuItem,
  unhideMenuItem,
  dismissMenuItemFlag,
  getEstablishmentForModeration,
  getRejectedEstablishments,
  getSuspendedEstablishments,
} = await import('../../services/adminService.js');

// ============================================================================
// Helpers + Fixtures
// ============================================================================

const ADMIN_ID = uuidv4();
const EST_ID = uuidv4();
const PARTNER_ID = uuidv4();
const TARGET_USER_ID = uuidv4();
const MENU_ITEM_ID = uuidv4();

// Drains pending microtasks/macrotasks — needed for fire-and-forget IIFE
// (e.g. the OCR backfill block in moderateEstablishment is not awaited)
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const buildMockClient = () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  release: jest.fn(),
});

const buildReq = () => ({
  ip: '127.0.0.1',
  get: jest.fn((header) => (header === 'User-Agent' ? 'TestAgent/1.0' : null)),
});

const baseEstablishment = (overrides = {}) => ({
  id: EST_ID,
  partner_id: PARTNER_ID,
  name: 'Тестовое заведение',
  status: 'pending',
  city: 'Минск',
  address: 'Test address',
  latitude: '53.9',
  longitude: '27.5667',
  moderation_notes: null,
  published_at: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...overrides,
});

beforeEach(() => {
  // jest.config has resetMocks:true — re-set Promise-returning mocks per test.
  AuditLogModel.createAuditLog.mockResolvedValue(undefined);
  NotificationService.notifyEstablishmentStatusChange.mockResolvedValue(undefined);
  NotificationService.notifyEstablishmentClaimed.mockResolvedValue(undefined);
  MediaModel.getOcrEligibleMedia.mockResolvedValue([]);
  MediaModel.getEstablishmentMedia.mockResolvedValue([]);
  PartnerDocumentsModel.findByEstablishmentId.mockResolvedValue(null);
  OcrJobModel.hasCompletedJobForMedia.mockResolvedValue(false);
  OcrJobModel.enqueue.mockResolvedValue(undefined);
  EstablishmentService.validateCityCoordinates.mockReturnValue({ valid: true });
});

// ============================================================================
// moderateEstablishment — Tier 1
// ============================================================================

describe('moderateEstablishment', () => {
  const baseParams = {
    action: 'approve',
    moderation_notes: {},
    adminUserId: ADMIN_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
  };

  test('rejects unknown action with INVALID_MODERATION_ACTION', async () => {
    await expect(
      moderateEstablishment(EST_ID, { ...baseParams, action: 'delete' }),
    ).rejects.toMatchObject({
      code: 'INVALID_MODERATION_ACTION',
      statusCode: 400,
    });
    expect(EstablishmentModel.findEstablishmentById).not.toHaveBeenCalled();
  });

  test('throws ESTABLISHMENT_NOT_FOUND when establishment is missing', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);
    await expect(moderateEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'ESTABLISHMENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  test('rejects with INVALID_STATUS_FOR_MODERATION when status is not pending', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    await expect(moderateEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'INVALID_STATUS_FOR_MODERATION',
      statusCode: 400,
    });
  });

  test('approve transitions status to active with setPublishedAt=true', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    const result = await moderateEstablishment(EST_ID, { ...baseParams, action: 'approve' });
    await flushPromises();

    expect(result.status).toBe('active');
    expect(EstablishmentModel.moderateEstablishment).toHaveBeenCalledWith(
      EST_ID,
      expect.objectContaining({
        status: 'active',
        moderated_by: ADMIN_ID,
        setPublishedAt: true,
      }),
    );
  });

  test('reject transitions status to rejected and propagates moderation_notes', async () => {
    const notes = { name: 'Misleading name', description: 'Too vague' };
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'rejected' }),
    );

    const result = await moderateEstablishment(EST_ID, {
      ...baseParams,
      action: 'reject',
      moderation_notes: notes,
    });

    expect(result.status).toBe('rejected');
    expect(EstablishmentModel.moderateEstablishment).toHaveBeenCalledWith(
      EST_ID,
      expect.objectContaining({
        status: 'rejected',
        moderation_notes: notes,
        setPublishedAt: false,
      }),
    );
  });

  test('approve writes audit_log entry with action=moderate_approve', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    await moderateEstablishment(EST_ID, { ...baseParams, action: 'approve' });
    await flushPromises();

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'moderate_approve',
        entity_type: 'establishment',
        entity_id: EST_ID,
        old_data: { status: 'pending' },
        new_data: expect.objectContaining({ status: 'active' }),
        ip_address: '127.0.0.1',
        user_agent: 'TestAgent/1.0',
      }),
    );
  });

  test('reject writes audit_log entry with action=moderate_reject and notes', async () => {
    const notes = { description: 'unclear' };
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'rejected' }),
    );

    await moderateEstablishment(EST_ID, {
      ...baseParams,
      action: 'reject',
      moderation_notes: notes,
    });

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'moderate_reject',
        new_data: { status: 'rejected', moderation_notes: notes },
      }),
    );
  });

  test('approve notifies partner without rejection reason (null)', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    await moderateEstablishment(EST_ID, { ...baseParams, action: 'approve' });
    await flushPromises();

    expect(NotificationService.notifyEstablishmentStatusChange).toHaveBeenCalledWith(
      EST_ID,
      'active',
      null,
    );
  });

  test('reject notifies partner with moderation_notes as third argument', async () => {
    const notes = { name: 'incorrect' };
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'rejected' }),
    );

    await moderateEstablishment(EST_ID, {
      ...baseParams,
      action: 'reject',
      moderation_notes: notes,
    });

    expect(NotificationService.notifyEstablishmentStatusChange).toHaveBeenCalledWith(
      EST_ID,
      'rejected',
      notes,
    );
  });

  test('throws MODERATION_CONFLICT when Model.moderateEstablishment returns null', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(null);

    await expect(moderateEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'MODERATION_CONFLICT',
      statusCode: 409,
    });
  });

  test('approve enqueues OCR jobs for eligible media (PDFs + menu photos) without completed job', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    const pdf1 = { id: uuidv4() };
    const menuPhoto = { id: uuidv4() };
    MediaModel.getOcrEligibleMedia.mockResolvedValue([pdf1, menuPhoto]);
    OcrJobModel.hasCompletedJobForMedia.mockResolvedValue(false);

    await moderateEstablishment(EST_ID, { ...baseParams, action: 'approve' });
    await flushPromises();

    expect(MediaModel.getOcrEligibleMedia).toHaveBeenCalledWith(EST_ID);
    expect(OcrJobModel.enqueue).toHaveBeenCalledTimes(2);
    expect(OcrJobModel.enqueue).toHaveBeenCalledWith({
      establishmentId: EST_ID,
      mediaId: pdf1.id,
    });
    expect(OcrJobModel.enqueue).toHaveBeenCalledWith({
      establishmentId: EST_ID,
      mediaId: menuPhoto.id,
    });
  });

  test('approve skips OCR enqueue for eligible media with completed job (idempotency)', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentModel.moderateEstablishment.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    const mediaDone = { id: uuidv4() };
    const mediaPending = { id: uuidv4() };
    MediaModel.getOcrEligibleMedia.mockResolvedValue([mediaDone, mediaPending]);
    OcrJobModel.hasCompletedJobForMedia
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await moderateEstablishment(EST_ID, { ...baseParams, action: 'approve' });
    await flushPromises();

    expect(OcrJobModel.enqueue).toHaveBeenCalledTimes(1);
    expect(OcrJobModel.enqueue).toHaveBeenCalledWith({
      establishmentId: EST_ID,
      mediaId: mediaPending.id,
    });
  });

  test('wraps unexpected errors as MODERATION_FAILED 500', async () => {
    EstablishmentModel.findEstablishmentById.mockRejectedValue(new Error('DB connection lost'));

    await expect(moderateEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'MODERATION_FAILED',
      statusCode: 500,
    });
  });
});

// ============================================================================
// suspendEstablishment — Tier 1
// ============================================================================

describe('suspendEstablishment', () => {
  const baseParams = {
    reason: 'Violates community guidelines',
    adminUserId: ADMIN_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
  };

  test('rejects when reason is undefined', async () => {
    await expect(
      suspendEstablishment(EST_ID, { ...baseParams, reason: undefined }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED', statusCode: 400 });
    expect(EstablishmentModel.findEstablishmentById).not.toHaveBeenCalled();
  });

  test('rejects when reason is whitespace only', async () => {
    await expect(
      suspendEstablishment(EST_ID, { ...baseParams, reason: '   ' }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED', statusCode: 400 });
  });

  test('throws ESTABLISHMENT_NOT_FOUND when establishment is missing', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);
    await expect(suspendEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'ESTABLISHMENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  test('rejects with INVALID_STATUS_FOR_SUSPEND when status is not active', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'pending' }),
    );
    await expect(suspendEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'INVALID_STATUS_FOR_SUSPEND',
      statusCode: 400,
    });
  });

  test('suspends active establishment and merges reason into empty moderation_notes', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active', moderation_notes: null }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );

    const result = await suspendEstablishment(EST_ID, baseParams);

    expect(result.status).toBe('suspended');
    expect(EstablishmentModel.changeEstablishmentStatus).toHaveBeenCalledWith(
      EST_ID,
      expect.objectContaining({
        fromStatus: 'active',
        toStatus: 'suspended',
        moderationNotes: expect.objectContaining({
          suspend_reason: baseParams.reason,
          suspended_at: expect.any(String),
        }),
      }),
    );
  });

  test('preserves existing string-encoded moderation_notes when merging suspend reason', async () => {
    const existingNotes = JSON.stringify({ description: 'old comment' });
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active', moderation_notes: existingNotes }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );

    await suspendEstablishment(EST_ID, baseParams);

    expect(EstablishmentModel.changeEstablishmentStatus).toHaveBeenCalledWith(
      EST_ID,
      expect.objectContaining({
        moderationNotes: expect.objectContaining({
          description: 'old comment',
          suspend_reason: baseParams.reason,
        }),
      }),
    );
  });

  test('preserves existing object moderation_notes when merging suspend reason', async () => {
    const existingNotes = { name: 'name issue' };
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active', moderation_notes: existingNotes }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );

    await suspendEstablishment(EST_ID, baseParams);

    expect(EstablishmentModel.changeEstablishmentStatus).toHaveBeenCalledWith(
      EST_ID,
      expect.objectContaining({
        moderationNotes: expect.objectContaining({
          name: 'name issue',
          suspend_reason: baseParams.reason,
        }),
      }),
    );
  });

  test('throws SUSPEND_CONFLICT when changeEstablishmentStatus returns null', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(null);

    await expect(suspendEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'SUSPEND_CONFLICT',
      statusCode: 409,
    });
  });

  test('writes audit_log entry with action=suspend and reason in new_data', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );

    await suspendEstablishment(EST_ID, baseParams);

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'suspend',
        entity_type: 'establishment',
        entity_id: EST_ID,
        old_data: { status: 'active' },
        new_data: { status: 'suspended', reason: baseParams.reason },
      }),
    );
  });

  test('notifies partner with suspended status and reason', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );

    await suspendEstablishment(EST_ID, baseParams);

    expect(NotificationService.notifyEstablishmentStatusChange).toHaveBeenCalledWith(
      EST_ID,
      'suspended',
      baseParams.reason,
    );
  });
});

// ============================================================================
// unsuspendEstablishment — Tier 1
// ============================================================================

describe('unsuspendEstablishment', () => {
  const baseParams = {
    adminUserId: ADMIN_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
  };

  test('throws ESTABLISHMENT_NOT_FOUND when establishment is missing', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);
    await expect(unsuspendEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'ESTABLISHMENT_NOT_FOUND',
      statusCode: 404,
    });
  });

  test('rejects with INVALID_STATUS_FOR_UNSUSPEND when status is not suspended', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );
    await expect(unsuspendEstablishment(EST_ID, baseParams)).rejects.toMatchObject({
      code: 'INVALID_STATUS_FOR_UNSUSPEND',
      statusCode: 400,
    });
  });

  test('reactivates suspended establishment to active', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    const result = await unsuspendEstablishment(EST_ID, baseParams);

    expect(result.status).toBe('active');
    expect(EstablishmentModel.changeEstablishmentStatus).toHaveBeenCalledWith(
      EST_ID,
      { fromStatus: 'suspended', toStatus: 'active' },
    );
  });

  test('writes audit_log entry with action=unsuspend', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    await unsuspendEstablishment(EST_ID, baseParams);

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'unsuspend',
        entity_type: 'establishment',
        entity_id: EST_ID,
        old_data: { status: 'suspended' },
        new_data: { status: 'active' },
      }),
    );
  });

  test('notifies partner with distinct unsuspended type (no reason argument)', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'suspended' }),
    );
    EstablishmentModel.changeEstablishmentStatus.mockResolvedValue(
      baseEstablishment({ status: 'active' }),
    );

    await unsuspendEstablishment(EST_ID, baseParams);

    expect(NotificationService.notifyEstablishmentStatusChange).toHaveBeenCalledWith(
      EST_ID,
      'unsuspended',
    );
  });
});

// ============================================================================
// claimEstablishment — Tier 1 (transactional)
// ============================================================================

describe('claimEstablishment', () => {
  const activeUser = { id: TARGET_USER_ID, role: 'user', is_active: true };

  test('throws ESTABLISHMENT_NOT_FOUND when establishment is missing', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'ESTABLISHMENT_NOT_FOUND', statusCode: 404 });
    expect(DB.getClient).not.toHaveBeenCalled();
  });

  test('throws ESTABLISHMENT_ARCHIVED for archived establishment', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ status: 'archived' }),
    );

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'ESTABLISHMENT_ARCHIVED', statusCode: 400 });
  });

  test('throws ALREADY_OWNED when target user already owns the establishment', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ partner_id: TARGET_USER_ID }),
    );

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'ALREADY_OWNED', statusCode: 400 });
  });

  test('throws USER_NOT_FOUND when target user does not exist', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [] });

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
    expect(DB.getClient).not.toHaveBeenCalled();
  });

  test('throws USER_INACTIVE when target user account is deactivated', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [{ ...activeUser, is_active: false }] });

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'USER_INACTIVE', statusCode: 400 });
  });

  test('completes transaction on user→partner upgrade: BEGIN, claim, UPDATE role, COMMIT', async () => {
    const updated = baseEstablishment({ partner_id: TARGET_USER_ID });
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [activeUser] });
    EstablishmentModel.claimEstablishment.mockResolvedValue(updated);
    const client = buildMockClient();
    DB.getClient.mockResolvedValue(client);

    const result = await claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq());

    expect(result).toEqual(updated);
    const queries = client.query.mock.calls.map((c) => c[0]);
    expect(queries).toContain('BEGIN');
    expect(queries).toContain('COMMIT');
    expect(queries).not.toContain('ROLLBACK');
    expect(EstablishmentModel.claimEstablishment).toHaveBeenCalledWith(
      EST_ID,
      TARGET_USER_ID,
      ADMIN_ID,
      client,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users SET role = 'partner'"),
      [expect.any(Date), TARGET_USER_ID],
    );
    expect(client.release).toHaveBeenCalled();
  });

  test('skips role UPDATE for user already in partner role (idempotent)', async () => {
    const partnerUser = { id: TARGET_USER_ID, role: 'partner', is_active: true };
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [partnerUser] });
    EstablishmentModel.claimEstablishment.mockResolvedValue(baseEstablishment());
    const client = buildMockClient();
    DB.getClient.mockResolvedValue(client);

    await claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq());

    const updateUserCalls = client.query.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('UPDATE users'),
    );
    expect(updateUserCalls).toHaveLength(0);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('rolls back transaction and throws CLAIM_FAILED when claim model errors', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [activeUser] });
    EstablishmentModel.claimEstablishment.mockRejectedValue(new Error('FK violation'));
    const client = buildMockClient();
    DB.getClient.mockResolvedValue(client);

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'CLAIM_FAILED', statusCode: 500 });

    const queries = client.query.mock.calls.map((c) => c[0]);
    expect(queries).toContain('ROLLBACK');
    expect(queries).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
    expect(AuditLogModel.createAuditLog).not.toHaveBeenCalled();
    expect(NotificationService.notifyEstablishmentClaimed).not.toHaveBeenCalled();
  });

  test('always releases client even when transaction fails', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [activeUser] });
    EstablishmentModel.claimEstablishment.mockRejectedValue(new Error('boom'));
    const client = buildMockClient();
    DB.getClient.mockResolvedValue(client);

    await expect(
      claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'CLAIM_FAILED' });

    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('writes audit_log with previous and new partner_id', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [activeUser] });
    EstablishmentModel.claimEstablishment.mockResolvedValue(baseEstablishment());
    DB.getClient.mockResolvedValue(buildMockClient());

    await claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq());

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'claim_establishment',
        entity_type: 'establishment',
        entity_id: EST_ID,
        old_data: { partner_id: PARTNER_ID },
        new_data: { partner_id: TARGET_USER_ID },
        ip_address: '127.0.0.1',
        user_agent: 'TestAgent/1.0',
      }),
    );
  });

  test('triggers claimed notification for the new partner', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    DB.query.mockResolvedValue({ rows: [activeUser] });
    EstablishmentModel.claimEstablishment.mockResolvedValue(baseEstablishment());
    DB.getClient.mockResolvedValue(buildMockClient());

    await claimEstablishment(EST_ID, TARGET_USER_ID, ADMIN_ID, buildReq());

    expect(NotificationService.notifyEstablishmentClaimed).toHaveBeenCalledWith(
      EST_ID,
      TARGET_USER_ID,
    );
  });
});

// ============================================================================
// adminUpgradeUserToPartner — Tier 1
// ============================================================================

describe('adminUpgradeUserToPartner', () => {
  test('throws USER_NOT_FOUND when target user does not exist', async () => {
    DB.query.mockResolvedValue({ rows: [] });

    await expect(
      adminUpgradeUserToPartner(TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
    expect(AuthService.upgradeUserToPartner).not.toHaveBeenCalled();
  });

  test('throws USER_INACTIVE when target user is deactivated', async () => {
    DB.query.mockResolvedValue({
      rows: [{ id: TARGET_USER_ID, role: 'user', is_active: false }],
    });

    await expect(
      adminUpgradeUserToPartner(TARGET_USER_ID, ADMIN_ID, buildReq()),
    ).rejects.toMatchObject({ code: 'USER_INACTIVE', statusCode: 400 });
    expect(AuthService.upgradeUserToPartner).not.toHaveBeenCalled();
  });

  test('upgrades user role and writes audit_log with old_role=user', async () => {
    DB.query.mockResolvedValue({
      rows: [{ id: TARGET_USER_ID, role: 'user', is_active: true }],
    });
    AuthService.upgradeUserToPartner.mockResolvedValue({
      id: TARGET_USER_ID,
      role: 'partner',
    });

    const result = await adminUpgradeUserToPartner(TARGET_USER_ID, ADMIN_ID, buildReq());

    expect(result.role).toBe('partner');
    expect(AuthService.upgradeUserToPartner).toHaveBeenCalledWith(TARGET_USER_ID);
    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'upgrade_user_to_partner',
        entity_type: 'user',
        entity_id: TARGET_USER_ID,
        old_data: { role: 'user' },
        new_data: { role: 'partner' },
      }),
    );
  });

  test('still calls upgradeUserToPartner for already-partner user (idempotent)', async () => {
    DB.query.mockResolvedValue({
      rows: [{ id: TARGET_USER_ID, role: 'partner', is_active: true }],
    });
    AuthService.upgradeUserToPartner.mockResolvedValue({
      id: TARGET_USER_ID,
      role: 'partner',
    });

    await adminUpgradeUserToPartner(TARGET_USER_ID, ADMIN_ID, buildReq());

    expect(AuthService.upgradeUserToPartner).toHaveBeenCalledWith(TARGET_USER_ID);
    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        old_data: { role: 'partner' },
        new_data: { role: 'partner' },
      }),
    );
  });

  test('passes req.ip and User-Agent into audit log', async () => {
    DB.query.mockResolvedValue({
      rows: [{ id: TARGET_USER_ID, role: 'user', is_active: true }],
    });
    AuthService.upgradeUserToPartner.mockResolvedValue({
      id: TARGET_USER_ID,
      role: 'partner',
    });
    const req = buildReq();

    await adminUpgradeUserToPartner(TARGET_USER_ID, ADMIN_ID, req);

    expect(req.get).toHaveBeenCalledWith('User-Agent');
    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        ip_address: '127.0.0.1',
        user_agent: 'TestAgent/1.0',
      }),
    );
  });
});

// ============================================================================
// updateEstablishmentCoordinates — Tier 1
// ============================================================================

describe('updateEstablishmentCoordinates', () => {
  // Within mocked BELARUS_BOUNDS (LAT 51..56.5, LON 23..33)
  const validParams = {
    latitude: 53.9,
    longitude: 27.5667,
    adminUserId: ADMIN_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
  };

  test('throws ESTABLISHMENT_NOT_FOUND when establishment is missing', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

    await expect(
      updateEstablishmentCoordinates(EST_ID, validParams),
    ).rejects.toMatchObject({ code: 'ESTABLISHMENT_NOT_FOUND', statusCode: 404 });
  });

  test('throws INVALID_LATITUDE when latitude below Belarus bounds', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());

    await expect(
      updateEstablishmentCoordinates(EST_ID, { ...validParams, latitude: 50.0 }),
    ).rejects.toMatchObject({ code: 'INVALID_LATITUDE', statusCode: 422 });
  });

  test('throws INVALID_LATITUDE when latitude above Belarus bounds', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());

    await expect(
      updateEstablishmentCoordinates(EST_ID, { ...validParams, latitude: 57.0 }),
    ).rejects.toMatchObject({ code: 'INVALID_LATITUDE', statusCode: 422 });
  });

  test('throws INVALID_LONGITUDE when longitude is out of Belarus bounds', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());

    await expect(
      updateEstablishmentCoordinates(EST_ID, { ...validParams, longitude: 22.0 }),
    ).rejects.toMatchObject({ code: 'INVALID_LONGITUDE', statusCode: 422 });
  });

  test('throws COORDINATES_CITY_MISMATCH when validateCityCoordinates rejects', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    EstablishmentService.validateCityCoordinates.mockReturnValue({
      valid: false,
      message: 'Coordinates do not match city',
    });

    await expect(
      updateEstablishmentCoordinates(EST_ID, validParams),
    ).rejects.toMatchObject({ code: 'COORDINATES_CITY_MISMATCH', statusCode: 422 });
    expect(EstablishmentModel.updateEstablishment).not.toHaveBeenCalled();
  });

  test('updates coordinates on valid input', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(baseEstablishment());
    const updated = baseEstablishment({ latitude: validParams.latitude, longitude: validParams.longitude });
    EstablishmentModel.updateEstablishment.mockResolvedValue(updated);

    const result = await updateEstablishmentCoordinates(EST_ID, validParams);

    expect(result).toEqual(updated);
    expect(EstablishmentModel.updateEstablishment).toHaveBeenCalledWith(
      EST_ID,
      { latitude: validParams.latitude, longitude: validParams.longitude },
    );
  });

  test('writes audit_log with parsed old coords and new coords', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ latitude: '53.5', longitude: '27.0' }),
    );
    EstablishmentModel.updateEstablishment.mockResolvedValue(baseEstablishment());

    await updateEstablishmentCoordinates(EST_ID, validParams);

    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'admin_update_coordinates',
        entity_type: 'establishment',
        entity_id: EST_ID,
        old_data: { latitude: 53.5, longitude: 27.0 },
        new_data: { latitude: validParams.latitude, longitude: validParams.longitude },
      }),
    );
  });
});

// ============================================================================
// searchUsers — Tier 2 (raw SQL, no model layer)
// ============================================================================

describe('searchUsers', () => {
  test('returns empty array for queries shorter than 2 chars', async () => {
    expect(await searchUsers(null)).toEqual([]);
    expect(await searchUsers('')).toEqual([]);
    expect(await searchUsers(' ')).toEqual([]);
    expect(await searchUsers('a')).toEqual([]);
    expect(DB.query).not.toHaveBeenCalled();
  });

  test('queries users with ILIKE wildcards around trimmed query and provided limit', async () => {
    const rows = [
      { id: uuidv4(), email: 'user@example.com', name: 'Иван', role: 'user' },
    ];
    DB.query.mockResolvedValue({ rows });

    const result = await searchUsers('  Иван  ', 5);

    expect(result).toEqual(rows);
    expect(DB.query).toHaveBeenCalledWith(
      expect.stringMatching(/email ILIKE \$1.*name ILIKE \$1/s),
      ['%Иван%', 5],
    );
  });

  test('uses default limit of 10 when not provided', async () => {
    DB.query.mockResolvedValue({ rows: [] });

    await searchUsers('test');

    expect(DB.query).toHaveBeenCalledWith(
      expect.any(String),
      ['%test%', 10],
    );
  });
});

// ============================================================================
// hideMenuItem — Tier 1 (Component 8)
// ============================================================================

const baseMenuItem = (overrides = {}) => ({
  id: MENU_ITEM_ID,
  establishment_id: EST_ID,
  item_name: 'Бургер',
  price_byn: 15.50,
  is_hidden_by_admin: false,
  hidden_reason: null,
  sanity_flag: null,
  ...overrides,
});

describe('hideMenuItem', () => {
  const baseParams = {
    reason: 'Inappropriate content',
    adminUserId: ADMIN_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
  };

  test('rejects when reason is undefined', async () => {
    await expect(
      hideMenuItem(MENU_ITEM_ID, { ...baseParams, reason: undefined }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED', statusCode: 400 });
    expect(MenuItemModel.findById).not.toHaveBeenCalled();
  });

  test('rejects when reason is whitespace only', async () => {
    await expect(
      hideMenuItem(MENU_ITEM_ID, { ...baseParams, reason: '   ' }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED', statusCode: 400 });
  });

  test('throws MENU_ITEM_NOT_FOUND when item is missing', async () => {
    MenuItemModel.findById.mockResolvedValue(null);

    await expect(hideMenuItem(MENU_ITEM_ID, baseParams))
      .rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND', statusCode: 404 });
  });

  test('throws MENU_ITEM_ALREADY_HIDDEN when item is already hidden', async () => {
    MenuItemModel.findById.mockResolvedValue(
      baseMenuItem({ is_hidden_by_admin: true }),
    );

    await expect(hideMenuItem(MENU_ITEM_ID, baseParams))
      .rejects.toMatchObject({ code: 'MENU_ITEM_ALREADY_HIDDEN', statusCode: 400 });
    expect(MenuItemModel.updateById).not.toHaveBeenCalled();
  });

  test('throws MENU_ITEM_HIDE_CONFLICT when updateById returns null', async () => {
    MenuItemModel.findById.mockResolvedValue(baseMenuItem());
    MenuItemModel.updateById.mockResolvedValue(null);

    await expect(hideMenuItem(MENU_ITEM_ID, baseParams))
      .rejects.toMatchObject({ code: 'MENU_ITEM_HIDE_CONFLICT', statusCode: 409 });
  });

  test('hides item with reason, writes audit log, and does NOT trigger notification (Phase 1 policy)', async () => {
    MenuItemModel.findById.mockResolvedValue(baseMenuItem());
    const updated = baseMenuItem({ is_hidden_by_admin: true, hidden_reason: baseParams.reason });
    MenuItemModel.updateById.mockResolvedValue(updated);

    const result = await hideMenuItem(MENU_ITEM_ID, baseParams);

    expect(result).toEqual(updated);
    expect(MenuItemModel.updateById).toHaveBeenCalledWith(MENU_ITEM_ID, {
      is_hidden_by_admin: true,
      hidden_reason: baseParams.reason,
    });
    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: ADMIN_ID,
        action: 'hide_menu_item',
        entity_type: 'menu_item',
        entity_id: MENU_ITEM_ID,
        old_data: { is_hidden_by_admin: false },
        new_data: { is_hidden_by_admin: true, reason: baseParams.reason },
      }),
    );
    // Phase 1 decision: no partner notification on hide
    expect(NotificationService.notifyEstablishmentStatusChange).not.toHaveBeenCalled();
    expect(NotificationService.notifyEstablishmentClaimed).not.toHaveBeenCalled();
  });
});

// ============================================================================
// unhideMenuItem — Tier 1 (Component 8)
// ============================================================================

describe('unhideMenuItem', () => {
  const baseParams = {
    adminUserId: ADMIN_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
  };

  test('throws MENU_ITEM_NOT_FOUND when item is missing', async () => {
    MenuItemModel.findById.mockResolvedValue(null);

    await expect(unhideMenuItem(MENU_ITEM_ID, baseParams))
      .rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND', statusCode: 404 });
  });

  test('throws MENU_ITEM_NOT_HIDDEN when item is not currently hidden', async () => {
    MenuItemModel.findById.mockResolvedValue(
      baseMenuItem({ is_hidden_by_admin: false }),
    );

    await expect(unhideMenuItem(MENU_ITEM_ID, baseParams))
      .rejects.toMatchObject({ code: 'MENU_ITEM_NOT_HIDDEN', statusCode: 400 });
    expect(MenuItemModel.updateById).not.toHaveBeenCalled();
  });

  test('throws MENU_ITEM_UNHIDE_CONFLICT when updateById returns null', async () => {
    MenuItemModel.findById.mockResolvedValue(
      baseMenuItem({ is_hidden_by_admin: true }),
    );
    MenuItemModel.updateById.mockResolvedValue(null);

    await expect(unhideMenuItem(MENU_ITEM_ID, baseParams))
      .rejects.toMatchObject({ code: 'MENU_ITEM_UNHIDE_CONFLICT', statusCode: 409 });
  });

  test('unhides item, clears hidden_reason, and writes audit log', async () => {
    MenuItemModel.findById.mockResolvedValue(
      baseMenuItem({ is_hidden_by_admin: true, hidden_reason: 'old reason' }),
    );
    const updated = baseMenuItem({ is_hidden_by_admin: false, hidden_reason: null });
    MenuItemModel.updateById.mockResolvedValue(updated);

    const result = await unhideMenuItem(MENU_ITEM_ID, baseParams);

    expect(result).toEqual(updated);
    expect(MenuItemModel.updateById).toHaveBeenCalledWith(MENU_ITEM_ID, {
      is_hidden_by_admin: false,
      hidden_reason: null,
    });
    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'unhide_menu_item',
        entity_type: 'menu_item',
        entity_id: MENU_ITEM_ID,
        old_data: { is_hidden_by_admin: true },
        new_data: { is_hidden_by_admin: false },
      }),
    );
  });
});

// ============================================================================
// dismissMenuItemFlag — Tier 1 (Component 8)
// ============================================================================

describe('dismissMenuItemFlag', () => {
  const baseParams = {
    adminUserId: ADMIN_ID,
    ipAddress: '127.0.0.1',
    userAgent: 'TestAgent/1.0',
  };

  test('throws MENU_ITEM_NOT_FOUND when item is missing', async () => {
    MenuItemModel.findById.mockResolvedValue(null);

    await expect(dismissMenuItemFlag(MENU_ITEM_ID, baseParams))
      .rejects.toMatchObject({ code: 'MENU_ITEM_NOT_FOUND', statusCode: 404 });
  });

  test('throws MENU_ITEM_NO_FLAG when sanity_flag is null', async () => {
    MenuItemModel.findById.mockResolvedValue(
      baseMenuItem({ sanity_flag: null }),
    );

    await expect(dismissMenuItemFlag(MENU_ITEM_ID, baseParams))
      .rejects.toMatchObject({ code: 'MENU_ITEM_NO_FLAG', statusCode: 400 });
    expect(MenuItemModel.updateById).not.toHaveBeenCalled();
  });

  test('throws MENU_ITEM_NO_FLAG when sanity_flag is undefined', async () => {
    MenuItemModel.findById.mockResolvedValue(
      baseMenuItem({ sanity_flag: undefined }),
    );

    await expect(dismissMenuItemFlag(MENU_ITEM_ID, baseParams))
      .rejects.toMatchObject({ code: 'MENU_ITEM_NO_FLAG', statusCode: 400 });
  });

  test('clears sanity_flag, writes audit log, and does NOT touch is_hidden_by_admin', async () => {
    const flag = { reason: 'price_too_high', confidence: 0.9 };
    MenuItemModel.findById.mockResolvedValue(
      baseMenuItem({ sanity_flag: flag, is_hidden_by_admin: false }),
    );
    const updated = baseMenuItem({ sanity_flag: null, is_hidden_by_admin: false });
    MenuItemModel.updateById.mockResolvedValue(updated);

    const result = await dismissMenuItemFlag(MENU_ITEM_ID, baseParams);

    expect(result).toEqual(updated);
    expect(MenuItemModel.updateById).toHaveBeenCalledWith(MENU_ITEM_ID, {
      sanity_flag: null,
    });
    // Critical: dismissing a flag must NOT change visibility — those are
    // separate admin actions per Component 8 design.
    expect(MenuItemModel.updateById).not.toHaveBeenCalledWith(
      MENU_ITEM_ID,
      expect.objectContaining({ is_hidden_by_admin: expect.anything() }),
    );
    expect(AuditLogModel.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dismiss_sanity_flag',
        entity_type: 'menu_item',
        old_data: { sanity_flag: flag },
        new_data: { sanity_flag: null },
      }),
    );
  });
});

// ============================================================================
// getEstablishmentForModeration — Tier 2 (JSON-parse normalization, type conversion)
// ============================================================================

describe('getEstablishmentForModeration', () => {
  test('throws ESTABLISHMENT_NOT_FOUND when establishment is missing', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

    await expect(getEstablishmentForModeration(EST_ID))
      .rejects.toMatchObject({ code: 'ESTABLISHMENT_NOT_FOUND', statusCode: 404 });
  });

  test('parses string-encoded moderation_notes into object', async () => {
    const notes = { name: 'unclear', description: 'misleading' };
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ moderation_notes: JSON.stringify(notes) }),
    );

    const result = await getEstablishmentForModeration(EST_ID);

    expect(result.moderation_notes).toEqual(notes);
  });

  test('falls back to null moderation_notes on malformed JSON', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ moderation_notes: '{invalid json' }),
    );

    const result = await getEstablishmentForModeration(EST_ID);

    expect(result.moderation_notes).toBeNull();
  });

  test('converts string latitude/longitude to numbers via parseFloat (and handles null)', async () => {
    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ latitude: '53.9', longitude: '27.5667' }),
    );

    const result = await getEstablishmentForModeration(EST_ID);
    expect(result.latitude).toBe(53.9);
    expect(result.longitude).toBe(27.5667);

    EstablishmentModel.findEstablishmentById.mockResolvedValue(
      baseEstablishment({ latitude: null, longitude: null }),
    );

    const nullResult = await getEstablishmentForModeration(EST_ID);
    expect(nullResult.latitude).toBeNull();
    expect(nullResult.longitude).toBeNull();
  });
});

// ============================================================================
// getRejectedEstablishments — Tier 2 (per-row JSON normalization)
// ============================================================================

describe('getRejectedEstablishments', () => {
  test('parses string-encoded moderation_notes for each rejection row', async () => {
    AuditLogModel.getRejectionHistory.mockResolvedValue([
      { id: 'r1', moderation_notes: JSON.stringify({ name: 'a' }) },
      { id: 'r2', moderation_notes: JSON.stringify({ description: 'b' }) },
    ]);
    AuditLogModel.countRejections.mockResolvedValue(2);

    const result = await getRejectedEstablishments({ page: 1, perPage: 10 });

    expect(result.rejections).toHaveLength(2);
    expect(result.rejections[0].moderation_notes).toEqual({ name: 'a' });
    expect(result.rejections[1].moderation_notes).toEqual({ description: 'b' });
    expect(result.meta.total).toBe(2);
  });

  test('falls back to null for rows with malformed JSON moderation_notes', async () => {
    AuditLogModel.getRejectionHistory.mockResolvedValue([
      { id: 'r1', moderation_notes: '{invalid' },
      { id: 'r2', moderation_notes: null },
    ]);
    AuditLogModel.countRejections.mockResolvedValue(2);

    const result = await getRejectedEstablishments({});

    expect(result.rejections[0].moderation_notes).toBeNull();
    expect(result.rejections[1].moderation_notes).toBeNull();
  });
});

// ============================================================================
// getSuspendedEstablishments — Tier 2 (per-row JSON normalization)
// ============================================================================

describe('getSuspendedEstablishments', () => {
  test('parses string-encoded moderation_notes per suspended row', async () => {
    EstablishmentModel.getSuspendedEstablishments.mockResolvedValue([
      { id: EST_ID, moderation_notes: JSON.stringify({ suspend_reason: 'violations' }) },
    ]);
    EstablishmentModel.countSuspendedEstablishments.mockResolvedValue(1);

    const result = await getSuspendedEstablishments({ page: 1, perPage: 20 });

    expect(result.establishments[0].moderation_notes).toEqual({
      suspend_reason: 'violations',
    });
    expect(result.meta.total).toBe(1);
  });

  test('falls back to null for malformed JSON in suspended row', async () => {
    EstablishmentModel.getSuspendedEstablishments.mockResolvedValue([
      { id: EST_ID, moderation_notes: 'not valid json' },
    ]);
    EstablishmentModel.countSuspendedEstablishments.mockResolvedValue(1);

    const result = await getSuspendedEstablishments({});

    expect(result.establishments[0].moderation_notes).toBeNull();
  });
});
