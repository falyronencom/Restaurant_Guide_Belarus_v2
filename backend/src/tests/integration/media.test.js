/**
 * Media Management System Integration Tests
 *
 * Tests all media management endpoints and business logic:
 * - Upload media with Cloudinary integration (mocked)
 * - Tier-based upload limits (free, basic, standard, premium)
 * - Media listing and filtering
 * - Primary photo management
 * - Media update and deletion
 * - Ownership verification
 * - File validation
 */

import request from 'supertest';
import path from 'path';
import { fileURLToPath } from 'url';
import { clearAllData } from '../utils/database.js';
import { createPartnerAndGetToken, createTestEstablishment } from '../utils/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock Cloudinary before importing app
jest.mock('../../config/cloudinary.js', () => ({
  uploadImage: jest.fn().mockResolvedValue({
    public_id: 'test-establishment/interior/test-image-123',
    url: 'https://res.cloudinary.com/test-cloud/image/upload/v1234567890/test-establishment/interior/test-image-123.jpg',
  }),
  deleteImage: jest.fn().mockResolvedValue({ result: 'ok' }),
  isValidImageType: jest.fn().mockImplementation((mimetype) => {
    return ['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(mimetype);
  }),
  isValidImageSize: jest.fn().mockImplementation((size) => {
    return size <= 10 * 1024 * 1024; // 10MB
  }),
  generateAllResolutions: jest.fn().mockImplementation((publicId) => ({
    url: `https://res.cloudinary.com/test-cloud/image/upload/${publicId}.jpg`,
    thumbnail_url: `https://res.cloudinary.com/test-cloud/image/upload/w_200,h_200,c_fill/${publicId}.jpg`,
    preview_url: `https://res.cloudinary.com/test-cloud/image/upload/w_800,h_600,c_fit/${publicId}.jpg`,
  })),
  extractPublicIdFromUrl: jest.fn().mockImplementation((url) => {
    const match = url.match(/upload\/(?:v\d+\/)?(.+)\.\w+$/);
    return match ? match[1] : null;
  }),
}));

let app;
let pool;

// Setup and teardown
beforeAll(async () => {
  // Import app after mocking Cloudinary
  const appModule = await import('../../server.js');
  app = appModule.default || appModule.app;
  pool = getPool();
});

beforeEach(async () => {
  await clearAllData();
  jest.clearAllMocks();
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
    // Create partner and establishment
    const partnerData = await createPartnerAndGetToken();
    partner = partnerData.partner;
    partnerToken = partnerData.token;

    establishment = await createTestEstablishment(partner.id, {
      name: 'Test Restaurant',
      city: 'Минск',
      subscription_tier: 'free',
    });
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
      expect(response.body.data.media).toHaveProperty('id');
      expect(response.body.data.media.type).toBe('interior');
      expect(response.body.data.media.caption).toBe('Main dining area');
      expect(response.body.data.media.url).toContain('cloudinary.com');
      expect(response.body.data.media.thumbnail_url).toBeDefined();
      expect(response.body.data.media.preview_url).toBeDefined();
    });

    test('should upload menu photo successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'menu')
        .field('caption', 'Main menu page 1')
        .attach('file', Buffer.from('fake image'), 'menu.jpg')
        .expect(201);

      expect(response.body.data.media.type).toBe('menu');
    });

    test('should upload exterior photo successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'exterior')
        .attach('file', Buffer.from('fake image'), 'exterior.jpg')
        .expect(201);

      expect(response.body.data.media.type).toBe('exterior');
    });

    test('should upload dishes photo successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'dishes')
        .attach('file', Buffer.from('fake image'), 'dish.jpg')
        .expect(201);

      expect(response.body.data.media.type).toBe('dishes');
    });

    test('should reject invalid media type', async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'invalid-type')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_MEDIA_TYPE');
    });

    test('should reject upload without authentication', async () => {
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(401);
    });

    test('should reject upload to other partner\'s establishment', async () => {
      // Create another partner
      const otherPartner = await createPartnerAndGetToken();

      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${otherPartner.token}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image'), 'test.jpg')
        .expect(404);
    });

    test('should reject invalid file type', async () => {
      // Mock Cloudinary to reject file type
      const cloudinary = await import('../../config/cloudinary.js');
      cloudinary.isValidImageType.mockReturnValueOnce(false);

      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake pdf'), 'document.pdf')
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_FILE_TYPE');
    });

    test('should reject file exceeding size limit', async () => {
      // Mock Cloudinary to reject file size
      const cloudinary = await import('../../config/cloudinary.js');
      cloudinary.isValidImageSize.mockReturnValueOnce(false);

      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.alloc(11 * 1024 * 1024), 'huge.jpg') // 11MB
        .expect(422);

      expect(response.body.error.code).toBe('FILE_TOO_LARGE');
    });
  });

  describe('Tier-Based Upload Limits', () => {
    test('FREE tier: should allow 10 interior photos', async () => {
      // Upload 10 photos (should succeed)
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`fake image ${i}`), `test-${i}.jpg`)
          .expect(201);
      }

      // Verify 10 photos uploaded
      const mediaList = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(mediaList.body.data.media).toHaveLength(10);
    });

    test('FREE tier: should reject 11th interior photo', async () => {
      // Upload 10 photos
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`fake image ${i}`), `test-${i}.jpg`)
          .expect(201);
      }

      // Try to upload 11th photo (should fail)
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image 11'), 'test-11.jpg')
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');
      expect(response.body.error.message).toContain('free tier allows 10');
    });

    test('FREE tier: should allow 10 menu photos separately from interior', async () => {
      // Upload 10 interior photos
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`interior ${i}`), `interior-${i}.jpg`)
          .expect(201);
      }

      // Upload 10 menu photos (should succeed - separate limit)
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'menu')
          .attach('file', Buffer.from(`menu ${i}`), `menu-${i}.jpg`)
          .expect(201);
      }

      // Verify 20 total photos (10 interior + 10 menu)
      const mediaList = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(mediaList.body.data.media).toHaveLength(20);
    });

    test('PREMIUM tier: should allow 30 interior photos', async () => {
      // Update establishment to premium tier
      await pool.query(
        'UPDATE establishments SET subscription_tier = $1 WHERE id = $2',
        ['premium', establishment.id]
      );

      // Upload 30 photos (should succeed)
      for (let i = 0; i < 30; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`fake image ${i}`), `test-${i}.jpg`)
          .expect(201);
      }

      // Verify 30 photos uploaded
      const mediaList = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(mediaList.body.data.media).toHaveLength(30);
    });

    test('PREMIUM tier: should reject 31st interior photo', async () => {
      // Update to premium tier
      await pool.query(
        'UPDATE establishments SET subscription_tier = $1 WHERE id = $2',
        ['premium', establishment.id]
      );

      // Upload 30 photos
      for (let i = 0; i < 30; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`fake image ${i}`), `test-${i}.jpg`)
          .expect(201);
      }

      // Try to upload 31st photo (should fail)
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .attach('file', Buffer.from('fake image 31'), 'test-31.jpg')
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');
      expect(response.body.error.message).toContain('premium tier allows 30');
    });

    test('exterior and dishes types use interior limit', async () => {
      // Upload 5 interior, 3 exterior, 2 dishes = 10 total (at limit)
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'interior')
          .attach('file', Buffer.from(`interior ${i}`), `interior-${i}.jpg`)
          .expect(201);
      }

      for (let i = 0; i < 3; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'exterior')
          .attach('file', Buffer.from(`exterior ${i}`), `exterior-${i}.jpg`)
          .expect(201);
      }

      for (let i = 0; i < 2; i++) {
        await request(app)
          .post(`/api/v1/partner/establishments/${establishment.id}/media`)
          .set('Authorization', `Bearer ${partnerToken}`)
          .field('type', 'dishes')
          .attach('file', Buffer.from(`dish ${i}`), `dish-${i}.jpg`)
          .expect(201);
      }

      // Try one more (should fail - interior limit reached)
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'dishes')
        .attach('file', Buffer.from('one more dish'), 'dish-extra.jpg')
        .expect(403);

      expect(response.body.error.code).toBe('MEDIA_LIMIT_EXCEEDED');
    });
  });

  describe('GET /api/v1/partner/establishments/:id/media - List Media', () => {
    test('should list all media for establishment', async () => {
      // Upload 3 photos
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

      expect(response.body.data.media).toHaveLength(3);
    });

    test('should filter media by type', async () => {
      // Upload different types
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

      // Filter by interior
      const interiorResponse = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media?type=interior`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(interiorResponse.body.data.media).toHaveLength(1);
      expect(interiorResponse.body.data.media[0].type).toBe('interior');

      // Filter by menu
      const menuResponse = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media?type=menu`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(menuResponse.body.data.media).toHaveLength(1);
      expect(menuResponse.body.data.media[0].type).toBe('menu');
    });

    test('should return empty array for establishment with no media', async () => {
      const response = await request(app)
        .get(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      expect(response.body.data.media).toHaveLength(0);
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

      expect(response.body.data.media.is_primary).toBe(true);
    });

    test('should have only one primary photo', async () => {
      // Upload first photo as primary
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('first primary'), 'first.jpg')
        .expect(201);

      // Upload second photo as primary
      await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('is_primary', 'true')
        .attach('file', Buffer.from('second primary'), 'second.jpg')
        .expect(201);

      // Check that only one is primary
      const result = await pool.query(
        'SELECT COUNT(*) as count FROM media WHERE establishment_id = $1 AND is_primary = true',
        [establishment.id]
      );

      expect(parseInt(result.rows[0].count)).toBe(1);
    });

    test('should update primary photo when existing primary is deleted', async () => {
      // Upload 2 photos, first is primary
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

      // Delete primary photo
      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${first.body.data.media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      // Check that second photo became primary
      const result = await pool.query(
        'SELECT COUNT(*) as count FROM media WHERE establishment_id = $1 AND is_primary = true',
        [establishment.id]
      );

      expect(parseInt(result.rows[0].count)).toBe(1);
    });
  });

  describe('PATCH /api/v1/partner/establishments/:id/media/:mediaId - Update Media', () => {
    let media;

    beforeEach(async () => {
      const response = await request(app)
        .post(`/api/v1/partner/establishments/${establishment.id}/media`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .field('type', 'interior')
        .field('caption', 'Original caption')
        .attach('file', Buffer.from('test'), 'test.jpg')
        .expect(201);

      media = response.body.data.media;
    });

    test('should update caption', async () => {
      const response = await request(app)
        .patch(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ caption: 'Updated caption' })
        .expect(200);

      expect(response.body.data.media.caption).toBe('Updated caption');
    });

    test('should update position for reordering', async () => {
      const response = await request(app)
        .patch(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ position: 5 })
        .expect(200);

      expect(response.body.data.media.position).toBe(5);
    });

    test('should update is_primary flag', async () => {
      const response = await request(app)
        .patch(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .send({ is_primary: true })
        .expect(200);

      expect(response.body.data.media.is_primary).toBe(true);
    });

    test('should reject update to other partner\'s media', async () => {
      const otherPartner = await createPartnerAndGetToken();

      await request(app)
        .patch(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
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

      media = response.body.data.media;
    });

    test('should delete media successfully', async () => {
      const cloudinary = await import('../../config/cloudinary.js');

      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      // Verify deleted from database
      const result = await pool.query(
        'SELECT * FROM media WHERE id = $1',
        [media.id]
      );
      expect(result.rows).toHaveLength(0);

      // Verify Cloudinary deletion called
      expect(cloudinary.deleteImage).toHaveBeenCalled();
    });

    test('should delete from database even if Cloudinary fails', async () => {
      const cloudinary = await import('../../config/cloudinary.js');
      cloudinary.deleteImage.mockRejectedValueOnce(new Error('Cloudinary error'));

      await request(app)
        .delete(`/api/v1/partner/establishments/${establishment.id}/media/${media.id}`)
        .set('Authorization', `Bearer ${partnerToken}`)
        .expect(200);

      // Verify still deleted from database
      const result = await pool.query(
        'SELECT * FROM media WHERE id = $1',
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

      // Verify NOT deleted
      const result = await pool.query(
        'SELECT * FROM media WHERE id = $1',
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

    establishment = await createTestEstablishment(partner.id, {
      name: 'Test Restaurant',
      city: 'Минск',
      subscription_tier: 'free',
    });
  });

  test('should handle concurrent uploads correctly', async () => {
    // Upload 3 photos concurrently
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

    // All should succeed
    results.forEach(response => {
      expect(response.status).toBe(201);
    });

    // Verify 3 photos uploaded
    const mediaList = await request(app)
      .get(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    expect(mediaList.body.data.media).toHaveLength(3);
  });

  test('should handle rapid upload and delete', async () => {
    // Upload photo
    const upload = await request(app)
      .post(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .field('type', 'interior')
      .attach('file', Buffer.from('test'), 'test.jpg')
      .expect(201);

    const mediaId = upload.body.data.media.id;

    // Immediately delete
    await request(app)
      .delete(`/api/v1/partner/establishments/${establishment.id}/media/${mediaId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    // Verify deleted
    const result = await pool.query(
      'SELECT * FROM media WHERE id = $1',
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

    expect(response.body.data.media.caption).toBe('Интерьер ресторана: главный зал! @#$%^&*()');
  });

  test('should handle very long caption', async () => {
    const longCaption = 'А'.repeat(500);

    const response = await request(app)
      .post(`/api/v1/partner/establishments/${establishment.id}/media`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .field('type', 'interior')
      .field('caption', longCaption)
      .attach('file', Buffer.from('test'), 'test.jpg')
      .expect(201);

    expect(response.body.data.media.caption).toBe(longCaption);
  });
});
