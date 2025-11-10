import logger from '../utils/logger.js';
import { validationResult } from 'express-validator';

/**
 * Custom error class for application-specific errors.
 * 
 * This allows us to throw errors with HTTP status codes and error codes
 * that get properly handled by the error middleware.
 * 
 * Example usage in controllers:
 * throw new AppError('User not found', 404, 'USER_NOT_FOUND');
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Marks this as an expected error we can safely report to client
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Centralized error handling middleware.
 * 
 * This is the last middleware in the chain and catches all errors that occur
 * during request processing. It provides consistent error responses and proper
 * logging while never exposing internal implementation details to clients.
 * 
 * CRITICAL SECURITY REQUIREMENT: In production, never send stack traces or
 * internal error details to clients. These can leak information about our
 * system architecture that attackers could exploit.
 * 
 * Error handling strategy:
 * 1. Operational errors (AppError): Expected errors with safe error messages
 * 2. Programming errors: Unexpected errors that indicate bugs
 * 3. Third-party errors: Database errors, Redis errors, etc.
 * 
 * All errors are logged server-side with full details for debugging, but
 * clients only receive sanitized error messages.
 * 
 * This middleware must be registered LAST in the Express middleware chain,
 * after all routes and other middleware.
 */
export const errorHandler = (err, req, res, next) => {
  // Default to 500 Internal Server Error if status not specified
  let statusCode = err.statusCode || 500;
  let errorCode = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred';
  let details = err.details || null;

  // Log the error with appropriate severity
  const logContext = {
    errorCode,
    statusCode,
    message,
    path: req.path,
    method: req.method,
    userId: req.user?.userId,
    ip: req.ip,
    correlationId: req.correlationId,
  };

  // Operational errors (4xx) are warnings, programming errors (5xx) are errors
  if (statusCode >= 500) {
    logger.error('Server error occurred', {
      ...logContext,
      stack: err.stack, // Full stack trace in logs only
      details,
    });
  } else {
    logger.warn('Client error occurred', logContext);
  }

  // Handle specific error types with custom logic
  if (err.name === 'ValidationError') {
    // Express-validator validation errors
    statusCode = 422; // 422 Unprocessable Entity is the correct code for validation errors
    errorCode = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.details || err.array?.(); // Include validation failure details
  } else if (err.code === '23505') {
    // PostgreSQL unique constraint violation
    statusCode = 409;
    errorCode = 'DUPLICATE_ENTRY';
    message = 'A record with this information already exists';
    // Don't expose which field caused the conflict - security consideration
  } else if (err.code === '23503') {
    // PostgreSQL foreign key constraint violation
    statusCode = 400;
    errorCode = 'INVALID_REFERENCE';
    message = 'Referenced record does not exist';
  } else if (err.code === '22P02') {
    // PostgreSQL invalid text representation (e.g., invalid UUID format)
    statusCode = 400;
    errorCode = 'INVALID_FORMAT';
    message = 'Invalid data format provided';
  } else if (err.name === 'JsonWebTokenError') {
    // JWT errors should have been caught by auth middleware, but handle just in case
    statusCode = 401;
    errorCode = 'INVALID_TOKEN';
    message = 'Authentication token is invalid';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'TOKEN_EXPIRED';
    message = 'Authentication token has expired';
  } else if (err.type === 'entity.parse.failed') {
    // JSON parsing error from body-parser
    statusCode = 400;
    errorCode = 'INVALID_JSON';
    message = 'Request body contains invalid JSON';
  }

  // In production, never expose internal error details or stack traces
  const isProduction = process.env.NODE_ENV === 'production';
  const sanitizedResponse = {
    success: false,
    message,
    error: {
      code: errorCode
    },
    timestamp: new Date().toISOString(),
  };

  // Include validation details if available and appropriate
  if (details && (statusCode === 400 || statusCode === 422) && err.isOperational) {
    sanitizedResponse.error.details = details;
  }

  // In development, include stack trace for debugging
  if (!isProduction && err.stack) {
    sanitizedResponse.stack = err.stack.split('\n');
  }

  res.status(statusCode).json(sanitizedResponse);
};

/**
 * Async error wrapper for route handlers.
 * 
 * Express doesn't automatically catch errors in async route handlers. Without
 * this wrapper, async errors would crash the server instead of being handled
 * by our error middleware.
 * 
 * Usage:
 * router.get('/endpoint', asyncHandler(async (req, res) => {
 *   const data = await someAsyncOperation();
 *   res.json({ data });
 * }));
 * 
 * Instead of:
 * router.get('/endpoint', async (req, res, next) => {
 *   try {
 *     const data = await someAsyncOperation();
 *     res.json({ data });
 *   } catch (error) {
 *     next(error);
 *   }
 * });
 * 
 * This significantly reduces boilerplate in route handlers.
 * 
 * @param {Function} fn - Async route handler function
 * @returns {Function} Wrapped function that catches async errors
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Validation error handler middleware.
 * 
 * This middleware processes the results of express-validator validation chains.
 * It should be placed after validation middleware and before the controller.
 * 
 * If validation fails, it formats the errors and returns a 400 Bad Request response.
 * If validation passes, it calls next() to proceed to the controller.
 * 
 * Usage:
 * router.post('/endpoint',
 *   validateSomething,  // express-validator validation chain
 *   validate,           // this middleware checks for errors
 *   controller          // only reached if validation passes
 * );
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    // Format validation errors for client response
    const formattedErrors = errors.array().map(err => ({
      field: err.path || err.param,
      message: err.msg,
      value: err.value
    }));

    logger.warn('Request validation failed', {
      path: req.path,
      method: req.method,
      errors: formattedErrors,
      correlationId: req.correlationId,
    });

    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      error: {
        code: 'VALIDATION_ERROR',
        details: formattedErrors
      },
      timestamp: new Date().toISOString(),
    });
  }

  next();
};

/**
 * 404 Not Found handler for undefined routes.
 * 
 * This middleware should be registered AFTER all routes but BEFORE the error
 * handler. It catches requests that don't match any defined routes.
 * 
 * Usage in server.js:
 * app.use('/api/v1', routes);
 * app.use(notFoundHandler);
 * app.use(errorHandler);
 */
export const notFoundHandler = (req, res) => {
  logger.warn('Route not found', {
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
    error: {
      code: 'NOT_FOUND'
    },
    timestamp: new Date().toISOString(),
  });
};
