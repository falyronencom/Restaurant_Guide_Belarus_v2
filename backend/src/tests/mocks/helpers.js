/**
 * Mock Helpers for Unit Tests
 *
 * Utility functions and data generators for unit testing.
 */

import { v4 as uuidv4 } from 'uuid';
import { jest } from '@jest/globals';

/**
 * Generate mock user data
 */
export function createMockUser(overrides = {}) {
  return {
    id: uuidv4(),
    email: 'test@example.com',
    name: 'Test User',
    phone: '+375291234567',
    role: 'user',
    email_verified: false,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
  };
}

/**
 * Generate mock partner user data
 */
export function createMockPartner(overrides = {}) {
  return createMockUser({
    email: 'partner@example.com',
    name: 'Test Partner',
    phone: '+375291234568',
    role: 'partner',
    ...overrides,
  });
}

/**
 * Generate mock establishment data
 */
export function createMockEstablishment(overrides = {}) {
  return {
    id: uuidv4(),
    partner_id: uuidv4(),
    name: 'Test Restaurant',
    description: 'A test restaurant',
    city: 'Минск',
    address: 'Test Address, 1',
    latitude: 53.9,
    longitude: 27.5,
    categories: ['Ресторан'],
    cuisines: ['Европейская'],
    price_range: '$$',
    phone: '+375171234567',
    email: 'restaurant@test.com',
    website: 'https://test.com',
    working_hours: {
      monday: '09:00-22:00',
      tuesday: '09:00-22:00',
      wednesday: '09:00-22:00',
      thursday: '09:00-22:00',
      friday: '09:00-23:00',
      saturday: '10:00-23:00',
      sunday: '10:00-22:00',
    },
    features: ['Wi-Fi', 'Parking'],
    capacity: 50,
    status: 'active',
    average_rating: null,
    review_count: 0,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    submitted_at: null,
    approved_at: null,
    ...overrides,
  };
}

/**
 * Generate mock review data
 */
export function createMockReview(overrides = {}) {
  return {
    id: uuidv4(),
    user_id: uuidv4(),
    establishment_id: uuidv4(),
    rating: 4,
    content: 'Great place!',
    visit_date: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
  };
}

/**
 * Generate mock favorite data
 */
export function createMockFavorite(overrides = {}) {
  return {
    id: uuidv4(),
    user_id: uuidv4(),
    establishment_id: uuidv4(),
    created_at: new Date(),
    ...overrides,
  };
}

/**
 * Generate mock refresh token data
 */
export function createMockRefreshToken(overrides = {}) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  return {
    id: uuidv4(),
    user_id: uuidv4(),
    token: `refresh-token-${uuidv4()}`,
    expires_at: expiresAt,
    created_at: new Date(),
    used_at: null,
    replaced_by: null,
    ...overrides,
  };
}

/**
 * Mock bcrypt for password hashing
 */
export const mockBcrypt = {
  hash: jest.fn(async (password, rounds) => {
    return `hashed_${password}`;
  }),

  compare: jest.fn(async (password, hash) => {
    return hash === `hashed_${password}`;
  }),
};

/**
 * Mock JWT utilities
 */
export const mockJwt = {
  generateAccessToken: jest.fn((userId) => {
    return `access_token_${userId}`;
  }),

  generateRefreshToken: jest.fn((userId) => {
    return `refresh_token_${userId}`;
  }),

  verifyAccessToken: jest.fn((token) => {
    const match = token.match(/access_token_(.+)/);
    if (match) {
      return { userId: match[1], type: 'access' };
    }
    throw new Error('Invalid token');
  }),

  verifyRefreshToken: jest.fn((token) => {
    const match = token.match(/refresh_token_(.+)/);
    if (match) {
      return { userId: match[1], type: 'refresh' };
    }
    throw new Error('Invalid token');
  }),
};

/**
 * Wait for async operations (useful in tests)
 */
export function wait(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create mock request object
 */
export function createMockRequest(overrides = {}) {
  return {
    body: {},
    query: {},
    params: {},
    headers: {},
    user: null,
    ...overrides,
  };
}

/**
 * Create mock response object
 */
export function createMockResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };
  return res;
}

/**
 * Create mock next function for middleware testing
 */
export function createMockNext() {
  return jest.fn();
}

/**
 * Extract mock call arguments helper
 */
export function getLastCallArgs(mockFn) {
  const calls = mockFn.mock.calls;
  return calls[calls.length - 1];
}

/**
 * Check if mock was called with specific arguments
 */
export function wasCalledWith(mockFn, ...expectedArgs) {
  return mockFn.mock.calls.some(call =>
    expectedArgs.every((arg, index) => {
      if (typeof arg === 'object' && arg !== null) {
        return JSON.stringify(call[index]) === JSON.stringify(arg);
      }
      return call[index] === arg;
    })
  );
}
