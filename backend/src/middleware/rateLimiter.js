import { incrementWithExpiry, getTTL } from '../config/redis.js';
import logger from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Rate limiting configuration from environment variables.
 * 
 * Two-tier system based on architectural requirements:
 * 1. Authenticated users: 100 requests per minute (lenient for legitimate users)
 * 2. Unauthenticated requests: 300 requests per hour per IP (strict to prevent abuse)
 * 
 * The asymmetric limits reflect different trust levels. Authenticated users have
 * proven identity and can be individually throttled or banned if abusive.
 * Unauthenticated users are harder to track and block, so get tighter limits.
 */
const RATE_LIMIT_AUTHENTICATED = parseInt(
  process.env.RATE_LIMIT_AUTHENTICATED || '100',
  10,
);
const RATE_LIMIT_WINDOW_AUTHENTICATED = parseInt(
  process.env.RATE_LIMIT_WINDOW_AUTHENTICATED || '60',
  10,
);
const RATE_LIMIT_UNAUTHENTICATED = parseInt(
  process.env.RATE_LIMIT_UNAUTHENTICATED || '300',
  10,
);
const RATE_LIMIT_WINDOW_UNAUTHENTICATED = parseInt(
  process.env.RATE_LIMIT_WINDOW_UNAUTHENTICATED || '3600',
  10,
);

/**
 * Generate Redis key for rate limiting counter.
 * 
 * Key format ensures proper namespacing and prevents collisions:
 * - Authenticated: ratelimit:user:${userId}:${currentMinute}
 * - Unauthenticated: ratelimit:ip:${ipAddress}:${currentHour}
 * 
 * Time-based suffix ensures counters automatically expire when window passes.
 * For example, a user's 10:35 AM counter expires after 1 minute, then a new
 * counter for 10:36 AM starts fresh.
 * 
 * @param {string} identifier - User ID or IP address
 * @param {boolean} isAuthenticated - Whether this is an authenticated request
 * @returns {string} Redis key for the counter
 */
const generateRateLimitKey = (identifier, isAuthenticated) => {
  const now = new Date();
  if (isAuthenticated) {
    // Per-minute buckets for authenticated users
    const minute = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
    return `ratelimit:user:${identifier}:${minute}`;
  } else {
    // Per-hour buckets for unauthenticated users
    const hour = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
    return `ratelimit:ip:${identifier}:${hour}`;
  }
};

/**
 * Rate limiting middleware with two-tier authentication-aware system.
 * 
 * This middleware must be placed AFTER authentication middleware in the chain,
 * so that req.user is populated for authenticated requests. However, it must
 * gracefully handle unauthenticated requests without failing.
 * 
 * Implementation details:
 * - Uses Redis INCR with EXPIRE for atomic counter increment with auto-cleanup
 * - Returns detailed rate limit headers for client transparency
 * - Logs rate limit violations for security monitoring
 * - Fails open (allows request) if Redis is unavailable to prevent DOS of our own API
 * 
 * Response headers (following industry standards):
 * - X-RateLimit-Limit: Maximum requests allowed in window
 * - X-RateLimit-Remaining: Requests remaining in current window
 * - X-RateLimit-Reset: Unix timestamp when window resets
 * - Retry-After: Seconds to wait before retrying (only on 429 responses)
 * 
 * Usage in routes:
 * router.get('/endpoint', authenticate, rateLimiter, async (req, res) => { ... });
 * router.get('/public', rateLimiter, async (req, res) => { ... });
 */
