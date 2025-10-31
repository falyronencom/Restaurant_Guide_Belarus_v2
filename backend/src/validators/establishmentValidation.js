/**
 * Establishment Validation Rules
 * 
 * This module defines express-validator validation chains for establishment endpoints.
 * Validation middleware executes before controllers, ensuring only valid data
 * reaches business logic. This is the first line of defense against invalid input.
 * 
 * Architecture note: Validation serves multiple purposes:
 * 1. Security - Prevents malformed data from reaching database
 * 2. User experience - Provides clear error messages for invalid input
 * 3. Performance - Rejects bad requests early without wasting resources
 * 4. Data integrity - Ensures consistent data formats across the system
 * 
 * By catching problems early with clear error messages, we prevent wasted
 * processing and provide better user experience than letting database constraint
 * violations bubble up as generic errors.
 */

import { body, param, query } from 'express-validator';

/**
 * Valid city enum values for Belarus
 */
const VALID_CITIES = ['Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Бобруйск'];

/**
 * Valid establishment category values
 */
const VALID_CATEGORIES = [
  'Ресторан',
  'Кофейня',
  'Фаст-фуд',
  'Бар',
  'Кондитерская',
  'Пиццерия',
  'Пекарня',
  'Паб',
  'Столовая',
  'Кальян',
  'Боулинг',
  'Караоке',
  'Бильярд',
];

/**
 * Valid cuisine type values
 */
const VALID_CUISINES = [
  'Народная',
  'Авторская',
  'Азиатская',
  'Американская',
  'Вегетарианская',
  'Японская',
  'Грузинская',
  'Итальянская',
  'Смешанная',
  'Континентальная',
  'Европейская',
];

/**
 * Valid price range values
 */
const VALID_PRICE_RANGES = ['$', '$$', '$$$'];

/**
 * Valid status values
 */
const VALID_STATUSES = ['draft', 'pending', 'active', 'suspended'];

/**
 * Belarus phone number regex
 * Format: +375 (29/33/44/25) XXX-XX-XX
 */
const BELARUS_PHONE_REGEX = /^\+375(29|33|44|25)\d{7}$/;

/**
 * Validation for creating a new establishment
 * 
 * POST /api/v1/partner/establishments
 * 
 * Required fields:
 * - name: 1-255 characters
 * - city: Valid Belarus city
 * - address: 1-500 characters
 * - latitude: Valid decimal between 51.0-56.0
 * - longitude: Valid decimal between 23.0-33.0
 * - categories: Array of 1-2 valid categories
 * - cuisines: Array of 1-3 valid cuisines
 * - working_hours: Valid JSON object
 * 
 * Optional fields:
 * - description: Max 2000 characters
 * - phone: Valid Belarus phone format
 * - email: Valid email format
 * - website: Valid URL format
 * - price_range: '$', '$$', or '$$$'
 * - special_hours: Valid JSON object
 * - attributes: Valid JSON object
 */
export const validateCreate = [
  // Name validation
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Establishment name is required')
    .isLength({ min: 1, max: 255 })
    .withMessage('Establishment name must be between 1 and 255 characters'),

  // Description validation (optional)
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must not exceed 2000 characters'),

  // City validation
  body('city')
    .trim()
    .notEmpty()
    .withMessage('City is required')
    .isIn(VALID_CITIES)
    .withMessage(`City must be one of: ${VALID_CITIES.join(', ')}`),

  // Address validation
  body('address')
    .trim()
    .notEmpty()
    .withMessage('Address is required')
    .isLength({ min: 1, max: 500 })
    .withMessage('Address must be between 1 and 500 characters'),

  // Latitude validation
  body('latitude')
    .notEmpty()
    .withMessage('Latitude is required')
    .isFloat({ min: 51.0, max: 56.0 })
    .withMessage('Latitude must be a valid number between 51.0 and 56.0 (Belarus bounds)'),

  // Longitude validation
  body('longitude')
    .notEmpty()
    .withMessage('Longitude is required')
    .isFloat({ min: 23.0, max: 33.0 })
    .withMessage('Longitude must be a valid number between 23.0 and 33.0 (Belarus bounds)'),

  // Phone validation (optional)
  body('phone')
    .optional()
    .trim()
    .matches(BELARUS_PHONE_REGEX)
    .withMessage('Phone must be in format +375XXXXXXXXX (Belarus number)'),

  // Email validation (optional)
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Email must be a valid email address')
    .normalizeEmail(),

  // Website validation (optional)
  body('website')
    .optional()
    .trim()
    .isURL()
    .withMessage('Website must be a valid URL'),

  // Categories validation
  body('categories')
    .isArray({ min: 1, max: 2 })
    .withMessage('Categories must be an array with 1-2 items')
    .custom((categories) => {
      const invalidCategories = categories.filter(cat => !VALID_CATEGORIES.includes(cat));
      if (invalidCategories.length > 0) {
        throw new Error(`Invalid categories: ${invalidCategories.join(', ')}`);
      }
      return true;
    }),

  // Cuisines validation
  body('cuisines')
    .isArray({ min: 1, max: 3 })
    .withMessage('Cuisines must be an array with 1-3 items')
    .custom((cuisines) => {
      const invalidCuisines = cuisines.filter(cuisine => !VALID_CUISINES.includes(cuisine));
      if (invalidCuisines.length > 0) {
        throw new Error(`Invalid cuisines: ${invalidCuisines.join(', ')}`);
      }
      return true;
    }),

  // Price range validation (optional)
  body('price_range')
    .optional()
    .isIn(VALID_PRICE_RANGES)
    .withMessage('Price range must be one of: $, $$, $$$'),

  // Working hours validation (must be valid JSON object)
  body('working_hours')
    .notEmpty()
    .withMessage('Working hours are required')
    .isObject()
    .withMessage('Working hours must be a valid JSON object'),

  // Special hours validation (optional, must be valid JSON object)
  body('special_hours')
    .optional()
    .isObject()
    .withMessage('Special hours must be a valid JSON object'),

  // Attributes validation (optional, must be valid JSON object)
  body('attributes')
    .optional()
    .isObject()
    .withMessage('Attributes must be a valid JSON object'),
];

