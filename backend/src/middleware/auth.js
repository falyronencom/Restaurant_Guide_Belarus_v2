import { verifyAccessToken, extractTokenFromHeader } from '../utils/jwt.js';
import logger from '../utils/logger.js';

/**
 * Authentication middleware that verifies JWT access tokens.
 * 
 * This middleware protects routes by ensuring that:
 * 1. A valid Authorization header is present in the request
 * 2. The token can be successfully verified and decoded
 * 3. The token hasn't expired
 * 
 * On successful authentication, the decoded user data is attached to req.user
 * for use by route handlers. This includes userId, email, and role.
 * 
 * Usage in routes:
 * router.get('/protected-endpoint', authenticate, async (req, res) => {
 *   // req.user.userId, req.user.email, req.user.role are available here
 * });
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'No authorization token provided',
        error_code: 'MISSING_TOKEN',
        timestamp: new Date().toISOString(),
      });
    }

    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization header format. Expected: Bearer <token>',
        error_code: 'INVALID_TOKEN_FORMAT',
        timestamp: new Date().toISOString(),
      });
    }

    // Verify token signature and expiration
    const decoded = verifyAccessToken(token);

    // Attach user data to request object for downstream handlers
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };

    // Attach correlation ID for request tracing through logs
    req.correlationId = req.headers['x-correlation-id'] || decoded.userId;

    next();
  } catch (error) {
    // JWT verification throws specific errors we can categorize
    let errorCode = 'INVALID_TOKEN';
    let message = 'Invalid or expired access token';

    if (error.name === 'TokenExpiredError') {
      errorCode = 'TOKEN_EXPIRED';
      message = 'Access token has expired. Please refresh your token.';
    } else if (error.name === 'JsonWebTokenError') {
      errorCode = 'MALFORMED_TOKEN';
      message = 'Access token is malformed or invalid';
    }

    logger.warn('Authentication failed', {
      error: error.message,
      errorCode,
      ip: req.ip,
    });

    return res.status(401).json({
      success: false,
      message,
      error_code: errorCode,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Role-based authorization middleware factory.
 * 
 * Creates a middleware that checks if the authenticated user has one of the
 * specified roles. Must be used AFTER the authenticate middleware.
 * 
 * Architecture note: We separate authentication (who are you?) from authorization
 * (what can you do?). This allows flexible composition of security requirements.
 * 
 * Usage in routes:
 * router.post(
 *   '/admin-only-endpoint',
 *   authenticate,
 *   authorize(['admin']),
 *   async (req, res) => { ... }
 * );
 * 
 * router.put(
 *   '/partner-or-admin-endpoint',
 *   authenticate,
 *   authorize(['partner', 'admin']),
 *   async (req, res) => { ... }
 * );
 * 
 * @param {Array<string>} allowedRoles - Array of role strings (e.g., ['admin', 'partner'])
 * @returns {Function} Express middleware function
 */
export const authorize = (allowedRoles) => {
  return (req, res, next) => {
    // Ensure authenticate middleware ran first
    if (!req.user || !req.user.role) {
      logger.error('Authorization called before authentication', {
        path: req.path,
      });
      return res.status(500).json({
        success: false,
        message: 'Internal server error: authorization misconfigured',
        error_code: 'AUTH_MISCONFIGURATION',
        timestamp: new Date().toISOString(),
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn('Authorization denied', {
        userId: req.user.userId,
        userRole: req.user.role,
        requiredRoles: allowedRoles,
        path: req.path,
      });

      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions to access this resource',
        error_code: 'FORBIDDEN',
        timestamp: new Date().toISOString(),
        details: {
          required_roles: allowedRoles,
          your_role: req.user.role,
        },
      });
    }

    next();
  };
};

/**
 * Optional authentication middleware.
 * 
 * Unlike authenticate, this doesn't fail the request if no token is present.
 * If a valid token is provided, req.user is populated. Otherwise, req.user
 * remains undefined and the request continues.
 * 
 * Use case: Endpoints that provide different data for authenticated vs
 * unauthenticated users (e.g., search results that include favorites for
 * logged-in users but work for anonymous users too).
 * 
 * Usage in routes:
 * router.get('/public-with-personalization', optionalAuth, async (req, res) => {
 *   if (req.user) {
 *     // Return personalized results
 *   } else {
 *     // Return generic results
 *   }
 * });
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      // No token provided - continue without authentication
      return next();
    }

    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      // Malformed header - continue without authentication
      return next();
    }

    // Token provided - try to verify it
    const decoded = verifyAccessToken(token);
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    // Token verification failed - continue without authentication
    // Don't log this as a warning because it's expected behavior for optionalAuth
    logger.debug('Optional authentication failed, continuing as unauthenticated', {
      error: error.message,
    });
    next();
  }
};
