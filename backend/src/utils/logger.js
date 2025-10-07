import winston from 'winston';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Custom log format that redacts sensitive information before logging.
 * This prevents accidentally logging passwords, tokens, or other secrets.
 * 
 * Critical security requirement from architectural review: all sensitive data
 * must be logged as [REDACTED] to prevent credential leakage through logs.
 */
const redactSensitiveData = winston.format((info) => {
  const sensitiveFields = ['password', 'token', 'refresh_token', 'access_token', 'authorization'];
  
  if (info.message && typeof info.message === 'object') {
    const redacted = { ...info.message };
    sensitiveFields.forEach(field => {
      if (redacted[field]) {
        redacted[field] = '[REDACTED]';
      }
    });
    info.message = redacted;
  }

  // Redact sensitive fields from metadata
  if (info.meta && typeof info.meta === 'object') {
    const redacted = { ...info.meta };
    sensitiveFields.forEach(field => {
      if (redacted[field]) {
        redacted[field] = '[REDACTED]';
      }
    });
    info.meta = redacted;
  }

  return info;
});

/**
 * Production format: JSON for structured logging in log aggregation systems
 * Development format: Colorized console output for human readability
 */
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  redactSensitiveData(),
  winston.format.json(),
);

const developmentFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  redactSensitiveData(),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaString = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaString}`;
  }),
);

/**
 * Winston logger instance configured for the current environment.
 * 
 * Log levels (in order of severity):
 * - error: Critical errors that need immediate attention
 * - warn: Warning conditions that should be reviewed
 * - info: General informational messages about application flow
 * - debug: Detailed debugging information for development
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
  ],
  // Prevent unhandled exception crashes - log and exit gracefully
  exitOnError: false,
});

/**
 * Add correlation ID to log context for request tracing.
 * This allows tracking a single request through all log entries.
 * 
 * @param {string} correlationId - Unique identifier for the request
 * @returns {winston.Logger} Child logger with correlation context
 */
export const createRequestLogger = (correlationId) => {
  return logger.child({ correlationId });
};

export default logger;
