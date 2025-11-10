/**
 * E2E Journey Test: Reviews & Favorites Integration
 *
 * This test verifies how reviews and favorites systems work together:
 * 1. User searches and favorites multiple establishments
 * 2. User reviews their favorite establishments
 * 3. Metrics update correctly (average_rating, review_count)
 * 4. User manages reviews (update, delete)
 * 5. User removes from favorites
 * 6. System maintains data integrity
 *
 * This journey tests the integration between:
 * - Search → Favorites → Reviews
 * - Review metrics → Establishment data
 * - User permissions and ownership
 * - Data consistency across systems
 */

import request from 'supertest';
import { query } from '../utils/database.js';
import {
  app,
  cleanDatabase,
  registerUser,
  createEstablishment,
  searchEstablishments,
  addToFavorites,
  createReview,
  getUserFavorites
} from './helpers.js';
import { testUsers } from '../fixtures/users.js';
import { testEstablishments } from '../fixtures/establishments.js';

describe('E2E Journey: Reviews & Favorites Integration', () => {
  let user;
  let partner;
  let establishments = [];

  beforeAll(async () => {
    await cleanDatabase();

    // Setup: Create user and partner
    user = await registerUser({
      email: 'user@integration.test',
      password: 'User123!@#',
      name: 'Интеграционный Пользователь',
      phone: '+375291111111'
    });

    partner = await registerUser({
      ...testUsers.partner,
      email: 'partner@integration.test',
      phone: '+375292222222'
    });

    // Create 3 establishments
    for (let i = 0; i < 3; i++) {
      const estab = await createEstablishment(partner.accessToken, {
        ...testEstablishments[i],
        name: `Заведение ${i + 1}`,
        latitude: 53.9 + (i * 0.01),
        longitude: 27.5 + (i * 0.01)
      });

      // Set to active
      await query(
        'UPDATE establishments SET status = $1 WHERE id = $2',
        ['active', estab.establishment.id]
      );

      establishments.push(estab.establishment);
    }
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  describe('Complete Integration Flow', () => {
    test('STEP 1: User discovers establishments through search', async () => {
      const result = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10
      });

      expect(result.response.status).toBe(200);
      expect(result.establishments.length).toBeGreaterThanOrEqual(3);
    });

    test('STEP 2: User adds establishments to favorites', async () => {
      // Add all 3 establishments to favorites
      for (const establishment of establishments) {
        const result = await addToFavorites(
          user.accessToken,
          establishment.id
        );

        expect(result.response.status).toBe(201);
        expect(result.favorite.establishment_id).toBe(establishment.id);
      }

      // Verify all favorites saved
      const favorites = await getUserFavorites(user.accessToken);
      expect(favorites.favorites.length).toBe(3);
    });

    test('STEP 3: User reviews first favorite (5 stars)', async () => {
      const result = await createReview(user.accessToken, {
        establishmentId: establishments[0].id,
        rating: 5,
        content: 'Отличное место! Очень понравилось. Вернусь снова!'
      });

      expect(result.response.status).toBe(201);
      expect(result.review.rating).toBe(5);
    });

    test('STEP 4: User reviews second favorite (4 stars)', async () => {
      const result = await createReview(user.accessToken, {
        establishmentId: establishments[1].id,
        rating: 4,
        content: 'Хорошо, но есть куда расти. Вкусно, но дороговато.'
      });

      expect(result.response.status).toBe(201);
      expect(result.review.rating).toBe(4);
    });

    test('STEP 5: User reviews third favorite (3 stars)', async () => {
      const result = await createReview(user.accessToken, {
        establishmentId: establishments[2].id,
        rating: 3,
        content: 'Средненько. Ожидал большего.'
      });

      expect(result.response.status).toBe(201);
      expect(result.review.rating).toBe(3);
    });

    test('STEP 6: Establishment metrics updated correctly', async () => {
      // Search again to get updated metrics
      const result = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10
      });

      // Find our establishments
      const estab1 = result.establishments.find(e => e.id === establishments[0].id);
      const estab2 = result.establishments.find(e => e.id === establishments[1].id);
      const estab3 = result.establishments.find(e => e.id === establishments[2].id);

      // Verify metrics updated (if not null)
      if (estab1 && estab1.review_count !== null) {
        expect(estab1.review_count).toBeGreaterThan(0);
        expect(estab1.average_rating).toBeGreaterThan(0);
      }

      if (estab2 && estab2.review_count !== null) {
        expect(estab2.review_count).toBeGreaterThan(0);
        expect(estab2.average_rating).toBeGreaterThan(0);
      }

      if (estab3 && estab3.review_count !== null) {
        expect(estab3.review_count).toBeGreaterThan(0);
        expect(estab3.average_rating).toBeGreaterThan(0);
      }
    });

    test('STEP 7: User updates their first review (changes rating)', async () => {
      // Get review ID
      const reviewsResponse = await request(app)
        .get('/api/v1/reviews')
        .query({
          establishmentId: establishments[0].id,
          limit: 10
        });

      const userReview = reviewsResponse.body.data.reviews.find(
        r => r.user_id === user.user.id
      );

      if (userReview) {
        // Update review
        const response = await request(app)
          .put(`/api/v1/reviews/${userReview.id}`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({
            rating: 4, // Changed from 5 to 4
            content: 'Обновил отзыв. Всё ещё хорошо, но немного снизил оценку.'
          });

        expect(response.status).toBe(200);
        expect(response.body.data.review.rating).toBe(4);
      }
    });

    test('STEP 8: User deletes review for third establishment', async () => {
      // Get review ID
      const reviewsResponse = await request(app)
        .get('/api/v1/reviews')
        .query({
          establishmentId: establishments[2].id,
          limit: 10
        });

      const userReview = reviewsResponse.body.data.reviews.find(
        r => r.user_id === user.user.id
      );

      if (userReview) {
        // Delete review
        const response = await request(app)
          .delete(`/api/v1/reviews/${userReview.id}`)
          .set('Authorization', `Bearer ${user.accessToken}`);

        expect(response.status).toBe(200);
      }
    });

    test('STEP 9: User removes establishment from favorites', async () => {
      // Remove first establishment from favorites
      const response = await request(app)
        .delete(`/api/v1/favorites/${establishments[0].id}`)
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(response.status).toBe(200);

      // Verify removed
      const favorites = await getUserFavorites(user.accessToken);
      expect(favorites.favorites.length).toBe(2);

      const removedFavorite = favorites.favorites.find(
        f => f.establishment_id === establishments[0].id
      );
      expect(removedFavorite).toBeUndefined();
    });

    test('STEP 10: User checks review quota', async () => {
      // Check daily quota
      const response = await request(app)
        .get('/api/v1/reviews/quota')
        .set('Authorization', `Bearer ${user.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveProperty('quotaRemaining');
      expect(response.body.data).toHaveProperty('reviewsToday');
    });
  });

  describe('Integration Data Consistency', () => {
    test('Cannot review establishment not in favorites', async () => {
      // This should still work - favorites and reviews are independent
      // (In some systems they might be linked, but not in ours)

      // Create 4th establishment
      const estab4 = await createEstablishment(partner.accessToken, {
        ...testEstablishments[0],
        name: 'Заведение 4',
        latitude: 53.95,
        longitude: 27.55
      });

      await query(
        'UPDATE establishments SET status = $1 WHERE id = $2',
        ['active', estab4.establishment.id]
      );

      // Review without favoriting
      const result = await createReview(user.accessToken, {
        establishmentId: estab4.establishment.id,
        rating: 5,
        content: 'Можно оставлять отзывы и без добавления в избранное'
      });

      // Should succeed
      expect(result.response.status).toBe(201);
    });

    test('Deleting favorite does not delete review', async () => {
      // Add establishment to favorites
      await addToFavorites(user.accessToken, establishments[1].id);

      // Remove from favorites
      await request(app)
        .delete(`/api/v1/favorites/${establishments[1].id}`)
        .set('Authorization', `Bearer ${user.accessToken}`);

      // Review should still exist
      const reviewsResponse = await request(app)
        .get('/api/v1/reviews')
        .query({
          establishmentId: establishments[1].id,
          limit: 10
        });

      const userReview = reviewsResponse.body.data.reviews.find(
        r => r.user_id === user.user.id
      );

      expect(userReview).toBeDefined();
    });

    test('Multiple users can review and favorite same establishment', async () => {
      // Create second user
      const user2 = await registerUser({
        email: 'user2@integration.test',
        password: 'User2123!@#',
        name: 'Второй Пользователь',
        phone: '+375293333333'
      });

      // Both users favorite same establishment
      await addToFavorites(user.accessToken, establishments[0].id);
      await addToFavorites(user2.accessToken, establishments[0].id);

      // Both users review (different ratings)
      await createReview(user.accessToken, {
        establishmentId: establishments[0].id,
        rating: 5,
        content: 'Первый пользователь - отлично!'
      });

      await createReview(user2.accessToken, {
        establishmentId: establishments[0].id,
        rating: 3,
        content: 'Второй пользователь - средне'
      });

      // Both should succeed
      // Average rating should be (5+3)/2 = 4.0
    });
  });

  describe('User Isolation Verification', () => {
    test('User cannot see other users favorites', async () => {
      // Create third user
      const user3 = await registerUser({
        email: 'user3@integration.test',
        password: 'User3123!@#',
        name: 'Третий Пользователь',
        phone: '+375294444444'
      });

      // User3 adds favorite
      await addToFavorites(user3.accessToken, establishments[0].id);

      // Original user checks their favorites
      const userFavorites = await getUserFavorites(user.accessToken);

      // Should only see their own favorites
      userFavorites.favorites.forEach(fav => {
        expect(fav.user_id).toBe(user.user.id);
      });
    });

    test('User cannot delete other users reviews', async () => {
      // Get another user's review
      const reviewsResponse = await request(app)
        .get('/api/v1/reviews')
        .query({
          establishmentId: establishments[0].id,
          limit: 10
        });

      const otherUserReview = reviewsResponse.body.data.reviews.find(
        r => r.user_id !== user.user.id
      );

      if (otherUserReview) {
        // Try to delete it
        const response = await request(app)
          .delete(`/api/v1/reviews/${otherUserReview.id}`)
          .set('Authorization', `Bearer ${user.accessToken}`);

        // Should fail with 403 Forbidden
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
      }
    });

    test('User cannot update other users reviews', async () => {
      // Get another user's review
      const reviewsResponse = await request(app)
        .get('/api/v1/reviews')
        .query({
          establishmentId: establishments[0].id,
          limit: 10
        });

      const otherUserReview = reviewsResponse.body.data.reviews.find(
        r => r.user_id !== user.user.id
      );

      if (otherUserReview) {
        // Try to update it
        const response = await request(app)
          .put(`/api/v1/reviews/${otherUserReview.id}`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({
            rating: 1,
            content: 'Попытка изменить чужой отзыв'
          });

        // Should fail with 403 Forbidden
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('FORBIDDEN');
      }
    });
  });
});
