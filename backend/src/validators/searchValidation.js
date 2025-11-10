/**
 * Search Validation - Input Validation Middleware
 * 
 * This module provides validation middleware for search endpoints using
 * express-validator. It ensures all incoming parameters are properly typed,
 * within valid ranges, and meet business logic constraints before processing.
 * 
 * Validation chains are applied as middleware in route definitions, providing
 * early rejection of invalid requests with helpful error messages.
 */

import { query, validationResult } from 'express-validator';

/**
 * Validation chain for list view search endpoint
 * 
 * Validates coordinates, radius, filters, and pagination parameters.
 * All coordinates must be valid GPS coordinates, radius must be reasonable,
 * and filter values must match predefined allowed values.
 */
const validateListSearch = [
  // Latitude validation
  query('lat')
    .exists().withMessage('Latitude is required')
    .isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90')
    .toFloat(),

  // Longitude validation
  query('lon')
    .exists().withMessage('Longitude is required')
    .isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180')
    .toFloat(),

  // Radius validation (optional, with sensible defaults and limits)
  query('radius')
    .optional()
    .isInt({ min: 100, max: 50000 }).withMessage('Radius must be between 100 meters and 50 kilometers')
    .toInt(),

  // Category filter validation (optional, comma-separated)
  query('category')
    .optional()
    .isString().withMessage('Category must be a string')
    .custom((value) => {
      // Split by comma and check each category
      const categories = value.split(',').map(c => c.trim());
      const validCategories = [
        'Ресторан', 'Кофейня', 'Фаст-фуд', 'Бар', 'Кондитерская',
        'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальянная',
        'Боулинг', 'Караоке', 'Бильярд'
      ];
      
      const invalidCategories = categories.filter(cat => !validCategories.includes(cat));
      if (invalidCategories.length > 0) {
        throw new Error(`Invalid categories: ${invalidCategories.join(', ')}`);
      }
      return true;
    }),

  // Cuisine filter validation (optional, comma-separated)
  query('cuisine')
    .optional()
    .isString().withMessage('Cuisine must be a string')
    .custom((value) => {
      const cuisines = value.split(',').map(c => c.trim());
      const validCuisines = [
        'Народная', 'Авторская', 'Азиатская', 'Американская',
        'Вегетарианская', 'Японская', 'Грузинская', 'Итальянская',
        'Смешанная', 'Континентальная'
      ];
      
      const invalidCuisines = cuisines.filter(cui => !validCuisines.includes(cui));
      if (invalidCuisines.length > 0) {
        throw new Error(`Invalid cuisines: ${invalidCuisines.join(', ')}`);
      }
      return true;
    }),

  // Price range filter validation (optional, comma-separated)
  query('price_range')
    .optional()
    .isString().withMessage('Price range must be a string')
    .custom((value) => {
      const priceRanges = value.split(',').map(p => p.trim());
      const validPriceRanges = ['$', '$$', '$$$'];
      
      const invalidRanges = priceRanges.filter(range => !validPriceRanges.includes(range));
      if (invalidRanges.length > 0) {
        throw new Error(`Invalid price ranges: ${invalidRanges.join(', ')}. Valid options: $, $$, $$$`);
      }
      return true;
    }),

  // Features filter validation (optional, comma-separated)
  query('features')
    .optional()
    .isString().withMessage('Features must be a string')
    .custom((value) => {
      const features = value.split(',').map(f => f.trim());
      const validFeatures = [
        'delivery', 'wifi', 'banquet', 'terrace',
        'smoking_area', 'kids_zone', 'pet_friendly', 'parking'
      ];
      
      const invalidFeatures = features.filter(feat => !validFeatures.includes(feat));
      if (invalidFeatures.length > 0) {
        throw new Error(`Invalid features: ${invalidFeatures.join(', ')}`);
      }
      return true;
    }),

  // Operating hours filter validation (optional, single selection)
  query('hours_filter')
    .optional()
    .isIn(['until_22', 'until_morning', '24_hours'])
    .withMessage('Hours filter must be one of: until_22, until_morning, 24_hours'),

  // Pagination cursor validation (optional, base64 string)
  query('cursor')
    .optional()
    .isString().withMessage('Cursor must be a string')
    .custom((value) => {
      // Verify it's valid base64
      try {
        Buffer.from(value, 'base64');
        return true;
      } catch (error) {
        throw new Error('Cursor must be a valid base64-encoded string');
      }
    }),

  // Page size validation (optional, with reasonable limits)
  query('page_size')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100')
    .toInt()
];

/**
 * Validation chain for map view search endpoint
 * 
 * Validates bounding box coordinates and ensures they form a valid geographic
 * area (north > south, reasonable size). Also validates same filters as list view.
 */
