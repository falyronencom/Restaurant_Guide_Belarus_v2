/**
 * Redis Mock for Unit Tests
 *
 * Provides mocked Redis operations for testing caching and session management.
 */

/**
 * In-memory store to simulate Redis
 */
const store = new Map();

/**
 * Mock Redis client
 */
export const mockRedis = {
  get: jest.fn(async (key) => {
    return store.get(key) || null;
  }),

  set: jest.fn(async (key, value, ...args) => {
    store.set(key, value);
    return 'OK';
  }),

  setex: jest.fn(async (key, seconds, value) => {
    store.set(key, value);
    return 'OK';
  }),

  del: jest.fn(async (...keys) => {
    let deleted = 0;
    keys.forEach(key => {
      if (store.has(key)) {
        store.delete(key);
        deleted++;
      }
    });
    return deleted;
  }),

  exists: jest.fn(async (...keys) => {
    return keys.filter(key => store.has(key)).length;
  }),

  expire: jest.fn(async (key, seconds) => {
    return store.has(key) ? 1 : 0;
  }),

  ttl: jest.fn(async (key) => {
    return store.has(key) ? 3600 : -2;
  }),

  keys: jest.fn(async (pattern) => {
    // Simple pattern matching for tests
    const regex = new RegExp(pattern.replace('*', '.*'));
    return Array.from(store.keys()).filter(key => regex.test(key));
  }),

  flushdb: jest.fn(async () => {
    store.clear();
    return 'OK';
  }),

  quit: jest.fn(async () => {
    return 'OK';
  }),

  ping: jest.fn(async () => {
    return 'PONG';
  }),
};

/**
 * Reset Redis mock state
 */
export function resetRedisMock() {
  store.clear();
  Object.values(mockRedis).forEach(fn => {
    if (fn.mockReset) fn.mockReset();
  });
}

/**
 * Get current store state (for testing)
 */
export function getRedisStore() {
  return new Map(store);
}

/**
 * Set store state (for testing)
 */
export function setRedisStore(data) {
  store.clear();
  Object.entries(data).forEach(([key, value]) => {
    store.set(key, value);
  });
}
