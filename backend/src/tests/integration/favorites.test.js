/**
 * Favorites System Integration Tests
 *
 * Tests user bookmarking functionality:
 * - Add to favorites (idempotent)
 * - Remove from favorites (idempotent)
 * - List favorites (pagination, rich data)
 * - Check favorite status (single)
 * - Batch status check (multiple establishments)
 * - User isolation (can't see others' favorites)
 * - CASCADE deletion (establishment deleted → favorite deleted)
 * - Statistics endpoint
 */

import request from 'supertest';
import app from '../../server.js';
import { clearAllData, query, getDefaultWorkingHours } from '../utils/database.js';
import { createUserAndGetTokens } from '../utils/auth.js';
import { testUsers } from '../fixtures/users.js';

let userToken;
let user2Token;
let partnerToken;
let userId;
let user2Id;
let partnerId;
let establishment1Id;
let establishment2Id;
let establishment3Id;

beforeAll(async () => {
  const user = await createUserAndGetTokens(testUsers.regularUser);
  const user2 = await createUserAndGetTokens(testUsers.regularUser2);
  const partner = await createUserAndGetTokens(testUsers.partner);

  userToken = user.accessToken;
  user2Token = user2.accessToken;
  partnerToken = partner.accessToken;
  userId = user.user.id;
  user2Id = user2.user.id;
  partnerId = partner.user.id;
});

beforeEach(async () => {
  await query('TRUNCATE TABLE favorites CASCADE');
  await query('TRUNCATE TABLE establishments CASCADE');

  // Create test establishments with required fields including working_hours
  const defaultWorkingHours = JSON.stringify({
    monday: { open: '10:00', close: '22:00' },
    tuesday: { open: '10:00', close: '22:00' },
    wednesday: { open: '10:00', close: '22:00' },
    thursday: { open: '10:00', close: '22:00' },
    friday: { open: '10:00', close: '23:00' },
    saturday: { open: '11:00', close: '23:00' },
    sunday: { open: '11:00', close: '22:00' }
  });

  const est1 = await query(`
    INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, working_hours, status, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Restaurant 1', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], $2::jsonb, 'active', NOW(), NOW())
    RETURNING id
  `, [partnerId, defaultWorkingHours]);
  establishment1Id = est1.rows[0].id;

  const est2 = await query(`
    INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, working_hours, status, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Restaurant 2', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Кофейня'], ARRAY['Европейская'], $2::jsonb, 'active', NOW(), NOW())
    RETURNING id
  `, [partnerId, defaultWorkingHours]);
  establishment2Id = est2.rows[0].id;

  const est3 = await query(`
    INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, working_hours, status, created_at, updated_at)
    VALUES (gen_random_uuid(), $1, 'Restaurant 3', 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Бар'], ARRAY['Американская'], $2::jsonb, 'active', NOW(), NOW())
    RETURNING id
  `, [partnerId, defaultWorkingHours]);
  establishment3Id = est3.rows[0].id;
});

afterAll(async () => {
  await clearAllData();
});

