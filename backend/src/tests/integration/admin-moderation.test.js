/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Admin Moderation Integration Tests
 *
 * Tests core moderation endpoints (Segment A — Phase 3):
 *   #2  GET  /api/v1/admin/establishments/pending    — list pending queue
 *   #6  GET  /api/v1/admin/establishments/:id        — establishment detail
 *   #7  POST /api/v1/admin/establishments/:id/moderate — approve / reject
 *   #8  POST /api/v1/admin/establishments/:id/suspend  — suspend active
 *   #9  POST /api/v1/admin/establishments/:id/unsuspend — reactivate suspended
 *
 * Setup strategy:
 *   beforeAll  — create admin, partner, regular user (reused across tests)
 *   beforeEach — truncate establishments (each test starts clean)
 *   afterAll   — clearAllData()

 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query } from '../utils/database.js';
import { testUsers } from '../fixtures/users.js';
import {
  createAdminAndGetToken,
  createViewerAndGetToken,
  createPartnerWithEstablishment,
  getEstablishmentFromDb,
  checkAuditLogExists,
} from '../utils/adminTestHelpers.js';

let adminToken;
let adminUserId;
let viewerToken;

beforeAll(async () => {
  const admin = await createAdminAndGetToken();
  adminToken = admin.accessToken;
  adminUserId = admin.user.id;
  const viewer = await createViewerAndGetToken();
  viewerToken = viewer.accessToken;
  // Regular user and partner are created per-test via createPartnerWithEstablishment
});

beforeEach(async () => {
  // Each test starts with an empty establishments table
  await query('TRUNCATE TABLE establishments CASCADE');
});

afterAll(async () => {
  await clearAllData();
});

// ============================================================================
// #2 — GET /api/v1/admin/establishments/pending
// ============================================================================

describe('GET /api/v1/admin/establishments/pending (#2)', () => {
  test('should return empty list when no pending establishments', async () => {
    const response = await request(app)
      .get('/api/v1/admin/establishments/pending')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(0);
    expect(response.body.meta).toBeDefined();
    expect(response.body.meta.total).toBe(0);
  });

  test('should return only pending establishments', async () => {
    // Create one pending and one active establishment
    await createPartnerWithEstablishment('pending');
    await createPartnerWithEstablishment('active');

    const response = await request(app)
      .get('/api/v1/admin/establishments/pending')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta.total).toBe(1);

    // Endpoint is pending-only — verify items have required fields
    // Note: getPendingEstablishments SELECT does not include status column
    response.body.data.forEach(est => {
      expect(est.id).toBeDefined();
      expect(est.name).toBeDefined();
      expect(est.city).toBeDefined();
    });
  });

  test('should return multiple pending establishments', async () => {
    await createPartnerWithEstablishment('pending');
    await createPartnerWithEstablishment('pending');
    await createPartnerWithEstablishment('pending');

    const response = await request(app)
      .get('/api/v1/admin/establishments/pending')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data).toHaveLength(3);
    expect(response.body.meta.total).toBe(3);
  });

  test('should include meta pagination fields', async () => {
    await createPartnerWithEstablishment('pending');

    const response = await request(app)
      .get('/api/v1/admin/establishments/pending')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const meta = response.body.meta;
    expect(meta.total).toBeDefined();
    expect(meta.page).toBeDefined();
    expect(meta.per_page).toBeDefined();
    expect(meta.pages).toBeDefined();
    expect(meta.page).toBe(1);
  });

  test('should support page query param', async () => {
    // Create 3 pending establishments and request page 2 with per_page=2
    await createPartnerWithEstablishment('pending');
    await createPartnerWithEstablishment('pending');
    await createPartnerWithEstablishment('pending');

    const response = await request(app)
      .get('/api/v1/admin/establishments/pending?page=2&per_page=2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.meta.page).toBe(2);
    expect(response.body.meta.per_page).toBe(2);
    expect(response.body.data).toHaveLength(1); // 3 total, 2 on page 1, 1 on page 2
  });
});

// ============================================================================
// #6 — GET /api/v1/admin/establishments/:id
// ============================================================================