const validateMapSearch = [
  // North boundary validation
  query('north')
    .exists().withMessage('North boundary is required')
    .isFloat({ min: -90, max: 90 }).withMessage('North boundary must be between -90 and 90')
    .toFloat(),

  // South boundary validation
  query('south')
    .exists().withMessage('South boundary is required')
    .isFloat({ min: -90, max: 90 }).withMessage('South boundary must be between -90 and 90')
    .toFloat(),

  // East boundary validation
  query('east')
    .exists().withMessage('East boundary is required')
    .isFloat({ min: -180, max: 180 }).withMessage('East boundary must be between -180 and 180')
    .toFloat(),

  // West boundary validation
  query('west')
    .exists().withMessage('West boundary is required')
    .isFloat({ min: -180, max: 180 }).withMessage('West boundary must be between -180 and 180')
    .toFloat(),

  // Bounding box sanity check (custom validation)
  query('north')
    .custom((north, { req }) => {
      const south = parseFloat(req.query.south);
      if (north <= south) {
        throw new Error('North boundary must be greater than south boundary');
      }
      
      // Check bounding box size (prevent queries covering entire world)
      const latDiff = north - south;
      if (latDiff > 10) {
        throw new Error('Bounding box too large (maximum 10 degrees latitude span)');
      }
      
      return true;
    }),

  query('east')
    .custom((east, { req }) => {
      const west = parseFloat(req.query.west);
      const lonDiff = Math.abs(east - west);
      
      if (lonDiff > 10) {
        throw new Error('Bounding box too large (maximum 10 degrees longitude span)');
      }
      
      return true;
    }),

  // Reuse filter validations from list search
  query('category')
    .optional()
    .isString().withMessage('Category must be a string')
    .custom((value) => {
      const categories = value.split(',').map(c => c.trim());
      const validCategories = [
        'Ресторан', 'Кофейня', 'Фаст-фуд', 'Бар', 'Кондитерская',
        'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальянная',
        'Боулинг', 'Караоке', 'Бильярд'
      ];
      
      const invalidCategories = categories.filter(cat => !validCategories.includes(cat));
      if (invalidCategories.length > 0) {
        throw new Error(`Invalid categories: ${invalidCategories.join(', ')}`);
      }
      return true;
    }),

  query('cuisine')
    .optional()
    .isString().withMessage('Cuisine must be a string')
    .custom((value) => {
      const cuisines = value.split(',').map(c => c.trim());
      const validCuisines = [
        'Народная', 'Авторская', 'Азиатская', 'Американская',
        'Вегетарианская', 'Японская', 'Грузинская', 'Итальянская',
        'Смешанная', 'Континентальная'
      ];
      
      const invalidCuisines = cuisines.filter(cui => !validCuisines.includes(cui));
      if (invalidCuisines.length > 0) {
        throw new Error(`Invalid cuisines: ${invalidCuisines.join(', ')}`);
      }
      return true;
    }),

  query('price_range')
    .optional()
    .isString().withMessage('Price range must be a string')
    .custom((value) => {
      const priceRanges = value.split(',').map(p => p.trim());
      const validPriceRanges = ['$', '$$', '$$$'];
      
      const invalidRanges = priceRanges.filter(range => !validPriceRanges.includes(range));
      if (invalidRanges.length > 0) {
        throw new Error(`Invalid price ranges: ${invalidRanges.join(', ')}. Valid options: $, $$, $$$`);
      }
      return true;
    }),

  query('features')
    .optional()
    .isString().withMessage('Features must be a string')
    .custom((value) => {
      const features = value.split(',').map(f => f.trim());
      const validFeatures = [
        'delivery', 'wifi', 'banquet', 'terrace',
        'smoking_area', 'kids_zone', 'pet_friendly', 'parking'
      ];
      
      const invalidFeatures = features.filter(feat => !validFeatures.includes(feat));
      if (invalidFeatures.length > 0) {
        throw new Error(`Invalid features: ${invalidFeatures.join(', ')}`);
      }
      return true;
    }),

  query('hours_filter')
    .optional()
    .isIn(['until_22', 'until_morning', '24_hours'])
    .withMessage('Hours filter must be one of: until_22, until_morning, 24_hours'),

  // Limit validation (maximum results for map view)
  query('limit')
    .optional()
    .isInt({ min: 1, max: 500 }).withMessage('Limit must be between 1 and 500')
    .toInt()
];

/**
 * Middleware to handle validation errors
 * 
 * This should be used after validation chains to check if any validation
 * failed and return appropriate error response to client.
 * 
 * Returns 422 Unprocessable Entity with detailed field-specific error messages
 * if validation fails. Otherwise, proceeds to next middleware/controller.
 */
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    // Format errors into user-friendly structure
    const formattedErrors = errors.array().map(error => ({
      field: error.param,
      message: error.msg,
      value: error.value
    }));

    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: formattedErrors
      }
    });
  }

  // Validation passed, proceed to controller
  next();
}

/**
 * Helper function to extract validation constants
 * Can be used by other modules that need to know valid values
 */
function getValidationConstants() {
  return {
    categories: [
      'Ресторан', 'Кофейня', 'Фаст-фуд', 'Бар', 'Кондитерская',
      'Пиццерия', 'Пекарня', 'Паб', 'Столовая', 'Кальянная',
      'Боулинг', 'Караоке', 'Бильярд'
    ],
    cuisines: [
      'Народная', 'Авторская', 'Азиатская', 'Американская',
      'Вегетарианская', 'Японская', 'Грузинская', 'Итальянская',
      'Смешанная', 'Континентальная'
    ],
    features: [
      'delivery', 'wifi', 'banquet', 'terrace',
      'smoking_area', 'kids_zone', 'pet_friendly', 'parking'
    ],
    priceRanges: ['$', '$$', '$$$'],
    hoursFilters: ['until_22', 'until_morning', '24_hours'],
    radiusLimits: { min: 100, max: 50000 },
    boundingBoxLimits: { maxSpan: 10 },
    paginationLimits: { minPageSize: 1, maxPageSize: 100 },
    mapLimits: { minLimit: 1, maxLimit: 500 }
  };
}

export {
  validateListSearch,
  validateMapSearch,
  handleValidationErrors,
  getValidationConstants
};

