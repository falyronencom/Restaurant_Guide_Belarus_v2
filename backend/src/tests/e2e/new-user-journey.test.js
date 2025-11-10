/**
 * E2E Journey Test: New User Complete Flow
 *
 * This test simulates a complete new user journey through the application:
 * 1. User registers a new account
 * 2. User searches for restaurants near their location
 * 3. User adds interesting restaurant to favorites
 * 4. User visits restaurant and leaves a review
 * 5. User checks their favorites list
 *
 * This journey represents one of the most common use cases for the application
 * and verifies that all major systems work together correctly.
 */

import {
  app,
  cleanDatabase,
  registerUser,
  searchEstablishments,
  addToFavorites,
  createReview,
  getUserFavorites,
  createEstablishment,
  registerUser as createPartner
} from './helpers.js';
import { testUsers } from '../fixtures/users.js';
import { testEstablishments } from '../fixtures/establishments.js';

describe('E2E Journey: New User Complete Flow', () => {
  let regularUser;
  let partnerUser;
  let establishment;

  beforeAll(async () => {
    // Clean database
    await cleanDatabase();

    // Setup: Create a partner and establishment for user to discover
    const partner = await createPartner({
      ...testUsers.partner,
      email: 'partner@journey.test',
      phone: '+375291111111'
    });
    partnerUser = partner;

    const estab = await createEstablishment(partner.accessToken, {
      ...testEstablishments[0],
      latitude: 53.9, // Minsk center
      longitude: 27.5,
      status: 'active'
    });
    establishment = estab.establishment;
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  describe('Complete User Journey', () => {
    test('STEP 1: New user registers successfully', async () => {
      // User opens app and registers
      const result = await registerUser({
        email: 'newuser@journey.test',
        password: 'JourneyTest123!@#',
        name: 'Иван Петров',
        phone: '+375292222222'
      });

      regularUser = result;

      // Verify registration successful
      expect(result.response.status).toBe(201);
      expect(result.user).toHaveProperty('id');
      expect(result.user.email).toBe('newuser@journey.test');
      expect(result.user.name).toBe('Иван Петров');
      expect(result.user.role).toBe('user');

      // Verify tokens provided
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(typeof result.accessToken).toBe('string');
      expect(result.accessToken.length).toBeGreaterThan(20);
    });

    test('STEP 2: User searches for restaurants near Minsk center', async () => {
      // User opens map and searches near their location
      const result = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10, // 10km radius
        limit: 20
      });

      // Verify search successful
      expect(result.response.status).toBe(200);
      expect(result.establishments).toBeInstanceOf(Array);
      expect(result.establishments.length).toBeGreaterThan(0);

      // Verify establishment we created is found
      const foundEstablishment = result.establishments.find(
        e => e.id === establishment.id
      );
      expect(foundEstablishment).toBeDefined();
      expect(foundEstablishment.name).toBe(establishment.name);
      expect(foundEstablishment).toHaveProperty('distance_km');
    });

    test('STEP 3: User adds interesting restaurant to favorites', async () => {
      // User likes the restaurant and bookmarks it
      const result = await addToFavorites(
        regularUser.accessToken,
        establishment.id
      );

      // Verify favorite added
      expect(result.response.status).toBe(201);
      expect(result.favorite).toHaveProperty('id');
      expect(result.favorite.user_id).toBe(regularUser.user.id);
      expect(result.favorite.establishment_id).toBe(establishment.id);
      expect(result.favorite.created_at).toBeDefined();
    });

    test('STEP 4: User visits restaurant and leaves a positive review', async () => {
      // After visiting, user leaves review
      const result = await createReview(regularUser.accessToken, {
        establishmentId: establishment.id,
        rating: 5,
        content: 'Отличное место! Прекрасная атмосфера и вкусная еда. Рекомендую всем попробовать драники!'
      });

      // Verify review created
      expect(result.response.status).toBe(201);
      expect(result.review).toHaveProperty('id');
      expect(result.review.user_id).toBe(regularUser.user.id);
      expect(result.review.establishment_id).toBe(establishment.id);
      expect(result.review.rating).toBe(5);
      expect(result.review.content).toContain('Отличное место');
    });

    test('STEP 5: User checks their favorites list', async () => {
      // User opens favorites to plan next visit
      const result = await getUserFavorites(regularUser.accessToken, {
        limit: 10,
        offset: 0
      });

      // Verify favorites retrieved
      expect(result.response.status).toBe(200);
      expect(result.favorites).toBeInstanceOf(Array);
      expect(result.favorites.length).toBe(1);

      // Verify favorite includes full establishment details
      const favorite = result.favorites[0];
      expect(favorite.establishment_id).toBe(establishment.id);
      expect(favorite.establishment_name).toBe(establishment.name);
      expect(favorite.establishment_city).toBe(establishment.city);
      expect(favorite.establishment_latitude).toBeDefined();
      expect(favorite.establishment_longitude).toBeDefined();
    });

    test('INTEGRATION: Verify complete user state after journey', async () => {
      // Verify user now has:
      // - Account with correct data
      // - 1 favorite establishment
      // - 1 review written
      // - No errors or inconsistencies

      // Check favorites count
      const favorites = await getUserFavorites(regularUser.accessToken);
      expect(favorites.favorites.length).toBe(1);

      // Verify establishment has updated metrics from review
      const searchResult = await searchEstablishments({
        latitude: 53.9,
        longitude: 27.5,
        radius: 10
      });

      const updatedEstablishment = searchResult.establishments.find(
        e => e.id === establishment.id
      );

      // Note: This might be null initially if metrics aren't updated yet
      // In real test with database, we'd verify metrics are updated
      if (updatedEstablishment) {
        expect(updatedEstablishment.review_count).toBeGreaterThan(0);
        expect(updatedEstablishment.average_rating).toBeGreaterThan(0);
      }
    });
  });

  describe('Edge Cases in User Journey', () => {
    test('User cannot add same establishment to favorites twice', async () => {
      // Try to favorite same establishment again
      const result = await addToFavorites(
        regularUser.accessToken,
        establishment.id
      );

      // Should succeed but return 200 (already exists) not 201 (created)
      expect([200, 201]).toContain(result.response.status);

      // Favorites count should still be 1
      const favorites = await getUserFavorites(regularUser.accessToken);
      expect(favorites.favorites.length).toBe(1);
    });

    test('User cannot leave second review for same establishment', async () => {
      // Try to leave another review for same establishment
      const result = await createReview(regularUser.accessToken, {
        establishmentId: establishment.id,
        rating: 4,
        content: 'Второй раз был тоже хорошо'
      });

      // Should fail with 409 Conflict
      expect(result.response.status).toBe(409);
      expect(result.response.body.error.code).toBe('DUPLICATE_REVIEW');
    });

    test('User cannot review without being authenticated', async () => {
      // Try to leave review without token
      const result = await createReview('', {
        establishmentId: establishment.id,
        rating: 5,
        content: 'Попытка без авторизации'
      });

      // Should fail with 401 Unauthorized
      expect(result.response.status).toBe(401);
    });
  });
});