describe('GET /api/v1/admin/establishments/:id (#6)', () => {
  test('should return full establishment details for moderation', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');

    const response = await request(app)
      .get(`/api/v1/admin/establishments/${establishment.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    const data = response.body.data;
    expect(data.id).toBe(establishment.id);
    expect(data.name).toBe(establishment.name);
    expect(data.status).toBe('pending');
    expect(data.city).toBeDefined();
    expect(data.address).toBeDefined();
  });

  test('should return all four tab fields in response', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');

    const response = await request(app)
      .get(`/api/v1/admin/establishments/${establishment.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const data = response.body.data;

    // General info tab
    expect(data.id).toBeDefined();
    expect(data.partner_id).toBeDefined();
    expect(data.status).toBeDefined();

    // About tab
    expect(data.categories).toBeDefined();
    expect(data.cuisines).toBeDefined();
    expect(data.working_hours).toBeDefined();

    // Address tab
    expect(data.city).toBeDefined();
    expect(data.address).toBeDefined();
    expect(data.latitude).toBeDefined();
    expect(data.longitude).toBeDefined();

    // Media tab (arrays, may be empty for test establishments)
    expect(Array.isArray(data.interior_photos)).toBe(true);
    expect(Array.isArray(data.menu_media)).toBe(true);
  });

  test('should return 404 ESTABLISHMENT_NOT_FOUND for non-existent UUID', async () => {
    const response = await request(app)
      .get('/api/v1/admin/establishments/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
  });

  test('should return error for invalid UUID format', async () => {
    const response = await request(app)
      .get('/api/v1/admin/establishments/not-a-uuid')
      .set('Authorization', `Bearer ${adminToken}`);

    // Admin routes have no UUID validator — PostgreSQL rejects invalid UUID
    // Result is a 4xx/5xx error response, not success
    expect(response.body.success).toBe(false);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test('should work for establishment in any status', async () => {
    const { establishment: active } = await createPartnerWithEstablishment('active');
    const { establishment: draft } = await createPartnerWithEstablishment('draft');

    const activeResp = await request(app)
      .get(`/api/v1/admin/establishments/${active.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const draftResp = await request(app)
      .get(`/api/v1/admin/establishments/${draft.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(activeResp.body.data.status).toBe('active');
    expect(draftResp.body.data.status).toBe('draft');
  });
});

// ============================================================================
// #7 — POST /api/v1/admin/establishments/:id/moderate
// ============================================================================

describe('POST /api/v1/admin/establishments/:id/moderate (#7)', () => {
  test('should approve pending establishment → status becomes active', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('approved');

    // Verify status in DB
    const updated = await getEstablishmentFromDb(establishment.id);
    expect(updated.status).toBe('active');
  });

  test('should reject pending establishment → status becomes rejected', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject', moderation_notes: { name: 'Name is misleading' } })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toContain('rejected');

    // Verify status in DB
    const updated = await getEstablishmentFromDb(establishment.id);
    expect(updated.status).toBe('rejected');
  });

  test('should store moderation_notes on reject', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');
    const notes = { description: 'Description is too vague' };

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject', moderation_notes: notes })
      .expect(200);

    const updated = await getEstablishmentFromDb(establishment.id);
    const storedNotes = typeof updated.moderation_notes === 'string'
      ? JSON.parse(updated.moderation_notes)
      : updated.moderation_notes;

    expect(storedNotes.description).toBe(notes.description);
  });

  test('should return 400 INVALID_STATUS_FOR_MODERATION for active establishment', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_STATUS_FOR_MODERATION');
  });

  test('should return 400 INVALID_STATUS_FOR_MODERATION for draft establishment', async () => {
    const { establishment } = await createPartnerWithEstablishment('draft');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject' })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_STATUS_FOR_MODERATION');
  });

  test('should return 400 INVALID_MODERATION_ACTION for unknown action', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'delete' })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_MODERATION_ACTION');
  });

  test('should return 404 ESTABLISHMENT_NOT_FOUND for non-existent id', async () => {
    const response = await request(app)
      .post('/api/v1/admin/establishments/00000000-0000-0000-0000-000000000000/moderate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' })
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
  });

  test('should create audit_log entry after approve (if table exists)', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'approve' })
      .expect(200);

    const auditExists = await checkAuditLogExists(establishment.id, 'moderate_approve');
    expect(auditExists).toBe(true);
  });

  test('should create audit_log entry after reject (if table exists)', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/moderate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'reject' })
      .expect(200);

    const auditExists = await checkAuditLogExists(establishment.id, 'moderate_reject');
    expect(auditExists).toBe(true);
  });
});

// ============================================================================
// #6a — GET /api/v1/admin/establishments/:id — author of the suspension
//       (read back from the audit log) and what a viewer does not see
// ============================================================================

