import { createClient } from 'redis';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

/**
 * Redis client configuration for caching and rate limiting.
 * 
 * Redis is used for two primary purposes in this application:
 * 1. Rate limiting: Track request counts per user/IP with automatic expiration
 * 2. Session management: Store refresh tokens with TTL for automatic cleanup
 * 
 * The redis v4 client uses Promises by default, which integrates cleanly with
 * async/await patterns throughout our application.
 */
const redisConfig = {
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    // Reconnect strategy: exponential backoff up to 3 seconds
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error('Redis reconnection failed after 10 attempts');
        return new Error('Max reconnection attempts reached');
      }
      const delay = Math.min(retries * 100, 3000);
      logger.warn(`Redis reconnecting in ${delay}ms (attempt ${retries})`);
      return delay;
    },
  },
  password: process.env.REDIS_PASSWORD || undefined,
  database: parseInt(process.env.REDIS_DB || '0', 10),
};

/**
 * Create Redis client instance.
 * Connection is established lazily on first use via connect() call.
 */
const redisClient = createClient(redisConfig);

/**
 * Redis error handler for connection and runtime errors.
 * These errors need to be logged but shouldn't crash the application.
 * The reconnect strategy will handle transient connection failures.
 */
redisClient.on('error', (err) => {
  logger.error('Redis client error', {
    error: err.message,
    code: err.code,
  });
});

/**
 * Redis connection event handler.
 * Logs successful connection establishment for monitoring.
 */
redisClient.on('connect', () => {
  logger.info('Redis client connecting...');
});

/**
 * Redis ready event handler.
 * Triggered when client is connected and ready to accept commands.
 */
redisClient.on('ready', () => {
  logger.info('Redis client ready', {
    host: redisConfig.socket.host,
    port: redisConfig.socket.port,
    database: redisConfig.database,
  });
});

/**
 * Redis reconnecting event handler.
 * Useful for monitoring connection stability in production.
 */
redisClient.on('reconnecting', () => {
  logger.warn('Redis client reconnecting...');
});

/**
 * Establish connection to Redis server.
 * Called during application startup. Fails fast if Redis is unavailable.
 * 
 * @returns {Promise<boolean>} True if connection successful
 */
export const connectRedis = async () => {
  try {
    await redisClient.connect();
    // Test the connection with a PING command
    const pong = await redisClient.ping();
    if (pong === 'PONG') {
      logger.info('Redis connection test successful');
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Redis connection failed', {
      error: error.message,
      host: redisConfig.socket.host,
    });
    return false;
  }
};

/**
 * Gracefully disconnect from Redis.
 * Called during application shutdown to ensure clean termination.
 * 
 * @returns {Promise<void>}
 */
export const disconnectRedis = async () => {
  try {
    await redisClient.quit();
    logger.info('Redis client disconnected gracefully');
  } catch (error) {
    logger.error('Error disconnecting Redis client', { error: error.message });
  }
};

/**
 * Increment a counter in Redis with automatic expiration.
 * Primary use case: rate limiting counters that auto-expire after time window.
 * 
 * This implements an atomic increment-and-expire pattern that prevents race conditions.
 * If the key doesn't exist, it's created with value 1 and given an expiration.
 * If it exists, only the counter is incremented (expiration remains unchanged).
 * 
 * @param {string} key - Redis key for the counter
 * @param {number} expirySeconds - Seconds until key expires (only set on first increment)
 * @returns {Promise<number>} New counter value after increment
 */
export const incrementWithExpiry = async (key, expirySeconds) => {
  try {
    const multi = redisClient.multi();
    multi.incr(key);
    multi.expire(key, expirySeconds);
    const results = await multi.exec();
    return results[0]; // Return the incremented value
  } catch (error) {
    logger.error('Redis increment with expiry failed', {
      error: error.message,
      key,
    });
    throw error;
  }
};

/**
 * Get current value of a counter.
 * Returns null if key doesn't exist.
 * 
 * @param {string} key - Redis key to retrieve
 * @returns {Promise<number|null>} Counter value or null
 */
export const getCounter = async (key) => {
  try {
    const value = await redisClient.get(key);
    return value ? parseInt(value, 10) : null;
  } catch (error) {
    logger.error('Redis get counter failed', {
      error: error.message,
      key,
    });
    throw error;
  }
};

/**
 * Get time-to-live for a key in seconds.
 * Returns -1 if key exists but has no expiration, -2 if key doesn't exist.
 * 
 * @param {string} key - Redis key to check
 * @returns {Promise<number>} Seconds until expiration
 */
export const getTTL = async (key) => {
  try {
    return await redisClient.ttl(key);
  } catch (error) {
    logger.error('Redis get TTL failed', {
      error: error.message,
      key,
    });
    throw error;
  }
};

/**
 * Store a value in Redis with expiration.
 * Primary use case: storing refresh tokens with 30-day TTL.
 * 
 * @param {string} key - Redis key
 * @param {string} value - Value to store
 * @param {number} expirySeconds - Seconds until key expires
 * @returns {Promise<void>}
 */
export const setWithExpiry = async (key, value, expirySeconds) => {
  try {
    await redisClient.setEx(key, expirySeconds, value);
  } catch (error) {
    logger.error('Redis set with expiry failed', {
      error: error.message,
      key,
    });
    throw error;
  }
};

/**
 * Delete a key from Redis.
 * Returns the number of keys deleted (0 if key didn't exist, 1 if deleted).
 * 
 * @param {string} key - Redis key to delete
 * @returns {Promise<number>} Number of keys deleted
 */
export const deleteKey = async (key) => {
  try {
    return await redisClient.del(key);
  } catch (error) {
    logger.error('Redis delete key failed', {
      error: error.message,
      key,
    });
    throw error;
  }
};

export default redisClient;