export const rateLimiter = async (req, res, next) => {
  try {
    // Determine if request is authenticated and get identifier
    const isAuthenticated = !!req.user;
    const identifier = isAuthenticated ? req.user.userId : req.ip;

    // Select appropriate rate limit based on authentication status
    const limit = isAuthenticated
      ? RATE_LIMIT_AUTHENTICATED
      : RATE_LIMIT_UNAUTHENTICATED;
    const windowSeconds = isAuthenticated
      ? RATE_LIMIT_WINDOW_AUTHENTICATED
      : RATE_LIMIT_WINDOW_UNAUTHENTICATED;

    // Generate Redis key and increment counter
    const rateLimitKey = generateRateLimitKey(identifier, isAuthenticated);
    const currentCount = await incrementWithExpiry(rateLimitKey, windowSeconds);

    // Calculate remaining requests and reset time
    const remaining = Math.max(0, limit - currentCount);
    const ttl = await getTTL(rateLimitKey);
    const resetTime = Math.floor(Date.now() / 1000) + ttl;

    // Set rate limit headers for client awareness
    res.set({
      'X-RateLimit-Limit': limit.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': resetTime.toString(),
    });

    // Check if limit exceeded
    if (currentCount > limit) {
      logger.warn('Rate limit exceeded', {
        identifier,
        isAuthenticated,
        currentCount,
        limit,
        path: req.path,
        method: req.method,
      });

      return res.status(429).json({
        success: false,
        message: 'Rate limit exceeded. Please try again later.',
        error_code: 'RATE_LIMIT_EXCEEDED',
        timestamp: new Date().toISOString(),
        details: {
          limit,
          window: isAuthenticated ? '1 minute' : '1 hour',
          retry_after: ttl,
          reset_at: new Date(resetTime * 1000).toISOString(),
        },
      });
    }

    // Request is within limits - proceed
    next();
  } catch (error) {
    // CRITICAL: If rate limiting fails (Redis down), we fail open and allow the request.
    // This prevents Redis outages from DOSing our own API. However, we log this as
    // an error because it means we're temporarily vulnerable to abuse.
    logger.error('Rate limiting check failed - allowing request', {
      error: error.message,
      path: req.path,
      identifier: req.user?.userId || req.ip,
    });

    // Allow request to proceed despite rate limiting failure
    next();
  }
};

/**
 * Custom rate limiter factory for specific endpoints that need different limits.
 * 
 * Some endpoints may require tighter or looser limits than the global defaults.
 * For example, authentication endpoints might have stricter limits to prevent
 * brute force attacks.
 * 
 * Example usage:
 * router.post(
 *   '/auth/login',
 *   createRateLimiter({ limit: 5, windowSeconds: 300 }),
 *   loginController
 * );
 * 
 * This would limit login attempts to 5 per 5 minutes per IP, which is much
 * stricter than the global unauthenticated limit of 300 per hour.
 * 
 * @param {Object} options - Rate limit configuration
 * @param {number} options.limit - Maximum requests in window
 * @param {number} options.windowSeconds - Time window in seconds
 * @param {string} options.keyPrefix - Redis key prefix for this limiter
 * @returns {Function} Express middleware function
 */
export const createRateLimiter = ({ limit, windowSeconds, keyPrefix = 'custom' }) => {
  return async (req, res, next) => {
    try {
      const identifier = req.user?.userId || req.ip;
      const now = new Date();
      const timeUnit = Math.floor(now.getTime() / (windowSeconds * 1000));
      const rateLimitKey = `ratelimit:${keyPrefix}:${identifier}:${timeUnit}`;

      const currentCount = await incrementWithExpiry(rateLimitKey, windowSeconds);
      const remaining = Math.max(0, limit - currentCount);
      const ttl = await getTTL(rateLimitKey);
      const resetTime = Math.floor(Date.now() / 1000) + ttl;

      res.set({
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': resetTime.toString(),
      });

      if (currentCount > limit) {
        logger.warn(`Custom rate limit exceeded (${keyPrefix})`, {
          identifier,
          currentCount,
          limit,
          path: req.path,
        });

        return res.status(429).json({
          success: false,
          message: 'Rate limit exceeded for this endpoint. Please try again later.',
          error_code: 'RATE_LIMIT_EXCEEDED',
          timestamp: new Date().toISOString(),
          details: {
            limit,
            window: `${windowSeconds} seconds`,
            retry_after: ttl,
            reset_at: new Date(resetTime * 1000).toISOString(),
          },
        });
      }

      next();
    } catch (error) {
      logger.error(`Custom rate limiting check failed (${keyPrefix}) - allowing request`, {
        error: error.message,
        path: req.path,
      });
      next();
    }
  };
};