describe('GET /api/v1/admin/establishments/:id — suspended_by and viewer redaction', () => {
  test('suspended establishment carries suspended_by taken from the audit log', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Проверка авторства' })
      .expect(200);

    const response = await request(app)
      .get(`/api/v1/admin/establishments/${establishment.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const data = response.body.data;
    expect(data.status).toBe('suspended');
    expect(data.suspended_by).toEqual({
      id: adminUserId,
      name: testUsers.admin.name,
      at: expect.any(String),
    });

    // The card's own suspended_at (written as toISOString, UTC) and the audit
    // row's time must sit on the same axis: a naive-timestamp misread would
    // put them hours apart.
    const cardTime = Date.parse(data.moderation_notes.suspended_at);
    const journalTime = Date.parse(data.suspended_by.at);
    expect(Math.abs(journalTime - cardTime)).toBeLessThan(5000);
  });

  test('an establishment that is not suspended has suspended_by null', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');

    const response = await request(app)
      .get(`/api/v1/admin/establishments/${establishment.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.data.suspended_by).toBeNull();
  });

  test('viewer sees the card with partner contacts and document redacted, admin sees them', async () => {
    const { establishment, partner } = await createPartnerWithEstablishment('pending');
    await query(
      `INSERT INTO partner_documents (
        partner_id, establishment_id, document_type, document_url,
        company_name, tax_id, contact_person, contact_email
      ) VALUES ($1, $2, 'registration', $3, $4, $5, $6, $7)`,
      [
        partner.user.id,
        establishment.id,
        'https://res.cloudinary.com/test/raw/upload/registration.pdf',
        'ООО «Тестовая кухня»',
        '190000000',
        'Иван Контактов',
        'contact@test.com',
      ],
    );

    const asAdmin = await request(app)
      .get(`/api/v1/admin/establishments/${establishment.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(asAdmin.body.data.partner_data_redacted).toBe(false);
    expect(asAdmin.body.data.contact_person).toBe('Иван Контактов');
    expect(asAdmin.body.data.contact_email).toBe('contact@test.com');
    expect(asAdmin.body.data.registration_doc_url).toBe(
      'https://res.cloudinary.com/test/raw/upload/registration.pdf',
    );

    const asViewer = await request(app)
      .get(`/api/v1/admin/establishments/${establishment.id}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    const data = asViewer.body.data;
    expect(data.partner_data_redacted).toBe(true);
    expect(data.contact_person).toBeNull();
    expect(data.contact_email).toBeNull();
    expect(data.registration_doc_url).toBeNull();
    // The company itself stays visible: it is not personal data.
    expect(data.legal_name).toBe('ООО «Тестовая кухня»');
    expect(data.unp).toBe('190000000');
    // Everything else is the same card.
    expect(data.name).toBe(establishment.name);
    expect(data.status).toBe('pending');
  });
});

// ============================================================================
// #8 — POST /api/v1/admin/establishments/:id/suspend
// ============================================================================

describe('POST /api/v1/admin/establishments/:id/suspend (#8)', () => {
  test('should suspend active establishment → status becomes suspended', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Violates community guidelines' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Establishment suspended');

    const updated = await getEstablishmentFromDb(establishment.id);
    expect(updated.status).toBe('suspended');
  });

  test('should return 400 REASON_REQUIRED when reason is missing', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('REASON_REQUIRED');
  });

  test('should return 400 REASON_REQUIRED when reason is empty string', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: '   ' })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('REASON_REQUIRED');
  });

  test('should return 400 INVALID_STATUS_FOR_SUSPEND for pending establishment', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Some reason' })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_STATUS_FOR_SUSPEND');
  });

  test('should return 400 INVALID_STATUS_FOR_SUSPEND for already suspended establishment', async () => {
    const { establishment } = await createPartnerWithEstablishment('suspended');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Try again' })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_STATUS_FOR_SUSPEND');
  });

  test('should return 404 for non-existent establishment', async () => {
    const response = await request(app)
      .post('/api/v1/admin/establishments/00000000-0000-0000-0000-000000000000/suspend')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Some reason' })
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
  });

  test('should create audit_log entry after suspend (if table exists)', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Test suspension' })
      .expect(200);

    const auditExists = await checkAuditLogExists(establishment.id, 'suspend');
    expect(auditExists).toBe(true);
  });
});

// ============================================================================
// #9 — POST /api/v1/admin/establishments/:id/unsuspend
// ============================================================================

describe('POST /api/v1/admin/establishments/:id/unsuspend (#9)', () => {
  test('should unsuspend suspended establishment → status becomes active', async () => {
    const { establishment } = await createPartnerWithEstablishment('suspended');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/unsuspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send()
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Establishment reactivated');

    const updated = await getEstablishmentFromDb(establishment.id);
    expect(updated.status).toBe('active');
  });

  test('should return 400 INVALID_STATUS_FOR_UNSUSPEND for active establishment', async () => {
    const { establishment } = await createPartnerWithEstablishment('active');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/unsuspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_STATUS_FOR_UNSUSPEND');
  });

  test('should return 400 INVALID_STATUS_FOR_UNSUSPEND for pending establishment', async () => {
    const { establishment } = await createPartnerWithEstablishment('pending');

    const response = await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/unsuspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INVALID_STATUS_FOR_UNSUSPEND');
  });

  test('should return 404 for non-existent establishment', async () => {
    const response = await request(app)
      .post('/api/v1/admin/establishments/00000000-0000-0000-0000-000000000000/unsuspend')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
  });

  test('should create audit_log entry after unsuspend (if table exists)', async () => {
    const { establishment } = await createPartnerWithEstablishment('suspended');

    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/unsuspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const auditExists = await checkAuditLogExists(establishment.id, 'unsuspend');
    expect(auditExists).toBe(true);
  });

  test('full suspend → unsuspend cycle should restore active status', async () => {
    // Start: active
    const { establishment } = await createPartnerWithEstablishment('active');
    expect(establishment.status).toBe('active');

    // Suspend
    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Temporary closure' })
      .expect(200);

    const afterSuspend = await getEstablishmentFromDb(establishment.id);
    expect(afterSuspend.status).toBe('suspended');

    // Unsuspend
    await request(app)
      .post(`/api/v1/admin/establishments/${establishment.id}/unsuspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const afterUnsuspend = await getEstablishmentFromDb(establishment.id);
    expect(afterUnsuspend.status).toBe('active');
  });
});