/**
 * Validation for updating an establishment
 * 
 * PUT /api/v1/partner/establishments/:id
 * 
 * All fields are optional for updates. Only provided fields are validated.
 * ID parameter must be a valid UUID.
 */
export const validateUpdate = [
  // ID parameter validation
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),

  // Name validation (optional for updates)
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Establishment name cannot be empty')
    .isLength({ min: 1, max: 255 })
    .withMessage('Establishment name must be between 1 and 255 characters'),

  // Description validation (optional)
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must not exceed 2000 characters'),

  // Address validation (optional for updates)
  body('address')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Address cannot be empty')
    .isLength({ min: 1, max: 500 })
    .withMessage('Address must be between 1 and 500 characters'),

  // Phone validation (optional)
  body('phone')
    .optional()
    .trim()
    .matches(BELARUS_PHONE_REGEX)
    .withMessage('Phone must be in format +375XXXXXXXXX (Belarus number)'),

  // Email validation (optional)
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Email must be a valid email address')
    .normalizeEmail(),

  // Website validation (optional)
  body('website')
    .optional()
    .trim()
    .isURL()
    .withMessage('Website must be a valid URL'),

  // Cuisines validation (optional for updates)
  body('cuisines')
    .optional()
    .isArray({ min: 1, max: 3 })
    .withMessage('Cuisines must be an array with 1-3 items')
    .custom((cuisines) => {
      const invalidCuisines = cuisines.filter(cuisine => !VALID_CUISINES.includes(cuisine));
      if (invalidCuisines.length > 0) {
        throw new Error(`Invalid cuisines: ${invalidCuisines.join(', ')}`);
      }
      return true;
    }),

  // Price range validation (optional)
  body('price_range')
    .optional()
    .isIn(VALID_PRICE_RANGES)
    .withMessage('Price range must be one of: $, $$, $$$'),

  // Working hours validation (optional for updates)
  body('working_hours')
    .optional()
    .isObject()
    .withMessage('Working hours must be a valid JSON object'),

  // Special hours validation (optional)
  body('special_hours')
    .optional()
    .isObject()
    .withMessage('Special hours must be a valid JSON object'),

  // Attributes validation (optional)
  body('attributes')
    .optional()
    .isObject()
    .withMessage('Attributes must be a valid JSON object'),
];

/**
 * Validation for getting establishment details
 * 
 * GET /api/v1/partner/establishments/:id
 * 
 * Only validates the UUID format of the establishment ID parameter.
 */
export const validateGetDetails = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),
];

/**
 * Validation for listing partner establishments
 * 
 * GET /api/v1/partner/establishments
 * 
 * Optional query parameters for pagination and filtering:
 * - status: Valid status value
 * - page: Positive integer (default: 1)
 * - limit: Between 1 and 50 (default: 20)
 */
export const validateList = [
  query('status')
    .optional()
    .isIn(VALID_STATUSES)
    .withMessage(`Status must be one of: ${VALID_STATUSES.join(', ')}`),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50')
    .toInt(),
];

/**
 * Validation for submitting establishment for moderation
 * 
 * POST /api/v1/partner/establishments/:id/submit
 * 
 * Only validates the UUID format of the establishment ID parameter.
 * Business logic validation (draft status, required fields, media) happens in service layer.
 */
export const validateSubmit = [
  param('id')
    .trim()
    .notEmpty()
    .withMessage('Establishment ID is required')
    .isUUID()
    .withMessage('Establishment ID must be a valid UUID'),
];