describe('Favorites System - Add to Favorites', () => {
  test('should add establishment to favorites', async () => {
    const response = await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.favorite).toBeDefined();
    expect(response.body.data.favorite.establishment_id).toBe(establishment1Id);
    expect(response.body.data.favorite.user_id).toBe(userId);
  });

  test('should return establishment details in response', async () => {
    const response = await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id })
      .expect(201);

    const favorite = response.body.data.favorite;
    expect(favorite.establishment).toBeDefined();
    expect(favorite.establishment.name).toBe('Restaurant 1');
    expect(favorite.establishment.city).toBe('Минск');
  });

  test('should be idempotent (adding same favorite twice succeeds)', async () => {
    // First add
    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id })
      .expect(201);

    // Second add (should succeed, not error)
    const response = await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id })
      .expect(200); // 200 OK, not 201 Created

    expect(response.body.success).toBe(true);
  });

  test('should reject favorite without authentication', async () => {
    const response = await request(app)
      .post('/api/v1/favorites')
      .send({ establishmentId: establishment1Id })
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  test('should reject favorite for non-existent establishment', async () => {
    const response = await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);

    expect(response.body.error.code).toBe('ESTABLISHMENT_NOT_FOUND');
  });

  test('should reject invalid establishment ID format', async () => {
    const response = await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: 'invalid-uuid' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Favorites System - Remove from Favorites', () => {
  beforeEach(async () => {
    // Add favorite before each test
    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id });
  });

  test('should remove establishment from favorites', async () => {
    const response = await request(app)
      .delete(`/api/v1/favorites/${establishment1Id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);

    // Verify removed
    const favorites = await query(
      'SELECT * FROM favorites WHERE user_id = $1 AND establishment_id = $2',
      [userId, establishment1Id]
    );
    expect(favorites.rows).toHaveLength(0);
  });

  test('should be idempotent (removing non-existent favorite succeeds)', async () => {
    // Remove once
    await request(app)
      .delete(`/api/v1/favorites/${establishment1Id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    // Remove again (should succeed)
    const response = await request(app)
      .delete(`/api/v1/favorites/${establishment1Id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
  });

  test('should reject removal without authentication', async () => {
    const response = await request(app)
      .delete(`/api/v1/favorites/${establishment1Id}`)
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('Favorites System - List Favorites', () => {
  beforeEach(async () => {
    // Add multiple favorites
    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id });

    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment2Id });
  });

  test('should list all user favorites', async () => {
    const response = await request(app)
      .get('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(response.body.data.favorites).toHaveLength(2);
    expect(response.body.data.pagination).toBeDefined();
  });

  test('should include establishment details in list', async () => {
    const response = await request(app)
      .get('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    const favorites = response.body.data.favorites;
    favorites.forEach(fav => {
      expect(fav.establishment).toBeDefined();
      expect(fav.establishment.name).toBeDefined();
      expect(fav.establishment.city).toBeDefined();
      expect(fav.establishment.address).toBeDefined();
    });
  });

  test('should paginate favorites', async () => {
    // Add more favorites
    const workingHours = getDefaultWorkingHours();
    for (let i = 0; i < 15; i++) {
      const est = await query(`
        INSERT INTO establishments (id, partner_id, name, description, city, address, latitude, longitude, categories, cuisines, working_hours, status, created_at, updated_at)
        VALUES (gen_random_uuid(), $1, $2, 'Test', 'Минск', 'Test', 53.9, 27.5, ARRAY['Ресторан'], ARRAY['Европейская'], $3::jsonb, 'active', NOW(), NOW())
        RETURNING id
      `, [partnerId, `Restaurant ${i}`, workingHours]);

      await request(app)
        .post('/api/v1/favorites')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ establishmentId: est.rows[0].id });
    }

    // Get page 1
    const page1 = await request(app)
      .get('/api/v1/favorites?page=1&limit=10')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(page1.body.data.favorites).toHaveLength(10);
    expect(page1.body.data.pagination.hasNext).toBe(true);

    // Get page 2
    const page2 = await request(app)
      .get('/api/v1/favorites?page=2&limit=10')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(page2.body.data.favorites.length).toBeGreaterThan(0);
  });

  test('should return empty array for user with no favorites', async () => {
    const response = await request(app)
      .get('/api/v1/favorites')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    expect(response.body.data.favorites).toEqual([]);
  });
});

describe('Favorites System - User Isolation', () => {
  test('should only show own favorites', async () => {
    // User 1 adds favorites
    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id });

    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment2Id });

    // User 2 adds different favorite
    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ establishmentId: establishment3Id });

    // User 1 should only see their 2 favorites
    const user1Response = await request(app)
      .get('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(user1Response.body.data.favorites).toHaveLength(2);

    // User 2 should only see their 1 favorite
    const user2Response = await request(app)
      .get('/api/v1/favorites')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    expect(user2Response.body.data.favorites).toHaveLength(1);
    expect(user2Response.body.data.favorites[0].establishment_id).toBe(establishment3Id);
  });

  test('should not allow removing other user favorites', async () => {
    // User 1 adds favorite
    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id });

    // User 2 tries to remove User 1's favorite
    await request(app)
      .delete(`/api/v1/favorites/${establishment1Id}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200); // Succeeds (idempotent), but doesn't affect User 1

    // Verify User 1 still has favorite
    const result = await query(
      'SELECT * FROM favorites WHERE user_id = $1 AND establishment_id = $2',
      [userId, establishment1Id]
    );
    expect(result.rows).toHaveLength(1);
  });
});

describe('Favorites System - Check Favorite Status', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id });
  });

  test('should return true for favorited establishment', async () => {
    const response = await request(app)
      .get(`/api/v1/favorites/check/${establishment1Id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(response.body.data.isFavorited).toBe(true);
  });

  test('should return false for non-favorited establishment', async () => {
    const response = await request(app)
      .get(`/api/v1/favorites/check/${establishment2Id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(response.body.data.isFavorited).toBe(false);
  });
});

describe('Favorites System - Batch Status Check', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id });

    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment3Id });
  });

  test('should check status for multiple establishments', async () => {
    const response = await request(app)
      .post('/api/v1/favorites/check-batch')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentIds: [establishment1Id, establishment2Id, establishment3Id]
      })
      .expect(200);

    expect(response.body.data).toEqual({
      [establishment1Id]: true,
      [establishment2Id]: false,
      [establishment3Id]: true
    });
  });

  test('should handle empty array', async () => {
    const response = await request(app)
      .post('/api/v1/favorites/check-batch')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentIds: [] })
      .expect(200);

    expect(response.body.data).toEqual({});
  });

  test('should handle non-existent establishments', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const response = await request(app)
      .post('/api/v1/favorites/check-batch')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        establishmentIds: [establishment1Id, fakeId]
      })
      .expect(200);

    expect(response.body.data[establishment1Id]).toBe(true);
    expect(response.body.data[fakeId]).toBe(false);
  });
});

describe('Favorites System - CASCADE Deletion', () => {
  test('should delete favorite when establishment is deleted', async () => {
    // Add favorite
    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id });

    // Delete establishment
    await query('DELETE FROM establishments WHERE id = $1', [establishment1Id]);

    // Verify favorite is also deleted (CASCADE)
    const result = await query(
      'SELECT * FROM favorites WHERE establishment_id = $1',
      [establishment1Id]
    );
    expect(result.rows).toHaveLength(0);
  });
});

describe('Favorites System - Statistics', () => {
  test('should return favorites count', async () => {
    // Add 3 favorites
    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment1Id });

    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment2Id });

    await request(app)
      .post('/api/v1/favorites')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ establishmentId: establishment3Id });

    const response = await request(app)
      .get('/api/v1/favorites/stats')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    expect(response.body.data.total).toBe(3);
  });

  test('should return 0 for user with no favorites', async () => {
    const response = await request(app)
      .get('/api/v1/favorites/stats')
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(200);

    expect(response.body.data.total).toBe(0);
  });
});
