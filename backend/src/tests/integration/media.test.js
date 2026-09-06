/* eslint-env jest */
/* eslint comma-dangle: 0 */
/**
 * Media Management System Integration Tests
 *
 * Tests all media management endpoints and business logic:
 * - Upload media with Cloudinary integration (mocked)
 * - Unified upload limits (30 photos per bucket, tier-independent)
 * - Media listing and filtering
 * - Primary photo management
 * - Media update and deletion
 * - Ownership verification
 * - File validation
 */

import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { jest } from '@jest/globals';
import { clearAllData } from '../utils/database.js';
import { createPartnerAndGetToken, createTestEstablishment } from '../utils/auth.js';
// Module-relative temp dir every multer destination writes to (backend/tmp/uploads).
// Importing it does not touch cloudinary.js, so it is safe ahead of the mock below.
import { TEMP_UPLOAD_DIR } from '../../middleware/upload.js';

// Mock Cloudinary for ES modules — all 7 exports + default
let app;
let pool;
let cloudinary;

jest.unstable_mockModule('../../config/cloudinary.js', () => ({
  uploadImage: jest.fn(async () => ({
    public_id: 'test-public-id',
    secure_url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/test/interior/test.jpg',
    width: 800,
    height: 600,
    format: 'jpg',
  })),
  uploadAvatar: jest.fn(async () => ({
    public_id: 'avatars/test-user-id/test-avatar',
    secure_url: 'https://res.cloudinary.com/test/image/upload/w_256,h_256,c_fill/avatars/test-user-id/test-avatar.jpg',
  })),
  uploadPdf: jest.fn(async () => ({
    public_id: 'test-pdf-public-id',
    secure_url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/test/menu_pdf/test.pdf',
    bytes: 1024,
    pages: 1,
  })),
  generateAllResolutions: jest.fn(() => ({
    url: 'https://res.cloudinary.com/test/image/upload/w_1920,h_1080,c_limit/test-public-id.jpg',
    thumbnail_url: 'https://res.cloudinary.com/test/image/upload/w_200,h_150,c_fill/test-public-id.jpg',
    preview_url: 'https://res.cloudinary.com/test/image/upload/w_800,h_600,c_fit/test-public-id.jpg',
  })),
  generateImageUrl: jest.fn(() => 'https://res.cloudinary.com/test/image/upload/test-public-id.jpg'),
  generatePdfThumbnailUrl: jest.fn(() => 'https://res.cloudinary.com/test/image/upload/pg_1,w_200,h_150,c_fill,f_jpg/test-pdf-public-id.jpg'),
  generatePdfPreviewUrl: jest.fn(() => 'https://res.cloudinary.com/test/image/upload/pg_1,w_800,h_600,c_fit,f_jpg/test-pdf-public-id.jpg'),
  generatePdfPageImageUrl: jest.fn((url, page) => url.replace('/upload/', `/upload/pg_${page}/`).replace(/\.pdf$/i, '.jpg')),
  deleteImage: jest.fn(async () => ({ result: 'ok' })),
  extractPublicIdFromUrl: jest.fn(() => 'test-public-id'),
  isValidImageType: jest.fn(() => true),
  isValidImageSize: jest.fn(() => true),
  isValidPdfType: jest.fn(() => true),
  isValidPdfSize: jest.fn(() => true),
  // Extension gates mirror the real logic — the format-rejection tests below
  // exercise real semantics, not a stub.
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

/**
 * Entries that appeared in TEMP_UPLOAD_DIR since `before` (a Set snapshot of
 * the listing). On rejection paths the Cloudinary stub is never reached, so
 * the temp file is tracked through the directory instead of the upload call.
 */
const newEntriesSince = (before) =>
  fs.readdirSync(TEMP_UPLOAD_DIR).filter((name) => !before.has(name));

/**
 * Poll `predicate` until it holds or `timeoutMs` passes. Used where the temp
 * file is discarded right after the response is sent (express-validator
 * rejections in `validate`): the client can see the 422 before the unlink lands.
 */
const waitUntil = async (predicate, timeoutMs = 2000, stepMs = 20) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
};

// Setup and teardown
beforeAll(async () => {
  // Ensure multer's temp directory exists — the module-relative one the routes
  // actually write to, never a cwd-relative string (cwd differs local vs Railway).
  fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

  const appModule = await import('../../server.js');
  app = appModule.default || appModule.app;
  const poolModule = await import('../../config/database.js');
  pool = poolModule.default;
  cloudinary = await import('../../config/cloudinary.js');
});

beforeEach(async () => {
  await clearAllData();

  if (cloudinary) {
    cloudinary.uploadImage.mockResolvedValue({
      public_id: 'test-public-id',
      secure_url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/test/interior/test.jpg',
      width: 800,
      height: 600,
      format: 'jpg',
    });
    cloudinary.generateAllResolutions.mockReturnValue({
      url: 'https://res.cloudinary.com/test/image/upload/w_1920,h_1080,c_limit/test-public-id.jpg',
      thumbnail_url: 'https://res.cloudinary.com/test/image/upload/w_200,h_150,c_fill/test-public-id.jpg',
      preview_url: 'https://res.cloudinary.com/test/image/upload/w_800,h_600,c_fit/test-public-id.jpg',
    });
    cloudinary.generateImageUrl.mockReturnValue('https://res.cloudinary.com/test/image/upload/test-public-id.jpg');
    cloudinary.deleteImage.mockResolvedValue({ result: 'ok' });
    cloudinary.extractPublicIdFromUrl.mockReturnValue('test-public-id');
    cloudinary.isValidImageType.mockReturnValue(true);
    cloudinary.isValidImageSize.mockReturnValue(true);
    cloudinary.isValidPdfType.mockReturnValue(true);
    cloudinary.isValidPdfSize.mockReturnValue(true);
    cloudinary.hasValidImageExtension.mockImplementation((name) => /\.(jpe?g|png|webp|heic|jfif)$/i.test(String(name || '').split('?')[0]));
    cloudinary.hasValidPdfExtension.mockImplementation((name) => /\.pdf$/i.test(String(name || '').split('?')[0]));
    cloudinary.fileExtension.mockImplementation((name) => {
      const base = String(name || '').split('?')[0];
      const seg = base.slice(base.lastIndexOf('/') + 1);
      const dot = seg.lastIndexOf('.');
      return dot === -1 ? '' : seg.slice(dot + 1).toLowerCase();
    });
    cloudinary.uploadPdf.mockResolvedValue({
      public_id: 'test-pdf-public-id',
      secure_url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/test/menu_pdf/test.pdf',
      bytes: 1024,
      pages: 1,
    });
    cloudinary.generatePdfThumbnailUrl.mockReturnValue('https://res.cloudinary.com/test/image/upload/pg_1,w_200,h_150,c_fill,f_jpg/test-pdf-public-id.jpg');
    cloudinary.generatePdfPreviewUrl.mockReturnValue('https://res.cloudinary.com/test/image/upload/pg_1,w_800,h_600,c_fit,f_jpg/test-pdf-public-id.jpg');
  }
});

afterAll(async () => {
  await clearAllData();
  if (pool) {
    await pool.end();
  }
});

describe('Media System - Upload Operations', () => {
  let partner;
  let partnerToken;
  let establishment;

  beforeEach(async () => {
    const partnerData = await createPartnerAndGetToken();
    partner = partnerData.partner;
    partnerToken = partnerData.token;

    establishment = await createTestEstablishment(partner.id);
  });

  describe('POST /api/v1/partner/establishments/:id/media - Upload Media', () => {
    test('should upload interior photo successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('caption', 'Main dining area')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.type).toBe('interior');
      expect(response.body.data.caption).toBe('Main dining area');
      expect(response.body.data.url).toContain('cloudinary.com');
      expect(response.body.data.thumbnail_url).toBeDefined();
      expect(response.body.data.preview_url).toBeDefined();
    });

    test('should upload menu photo successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .field('caption', 'Main menu page 1')
        .attach('file', Buffer.from('fake image'), 'menu.jpg')
        .expect(201);

      expect(response.body.data.type).toBe('menu');
    });

    test('should upload exterior photo successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'exterior')
        .attach('file', Buffer.from('fake image'), 'exterior.jpg')
        .expect(201);

      expect(response.body.data.type).toBe('exterior');
    });

    test('should upload dishes photo successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'dishes')
        .attach('file', Buffer.from('fake image'), 'dish.jpg')
        .expect(201);

      expect(response.body.data.type).toBe('dishes');
    });

    test('should reject invalid media type', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'invalid-type')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(422);

      // Caught by express-validator before reaching service
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('should reject upload without authentication', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(401);
    });

    test('should reject upload to other partner\'s establishment', async () => {
      const otherPartner = await createPartnerAndGetToken();

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${otherPartner.token}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(404);
    });

    test('should reject invalid file type', async () => {
      // Multer fileFilter rejects non-image, non-PDF MIME types
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake video'), 'clip.mp4')
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });

    test('should reject PDF upload with non-menu type', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('%PDF-1.4 fake'), 'menu.pdf')
        .expect(422);

      expect(response.body.error.code).toBe('PDF_TYPE_MISMATCH');
    });

    test('should upload PDF menu successfully with type=menu', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'menu.pdf', contentType: 'application/pdf' })
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.file_type).toBe('pdf');
      expect(response.body.data.type).toBe('menu');
      expect(response.body.data.is_primary).toBe(false);
    });

    // Regression (MARKS, 2026-07-20): a PDF-compatible .ai file arrives with
    // mimetype application/pdf on machines where Acrobat owns the extension.
    // The mimetype gate alone passes it; the extension gate must reject it.
    test('should reject .ai spoofed as application/pdf (menu)', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('%PDF-1.4 illustrator'), { filename: 'menu.ai', contentType: 'application/pdf' })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });

    test('should reject .ai spoofed as image/jpeg (interior)', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake'), { filename: 'photo.ai', contentType: 'image/jpeg' })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });

    test('should reject 3rd PDF upload (max 2 per establishment)', async () => {
      // Upload first 2 PDFs successfully
      for (let i = 0; i < 2; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'menu')
          .attach('file', Buffer.from(`%PDF-1.4 fake ${i}`), `menu-${i}.pdf`)
          .expect(201);
      }

      // 3rd should fail
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('%PDF-1.4 fake 3'), 'menu-3.pdf')
        .expect(403);

      expect(response.body.error.code).toBe('PDF_LIMIT_EXCEEDED');
    });

    test('should reject file exceeding size limit', async () => {
      // Mock service-level size check to reject (use small buffer to avoid multer limit)
      cloudinary.isValidImageSize.mockReturnValueOnce(false);

      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image'), 'huge.jpg')
        .expect(422);

      expect(response.body.error.code).toBe('FILE_TOO_LARGE');
    });

    // Regression (2026-09-06): multer's destination used to be the cwd-relative
    // string 'backend/tmp/uploads'. Resolved against process.cwd() — backend/
    // locally, /app on Railway — it landed in backend/backend/tmp/uploads and
    // /app/backend/tmp/uploads. The path multer hands to the service must sit
    // inside the module-relative TEMP_UPLOAD_DIR whatever the cwd is.
    test('writes the temp file into the module-relative TEMP_UPLOAD_DIR, not a cwd-relative path', async () => {
      // Existence is sampled inside the stub, at transfer time: the service may
      // one day unlink the temp file after the upload, and that must not turn
      // this cwd guard red.
      let seenOnDisk = null;
      cloudinary.uploadImage.mockImplementation(async (filePath) => {
        seenOnDisk = fs.existsSync(filePath);
        return {
          public_id: 'test-public-id',
          secure_url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/test/interior/test.jpg',
          width: 800,
          height: 600,
          format: 'jpg',
        };
      });

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(201);

      expect(cloudinary.uploadImage).toHaveBeenCalledTimes(1);
      const [tempFilePath] = cloudinary.uploadImage.mock.calls[0];
      expect(path.isAbsolute(tempFilePath)).toBe(true);
      expect(path.dirname(tempFilePath)).toBe(TEMP_UPLOAD_DIR);
      expect(seenOnDisk).toBe(true);
      fs.rmSync(tempFilePath, { force: true });
    });

    // Regression (2026-09-06): the controller removes the temp file multer
    // wrote into TEMP_UPLOAD_DIR on every outcome. Until then nothing did —
    // uploads through this route leaked one file each (tempMediaRoutes and
    // uploadAvatar unlinked theirs, mediaService never did): on Railway the
    // ephemeral disk grew until the next deploy, locally 16.7k files / 24 MB.
    describe('temp file cleanup', () => {
      test('removes the temp file after a successful image upload (201)', async () => {
        let seenOnDisk = null;
        cloudinary.uploadImage.mockImplementation(async (filePath) => {
          seenOnDisk = fs.existsSync(filePath);
          return {
            public_id: 'test-public-id',
            secure_url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/test/interior/test.jpg',
          };
        });

        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from('fake image'), 'test.jpg')
          .expect(201);

        expect(cloudinary.uploadImage).toHaveBeenCalledTimes(1);
        const [tempFilePath] = cloudinary.uploadImage.mock.calls[0];
        // Present for the transfer — gone once the response is out.
        expect(seenOnDisk).toBe(true);
        expect(fs.existsSync(tempFilePath)).toBe(false);
      });

      test('removes the temp file after a successful PDF menu upload (201)', async () => {
        let seenOnDisk = null;
        cloudinary.uploadPdf.mockImplementation(async (filePath) => {
          seenOnDisk = fs.existsSync(filePath);
          return {
            public_id: 'test-pdf-public-id',
            secure_url: 'https://res.cloudinary.com/test/image/upload/v1/establishments/test/menu_pdf/test.pdf',
            bytes: 1024,
            pages: 1,
          };
        });

        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'menu')
          .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'menu.pdf', contentType: 'application/pdf' })
          .expect(201);

        expect(cloudinary.uploadPdf).toHaveBeenCalledTimes(1);
        const [tempFilePath] = cloudinary.uploadPdf.mock.calls[0];
        expect(seenOnDisk).toBe(true);
        expect(fs.existsSync(tempFilePath)).toBe(false);
      });

      test('removes the temp file when the service rejects the file (FILE_TOO_LARGE, 422)', async () => {
        cloudinary.isValidImageSize.mockReturnValueOnce(false);
        const before = new Set(fs.readdirSync(TEMP_UPLOAD_DIR));

        const response = await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from('fake image'), 'huge.jpg')
          .expect(422);

        expect(response.body.error.code).toBe('FILE_TOO_LARGE');
        expect(cloudinary.uploadImage).not.toHaveBeenCalled();
        expect(newEntriesSince(before)).toEqual([]);
      });

      test('removes the temp file when a PDF comes with a non-menu type (PDF_TYPE_MISMATCH, 422)', async () => {
        const before = new Set(fs.readdirSync(TEMP_UPLOAD_DIR));

        const response = await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from('%PDF-1.4 fake'), 'menu.pdf')
          .expect(422);

        expect(response.body.error.code).toBe('PDF_TYPE_MISMATCH');
        expect(cloudinary.uploadPdf).not.toHaveBeenCalled();
        expect(newEntriesSince(before)).toEqual([]);
      });

      test('removes the temp file when the Cloudinary transfer fails (500)', async () => {
        cloudinary.uploadImage.mockRejectedValueOnce(new Error('cloudinary unavailable'));

        const response = await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from('fake image'), 'test.jpg')
          .expect(500);

        expect(response.body.error.code).toBe('MEDIA_UPLOAD_FAILED');
        expect(cloudinary.uploadImage).toHaveBeenCalledTimes(1);
        const [tempFilePath] = cloudinary.uploadImage.mock.calls[0];
        expect(fs.existsSync(tempFilePath)).toBe(false);
      });

      // express-validator runs after multer (it needs the parsed fields), so a
      // request it rejects is already on disk and never reaches the controller.
      // The shared `validate` middleware discards it right after answering —
      // the 422 does not wait for the disk — hence the poll.
      test('removes the temp file when express-validator rejects the request (VALIDATION_ERROR, 422)', async () => {
        const before = new Set(fs.readdirSync(TEMP_UPLOAD_DIR));

        const response = await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'invalid-type')
          .attach('file', Buffer.from('fake image'), 'test.jpg')
          .expect(422);

        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        await waitUntil(() => newEntriesSince(before).length === 0);
        expect(newEntriesSince(before)).toEqual([]);
      });
    });
  });

  describe('POST /api/v1/partner/media/upload - Temp Upload Format Gate', () => {
    // The cabinet wizard uploads through this temp endpoint BEFORE the
    // establishment exists; the .ai that broke MARKS entered here.
    test('accepts a real PDF menu', async () => {
      const response = await request(app)
        .post('/api/v1/partner/media/upload')
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'menu.pdf', contentType: 'application/pdf' })
        .expect(201);

      expect(response.body.data.file_type).toBe('pdf');
    });

    test('accepts a JPG photo', async () => {
      const response = await request(app)
        .post('/api/v1/partner/media/upload')
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
        .expect(201);

      expect(response.body.data.file_type).toBe('image');
    });

    // Same regression guard as the establishment media route above: the
    // pre-registration route had its own cwd-relative 'backend/tmp/uploads'.
    // This route unlinks the temp file right after the transfer, so only the
    // path handed to Cloudinary is checked here.
    test('writes the temp file into the module-relative TEMP_UPLOAD_DIR', async () => {
      await request(app)
        .post('/api/v1/partner/media/upload')
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
        .expect(201);

      expect(cloudinary.uploadImage).toHaveBeenCalledTimes(1);
      const [tempFilePath] = cloudinary.uploadImage.mock.calls[0];
      expect(path.isAbsolute(tempFilePath)).toBe(true);
      expect(path.dirname(tempFilePath)).toBe(TEMP_UPLOAD_DIR);
    });

    // This route validates `type` after multer as well; the file a rejected
    // request left behind is discarded by the shared `validate` middleware
    // (poll: the 422 does not wait for the disk).
    test('removes the temp file when express-validator rejects the request (VALIDATION_ERROR, 422)', async () => {
      const before = new Set(fs.readdirSync(TEMP_UPLOAD_DIR));

      const response = await request(app)
        .post('/api/v1/partner/media/upload')
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'invalid-type')
        .attach('file', Buffer.from('fake image'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      await waitUntil(() => newEntriesSince(before).length === 0);
      expect(newEntriesSince(before)).toEqual([]);
    });

    test('rejects .ai spoofed as application/pdf', async () => {
      const response = await request(app)
        .post('/api/v1/partner/media/upload')
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('%PDF-1.4 illustrator'), { filename: 'menu.ai', contentType: 'application/pdf' })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });

    test('rejects .ai spoofed as image/jpeg', async () => {
      const response = await request(app)
        .post('/api/v1/partner/media/upload')
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('fake'), { filename: 'scan.ai', contentType: 'image/jpeg' })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });
  });

  describe('Upload Limits (unified, tier-independent)', () => {
    test('allows 30 interior photos on default (free) tier', async () => {
      // No subscription_tier update — limits no longer depend on tier.
      for (let i = 0; i < 30; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`fake image ${i}`), `test-${i}.jpg`)
          .expect(201);
      }

      const mediaList = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(mediaList.body.data).toHaveLength(30);
    });

    test('rejects 31st interior photo; exterior and dishes counters unaffected', async () => {
      for (let i = 0; i < 30; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`fake image ${i}`), `test-${i}.jpg`)
          .expect(201);
      }

      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image 31'), 'test-31.jpg')
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');

      // Per-type counters: exterior and dishes have their own counts against
      // the interior limit value, so they are still accepted.
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'exterior')
        .attach('file', Buffer.from('exterior 1'), 'exterior-1.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'dishes')
        .attach('file', Buffer.from('dishes 1'), 'dishes-1.jpg')
        .expect(201);
    });

    test('rejects 31st menu photo; interior bucket unaffected', async () => {
      for (let i = 0; i < 30; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'menu')
          .attach('file', Buffer.from(`menu ${i}`), `menu-${i}.jpg`)
          .expect(201);
      }

      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('menu 31'), 'menu-31.jpg')
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');

      // Menu bucket is independent from the interior bucket.
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('interior 1'), 'interior-1.jpg')
        .expect(201);
    });
  });

  describe('Menu photo OCR enqueue (vision_image parity)', () => {
    // Enqueue is fire-and-forget after the upload response — poll briefly
    // instead of asserting immediately (avoids missing-await flakiness).
    // Бюджет 8000, а не 2000 — см. тот же приём в establishments.test.js.
    async function pollJobs(establishmentId, expected, timeoutMs = 8000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const res = await pool.query(
          'SELECT media_id, status FROM ocr_jobs WHERE establishment_id = $1',
          [establishmentId],
        );
        if (res.rows.length >= expected) return res.rows;
        if (Date.now() > deadline) {
          throw new Error(
            `OCR-задачи не появились за ${timeoutMs} мс: ожидалось ${expected}, получено ${res.rows.length}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    test('menu photo upload enqueues a pending OCR job for that media', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('menu photo'), 'menu-photo.jpg')
        .expect(201);

      const jobs = await pollJobs(establishment.id, 1);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe('pending');

      const media = await pool.query(
        "SELECT id FROM establishment_media WHERE establishment_id = $1 AND type = 'menu' AND file_type = 'image'",
        [establishment.id],
      );
      expect(jobs[0].media_id).toBe(media.rows[0].id);
    });

    test('interior photo upload does NOT enqueue an OCR job', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('interior photo'), 'interior-photo.jpg')
        .expect(201);

      // Fixed grace period — polling for absence is not possible.
      await new Promise((resolve) => setTimeout(resolve, 150));

      const jobs = await pool.query(
        'SELECT id FROM ocr_jobs WHERE establishment_id = $1',
        [establishment.id],
      );
      expect(jobs.rows).toHaveLength(0);
    });
  });

  describe('GET /api/v1/partner/establishments/:id/media - List Media', () => {
    test('should list all media for establishment', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('photo 1'), 'photo1.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('photo 2'), 'photo2.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('menu 1'), 'menu1.jpg')
        .expect(201);

      const response = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(3);
    });

    test('should filter media by type', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('interior'), 'interior.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .attach('file', Buffer.from('menu'), 'menu.jpg')
        .expect(201);

      const interiorResponse = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media?type=interior`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(interiorResponse.body.data).toHaveLength(1);
      expect(interiorResponse.body.data[0].type).toBe('interior');

      const menuResponse = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media?type=menu`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(menuResponse.body.data).toHaveLength(1);
      expect(menuResponse.body.data[0].type).toBe('menu');
    });

    test('should return empty array for establishment with no media', async () => {
      const response = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(0);
    });

    test('should reject access to other partner\'s media', async () => {
      const otherPartner = await createPartnerAndGetToken();

      await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${otherPartner.token}`)
        .expect(404);
    });
  });

  describe('Primary Photo Management', () => {
    test('should set photo as primary on upload', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('primary photo'), 'primary.jpg')
        .expect(201);

      expect(response.body.data.is_primary).toBe(true);
    });

    test('should have only one primary photo', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('first primary'), 'first.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('second primary'), 'second.jpg')
        .expect(201);

      const result = await pool.query(
        'SELECT COUNT(*) as count FROM establishment_media WHERE establishment_id = $1 AND is_primary = true',
        [establishment.id]
      );

      expect(parseInt(result.rows[0].count)).toBe(1);
    });

    test('should update primary photo when existing primary is deleted', async () => {
      const first = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('first'), 'first.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('second'), 'second.jpg')
        .expect(201);

      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${first.body.data.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      const result = await pool.query(
        'SELECT COUNT(*) as count FROM establishment_media WHERE establishment_id = $1 AND is_primary = true',
        [establishment.id]
      );

      expect(parseInt(result.rows[0].count)).toBe(1);
    });

    test('should sync primary_image_url on upload with is_primary=true', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('primary photo'), 'primary.jpg')
        .expect(201);

      const estResult = await pool.query(
        'SELECT primary_image_url FROM establishments WHERE id = $1',
        [establishment.id]
      );

      expect(estResult.rows[0].primary_image_url).toBeTruthy();
      expect(estResult.rows[0].primary_image_url).toContain('cloudinary.com');
    });

    test('should update primary_image_url when primary changes via update', async () => {
      // Upload first as primary
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('first'), 'first.jpg')
        .expect(201);

      // Upload second (not primary)
      const second = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('second'), 'second.jpg')
        .expect(201);

      // Set second as primary via update
      await request(app)
        .put(`/api/v1/partner/establishments/${establishment.id}/media/${second.body.data.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ is_primary: true })
        .expect(200);

      const estAfter = await pool.query(
        'SELECT primary_image_url FROM establishments WHERE id = $1',
        [establishment.id]
      );

      // primary_image_url should still be set (synced to new primary)
      expect(estAfter.rows[0].primary_image_url).toBeTruthy();
      expect(estAfter.rows[0].primary_image_url).toContain('cloudinary.com');
    });

    test('should update primary_image_url when primary is deleted and auto-promoted', async () => {
      // Upload first as primary, second as non-primary
      const first = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('first'), 'first.jpg')
        .expect(201);

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('second'), 'second.jpg')
        .expect(201);

      // Delete primary
      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${first.body.data.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      // primary_image_url should be synced to the auto-promoted photo
      const estResult = await pool.query(
        'SELECT primary_image_url FROM establishments WHERE id = $1',
        [establishment.id]
      );

      expect(estResult.rows[0].primary_image_url).toBeTruthy();
      expect(estResult.rows[0].primary_image_url).toContain('cloudinary.com');
    });

    test('should clear primary_image_url when last photo is deleted', async () => {
      // Upload single primary photo
      const photo = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('only photo'), 'only.jpg')
        .expect(201);

      // Delete it
      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${photo.body.data.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      // primary_image_url should be null
      const estResult = await pool.query(
        'SELECT primary_image_url FROM establishments WHERE id = $1',
        [establishment.id]
      );

      expect(estResult.rows[0].primary_image_url).toBeNull();
    });
  });

  describe('PUT /api/v1/partner/establishments/:id/media/:mediaId - Update Media', () => {
    let media;

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('caption', 'Original caption')
        .attach('file', Buffer.from('test'), 'test.jpg')
        .expect(201);

      media = response.body.data;
    });

    test('should update caption', async () => {
      const response = await request(app)
        .put(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ caption: 'Updated caption' })
        .expect(200);

      expect(response.body.data.caption).toBe('Updated caption');
    });

    test('should update position for reordering', async () => {
      const response = await request(app)
        .put(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ position: 5 })
        .expect(200);

      expect(response.body.data.position).toBe(5);
    });

    test('should update is_primary flag', async () => {
      const response = await request(app)
        .put(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ is_primary: true })
        .expect(200);

      expect(response.body.data.is_primary).toBe(true);
    });

    test('should reject update to other partner\'s media', async () => {
      const otherPartner = await createPartnerAndGetToken();

      await request(app)
        .put(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${otherPartner.token}`)
        .send({ caption: 'Hacked' })
        .expect(404);
    });
  });

  describe('DELETE /api/v1/partner/establishments/:id/media/:mediaId - Delete Media', () => {
    let media;

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('test'), 'test.jpg')
        .expect(201);

      media = response.body.data;
    });

    test('should delete media successfully', async () => {
      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      const result = await pool.query(
        'SELECT * FROM establishment_media WHERE id = $1',
        [media.id]
      );
      expect(result.rows).toHaveLength(0);

      expect(cloudinary.deleteImage).toHaveBeenCalled();
    });

    test('should delete from database even if Cloudinary fails', async () => {
      cloudinary.deleteImage.mockRejectedValueOnce(new Error('Cloudinary error'));

      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      const result = await pool.query(
        'SELECT * FROM establishment_media WHERE id = $1',
        [media.id]
      );
      expect(result.rows).toHaveLength(0);
    });

    test('should reject deletion of other partner\'s media', async () => {
      const otherPartner = await createPartnerAndGetToken();

      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${otherPartner.token}`)
        .expect(404);

      const result = await pool.query(
        'SELECT * FROM establishment_media WHERE id = $1',
        [media.id]
      );
      expect(result.rows).toHaveLength(1);
    });

    test('should return 404 for non-existent media', async () => {
      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(404);
    });
  });
});

describe('Media System - Edge Cases', () => {
  let partner;
  let partnerToken;
  let establishment;

  beforeEach(async () => {
    const partnerData = await createPartnerAndGetToken();
    partner = partnerData.partner;
    partnerToken = partnerData.token;

    establishment = await createTestEstablishment(partner.id);
  });

  test('should handle concurrent uploads correctly', async () => {
    const uploads = [
      request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('photo 1'), 'photo1.jpg'),

      request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('photo 2'), 'photo2.jpg'),

      request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('photo 3'), 'photo3.jpg'),
    ];

    const results = await Promise.all(uploads);

    results.forEach(response => {
      expect(response.status).toBe(201);
    });

    const mediaList = await request(app)
      .get(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    expect(mediaList.body.data).toHaveLength(3);
  });

  test('should handle rapid upload and delete', async () => {
    const upload = await request(app)
      .post(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .field('type', 'interior')
      .attach('file', Buffer.from('test'), 'test.jpg')
      .expect(201);

    const mediaId = upload.body.data.id;

    await request(app)
      .delete(`/api/v1/partner/establishments/${establishment.id}/media/${mediaId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    const result = await pool.query(
      'SELECT * FROM establishment_media WHERE id = $1',
      [mediaId]
    );
    expect(result.rows).toHaveLength(0);
  });

  test('should handle caption with special characters', async () => {
    const response = await request(app)
      .post(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .field('type', 'interior')
      .field('caption', 'Интерьер ресторана: главный зал! @#$%^&*()')
      .attach('file', Buffer.from('test'), 'test.jpg')
      .expect(201);

    expect(response.body.data.caption).toBe('Интерьер ресторана: главный зал! @#$%^&*()');
  });

  test('should handle maximum length caption', async () => {
    const maxCaption = 'А'.repeat(255);

    const response = await request(app)
      .post(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .field('type', 'interior')
      .field('caption', maxCaption)
      .attach('file', Buffer.from('test'), 'test.jpg')
      .expect(201);

    expect(response.body.data.caption).toBe(maxCaption);
  });
});
