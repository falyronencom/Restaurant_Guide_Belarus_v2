/**
 * Authentication Validation Middleware
 * 
 * This module defines validation rules for authentication endpoints using
 * express-validator. Comprehensive input validation is critical for security
 * and user experience. We validate not just presence but also format, length,
 * and business rules for all inputs.
 * 
 * Validation strategy:
 * - Check format and structure before business logic
 * - Normalize inputs (lowercase emails, trim whitespace)
 * - Return detailed field-level errors for frontend
 * - Balance security with helpful user feedback
 */

import { body, validationResult } from 'express-validator';
import logger from '../utils/logger.js';

/**
 * Belarus phone number patterns
 * 
 * We support two formats:
 * 1. Belarus domestic: +375 (29/33/44/25) XXX-XX-XX
 * 2. International format with explicit country code
 * 
 * Common Belarus mobile operator codes:
 * - 29: A1 (Velcom)
 * - 33: MTS
 * - 44: life:)
 * - 25: MTS (newer)
 */
const BELARUS_PHONE_REGEX = /^\+375(29|33|44|25)\d{7}$/;

/**
 * Password complexity requirements
 * 
 * Minimum 8 characters with at least:
 * - One uppercase letter
 * - One lowercase letter
 * - One digit
 * 
 * We don't require special characters because research shows overly complex
 * password requirements lead users to predictable patterns or password reuse,
 * which actually decreases security.
 * 
 * We also don't impose maximum length because there's no security benefit to
 * limiting password length, and some users prefer very long passphrases.
 */
const PASSWORD_MIN_LENGTH = 8;

/**
 * Validation middleware to check validation results
 * 
 * This function checks if any validation errors occurred and formats them
 * into a consistent error response. It should be used after validation chains.
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    // Format validation errors into field-specific messages
    const formattedErrors = errors.array().reduce((acc, error) => {
      // Group errors by field for cleaner response
      if (!acc[error.path]) {
        acc[error.path] = [];
      }
      acc[error.path].push(error.msg);
      return acc;
    }, {});
    
    logger.warn('Validation failed', { 
      errors: formattedErrors,
      path: req.path 
    });
    
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input data',
        details: formattedErrors
      }
    });
  }
  
  next();
}

/**
 * Registration validation rules
 * 
 * Validates user registration input ensuring data quality and security.
 * Either email or phone must be provided based on auth_method.
 */
export const validateRegister = [
  // Name validation
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters')
    .matches(/^[a-zA-Zа-яА-ЯёЁ\s'-]+$/)
    .withMessage('Name can only contain letters, spaces, hyphens and apostrophes'),
  
  // Email validation (optional but must be valid if provided)
  body('email')
    .optional()
    .trim()
    .toLowerCase() // Normalize to lowercase for consistency
    .isEmail()
    .withMessage('Invalid email format')
    .isLength({ max: 255 })
    .withMessage('Email is too long')
    .normalizeEmail({ 
      gmail_remove_dots: false, // Don't remove dots from Gmail addresses
      gmail_remove_subaddress: false // Don't remove +tags from Gmail addresses
    }),
  
  // Phone validation (optional but must be valid if provided)
  body('phone')
    .optional()
    .trim()
    .matches(BELARUS_PHONE_REGEX)
    .withMessage('Invalid phone number. Use format: +375XXXXXXXXX'),
  
  // Password validation
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: PASSWORD_MIN_LENGTH })
    .withMessage(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long`)
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one digit'),
  
  // Auth method validation (optional, will be auto-detected if not provided)
  body('authMethod')
    .optional()
    .isIn(['email', 'phone', 'google', 'yandex'])
    .withMessage('Authentication method must be: email, phone, google, or yandex'),
  
  // Custom validation: ensure email provided if authMethod is email
  body('email').custom((value, { req }) => {
    if (req.body.authMethod === 'email' && !value) {
      throw new Error('Email is required when authentication method is email');
    }
    return true;
  }),
  
  // Custom validation: ensure phone provided if authMethod is phone
  body('phone').custom((value, { req }) => {
    if (req.body.authMethod === 'phone' && !value) {
      throw new Error('Phone is required when authentication method is phone');
    }
    return true;
  }),
  
  // Custom validation: ensure at least email or phone provided
  body('email').custom((value, { req }) => {
    if (!value && !req.body.phone) {
      throw new Error('Either email or phone must be provided');
    }
    return true;
  }),
  
  handleValidationErrors
];

/**
 * Login validation rules
 * 
 * Validates login credentials. We check basic format but don't enforce
 * password complexity here because we're validating an existing password,
 * not creating a new one.
 */
export const validateLogin = [
  // Email validation (optional but must be valid if provided)
  body('email')
    .optional()
    .trim()
    .toLowerCase()
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail({ 
      gmail_remove_dots: false,
      gmail_remove_subaddress: false
    }),
  
  // Phone validation (optional but must be valid if provided)
  body('phone')
    .optional()
    .trim()
    .matches(BELARUS_PHONE_REGEX)
    .withMessage('Invalid phone number. Use format: +375XXXXXXXXX'),
  
  // Password validation (just check it's provided, no complexity check)
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isString()
    .withMessage('Password must be a string'),
  
  // Custom validation: ensure at least email or phone provided
  body('email').custom((value, { req }) => {
    if (!value && !req.body.phone) {
      throw new Error('Either email or phone must be provided');
    }
    return true;
  }),
  
  handleValidationErrors
];

/**
 * Refresh token validation rules
 * 
 * Validates refresh token format. We check basic presence and type but don't
 * validate JWT structure here as that's the responsibility of token verification
 * logic in the service layer.
 */
export const validateRefresh = [
  // Refresh token validation
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh token is required')
    .isString()
    .withMessage('Refresh token must be a string')
    .isLength({ min: 32, max: 500 })
    .withMessage('Invalid refresh token format'),
  
  handleValidationErrors
];

/**
 * Logout validation rules
 * 
 * Validates logout request. Similar to refresh, we just check that the token
 * is provided and has reasonable format.
 */
export const validateLogout = [
  // Refresh token validation
  body('refreshToken')
    .notEmpty()
    .withMessage('Refresh token is required')
    .isString()
    .withMessage('Refresh token must be a string')
    .isLength({ min: 32, max: 500 })
    .withMessage('Invalid refresh token format'),
  
  handleValidationErrors
];

/**
 * Email validation helper (for standalone use)
 * 
 * Can be reused in other validation chains that need email validation.
 */
export const validateEmail = body('email')
  .trim()
  .toLowerCase()
  .isEmail()
  .withMessage('Invalid email format')
  .isLength({ max: 255 })
  .withMessage('Email is too long')
  .normalizeEmail({ 
    gmail_remove_dots: false,
    gmail_remove_subaddress: false
  });

/**
 * Phone validation helper (for standalone use)
 * 
 * Can be reused in other validation chains that need phone validation.
 */
export const validatePhone = body('phone')
  .trim()
  .matches(BELARUS_PHONE_REGEX)
  .withMessage('Invalid phone number. Use format: +375XXXXXXXXX');

/**
 * Password validation helper (for standalone use)
 * 
 * Can be reused in other validation chains that need password validation.
 */
export const validatePassword = body('password')
  .isLength({ min: PASSWORD_MIN_LENGTH })
  .withMessage(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long`)
  .matches(/[A-Z]/)
  .withMessage('Password must contain at least one uppercase letter')
  .matches(/[a-z]/)
  .withMessage('Password must contain at least one lowercase letter')
  .matches(/[0-9]/)
  .withMessage('Password must contain at least one digit');

