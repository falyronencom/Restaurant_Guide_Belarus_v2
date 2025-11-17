/**
 * Establishment Service
 * 
 * This service implements all business logic for the establishments management system.
 * It orchestrates database operations through the model layer, enforces business rules,
 * validates ownership, and manages status transitions.
 * 
 * Architecture note: Services contain the "what" and "why" of application behavior.
 * They understand domain concepts and business rules but are independent of HTTP concerns.
 * Controllers call services, services call models.
 */

import * as EstablishmentModel from '../models/establishmentModel.js';
import { AppError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

/**
 * Valid city values for Belarus
 */
const VALID_CITIES = ['Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Бобруйск'];

/**
 * Valid category values
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
 * Valid cuisine types
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
 * Geographic bounds for Belarus
 */
const BELARUS_BOUNDS = {
  LAT_MIN: 51.0,
  LAT_MAX: 56.0,
  LON_MIN: 23.0,
  LON_MAX: 33.0,
};

/**
 * Create a new establishment
 * 
 * This is the core business operation that implements the complete establishment
 * creation workflow with all necessary validations.
 * 
 * Business rules enforced:
 * - Partner must have 'partner' role (verified by middleware before this)
 * - All required fields must be present and valid
 * - Categories array must have 1-2 items, all valid
 * - Cuisines array must have 1-3 items, all valid
 * - Coordinates must be within Belarus geographic bounds
 * - Establishment name must be unique for this partner
 * - Initial status is 'draft' to allow incremental building
 * 
 * @param {string} partnerId - UUID of the authenticated partner
 * @param {Object} establishmentData - Establishment data from request
 * @returns {Promise<Object>} Created establishment object
 * @throws {AppError} If validation fails or business rules violated
 */
export const createEstablishment = async (partnerId, establishmentData) => {
  const {
    name,
    description,
    city,
    address,
    latitude,
    longitude,
    phone,
    email,
    website,
    categories,
    cuisines,
    price_range,
    working_hours,
    special_hours,
    attributes,
  } = establishmentData;

  try {
    // Validate city
    if (!VALID_CITIES.includes(city)) {
      throw new AppError(
        `Invalid city. Must be one of: ${VALID_CITIES.join(', ')}`,
        422,
        'INVALID_CITY'
      );
    }

    // Validate categories array
    if (!Array.isArray(categories) || categories.length < 1 || categories.length > 2) {
      throw new AppError(
        'Categories must be an array with 1-2 items',
        422,
        'INVALID_CATEGORIES_LENGTH'
      );
    }

    const invalidCategories = categories.filter(cat => !VALID_CATEGORIES.includes(cat));
    if (invalidCategories.length > 0) {
      throw new AppError(
        `Invalid categories: ${invalidCategories.join(', ')}. Valid categories: ${VALID_CATEGORIES.join(', ')}`,
        422,
        'INVALID_CATEGORY_VALUE'
      );
    }

    // Validate cuisines array
    if (!Array.isArray(cuisines) || cuisines.length < 1 || cuisines.length > 3) {
      throw new AppError(
        'Cuisines must be an array with 1-3 items',
        422,
        'INVALID_CUISINES_LENGTH'
      );
    }

    const invalidCuisines = cuisines.filter(cuisine => !VALID_CUISINES.includes(cuisine));
    if (invalidCuisines.length > 0) {
      throw new AppError(
        `Invalid cuisines: ${invalidCuisines.join(', ')}. Valid cuisines: ${VALID_CUISINES.join(', ')}`,
        422,
        'INVALID_CUISINE_VALUE'
      );
    }

    // Validate geographic coordinates are within Belarus bounds
    if (latitude < BELARUS_BOUNDS.LAT_MIN || latitude > BELARUS_BOUNDS.LAT_MAX) {
      throw new AppError(
        `Latitude must be between ${BELARUS_BOUNDS.LAT_MIN} and ${BELARUS_BOUNDS.LAT_MAX} (Belarus bounds)`,
        422,
        'INVALID_LATITUDE'
      );
    }

    if (longitude < BELARUS_BOUNDS.LON_MIN || longitude > BELARUS_BOUNDS.LON_MAX) {
      throw new AppError(
        `Longitude must be between ${BELARUS_BOUNDS.LON_MIN} and ${BELARUS_BOUNDS.LON_MAX} (Belarus bounds)`,
        422,
        'INVALID_LONGITUDE'
      );
    }

    // Check for duplicate name
    const isDuplicate = await EstablishmentModel.checkDuplicateName(partnerId, name);
    if (isDuplicate) {
      throw new AppError(
        'You already have an establishment with this name',
        409,
        'DUPLICATE_ESTABLISHMENT'
      );
    }

    // Create establishment in database
    const establishment = await EstablishmentModel.createEstablishment({
      partner_id: partnerId,
      name,
      description,
      city,
      address,
      latitude,
      longitude,
      phone,
      email,
      website,
      categories,
      cuisines,
      price_range,
      working_hours,
      special_hours,
      attributes,
    });

    logger.info('Establishment created successfully', {
      establishmentId: establishment.id,
      partnerId,
      name,
      city,
    });

    return establishment;
  } catch (error) {
    // Re-throw if it's already an AppError
    if (error instanceof AppError) {
      throw error;
    }

    // Handle database-specific errors
    if (error.code === '23505') {
      // Unique constraint violation
      throw new AppError(
        'An establishment with this information already exists',
        409,
        'DUPLICATE_ESTABLISHMENT'
      );
    }

    if (error.code === '23514') {
      // Check constraint violation (enum values, etc.)
      throw new AppError(
        'Establishment data violates database constraints',
        422,
        'CONSTRAINT_VIOLATION'
      );
    }

    // Log unexpected errors
    logger.error('Unexpected error creating establishment', {
      error: error.message,
      stack: error.stack,
      partnerId,
    });

    throw new AppError(
      'Failed to create establishment',
      500,
      'ESTABLISHMENT_CREATE_FAILED'
    );
  }
};

/**
 * Get all establishments for a partner
 * 
 * Supports pagination and filtering by status for the partner dashboard.
 * 
 * @param {string} partnerId - UUID of the authenticated partner
 * @param {Object} filters - Filter options
 * @param {string} filters.status - Optional status filter
 * @param {number} filters.page - Page number (default: 1)
 * @param {number} filters.limit - Items per page (default: 20, max: 50)
 * @returns {Promise<Object>} Object with establishments array and pagination metadata
 */
export const getPartnerEstablishments = async (partnerId, filters = {}) => {
  try {
    const {
      status,
      page = 1,
      limit = 20,
    } = filters;

    // Enforce maximum limit
    const effectiveLimit = Math.min(limit, 50);

    // Calculate offset for pagination
    const offset = (page - 1) * effectiveLimit;

    // Fetch establishments
    const establishments = await EstablishmentModel.getEstablishmentsByPartner(
      partnerId,
      {
        status,
        limit: effectiveLimit,
        offset,
      }
    );

    // Get total count for pagination metadata
    const total = await EstablishmentModel.countPartnerEstablishments(partnerId, status);

    // Calculate total pages
    const totalPages = Math.ceil(total / effectiveLimit);

    logger.debug('Fetched partner establishments', {
      partnerId,
      count: establishments.length,
      total,
      page,
      totalPages,
    });

    return {
      establishments,
      meta: {
        total,
        page,
        limit: effectiveLimit,
        pages: totalPages,
      },
    };
  } catch (error) {
    logger.error('Error fetching partner establishments', {
      error: error.message,
      partnerId,
    });

    throw new AppError(
      'Failed to fetch establishments',
      500,
      'ESTABLISHMENTS_FETCH_FAILED'
    );
  }
};

/**
 * Get a single establishment by ID
 * 
 * Verifies ownership before returning data. This ensures partners can only
 * view detailed information about their own establishments.
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @param {string} partnerId - UUID of the authenticated partner
 * @returns {Promise<Object>} Complete establishment object
 * @throws {AppError} If establishment not found or doesn't belong to partner
 */
export const getEstablishmentById = async (establishmentId, partnerId) => {
  try {
    // Check ownership first
    const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
    if (!isOwner) {
      throw new AppError(
        'Establishment not found or access denied',
        404,
        'ESTABLISHMENT_NOT_FOUND'
      );
    }

    // Fetch establishment
    const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);

    if (!establishment) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND'
      );
    }

    // Convert numeric types from PostgreSQL strings to numbers
    return {
      ...establishment,
      latitude: establishment.latitude ? parseFloat(establishment.latitude) : establishment.latitude,
      longitude: establishment.longitude ? parseFloat(establishment.longitude) : establishment.longitude,
      average_rating: establishment.average_rating ? parseFloat(establishment.average_rating) : establishment.average_rating
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error('Error fetching establishment by ID', {
      error: error.message,
      establishmentId,
      partnerId,
    });

    throw new AppError(
      'Failed to fetch establishment',
      500,
      'ESTABLISHMENT_FETCH_FAILED'
    );
  }
};

/**
 * Update an establishment
 * 
 * Business rules for updates:
 * - Partner must own the establishment
 * - Cannot update if status is 'suspended' (admin-only change)
 * - Major changes (name, categories, cuisines) require status reset to 'pending' if currently 'active'
 * - Minor changes (hours, description, contact) don't require re-moderation
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @param {string} partnerId - UUID of the authenticated partner
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated establishment object
 * @throws {AppError} If validation fails or unauthorized
 */
export const updateEstablishment = async (establishmentId, partnerId, updates) => {
  try {
    // Check ownership
    const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
    if (!isOwner) {
      throw new AppError(
        'Access denied. You can only update your own establishments.',
        403,
        'FORBIDDEN'
      );
    }

    // Fetch current establishment to check status and for comparison
    const currentEstablishment = await EstablishmentModel.findEstablishmentById(
      establishmentId,
      true
    );

    if (!currentEstablishment) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND'
      );
    }

    // Cannot update suspended establishments (admin-only)
    if (currentEstablishment.status === 'suspended') {
      throw new AppError(
        'Cannot update suspended establishment. Contact support.',
        403,
        'ESTABLISHMENT_SUSPENDED'
      );
    }

    // Validate updates if provided
    if (updates.categories !== undefined) {
      if (!Array.isArray(updates.categories) || updates.categories.length < 1 || updates.categories.length > 2) {
        throw new AppError(
          'Categories must be an array with 1-2 items',
          422,
          'INVALID_CATEGORIES_LENGTH'
        );
      }

      const invalidCategories = updates.categories.filter(cat => !VALID_CATEGORIES.includes(cat));
      if (invalidCategories.length > 0) {
        throw new AppError(
          `Invalid categories: ${invalidCategories.join(', ')}`,
          422,
          'INVALID_CATEGORY_VALUE'
        );
      }
    }

    if (updates.cuisines !== undefined) {
      if (!Array.isArray(updates.cuisines) || updates.cuisines.length < 1 || updates.cuisines.length > 3) {
        throw new AppError(
          'Cuisines must be an array with 1-3 items',
          422,
          'INVALID_CUISINES_LENGTH'
        );
      }

      const invalidCuisines = updates.cuisines.filter(cuisine => !VALID_CUISINES.includes(cuisine));
      if (invalidCuisines.length > 0) {
        throw new AppError(
          `Invalid cuisines: ${invalidCuisines.join(', ')}`,
          422,
          'INVALID_CUISINE_VALUE'
        );
      }
    }

    // Check if name is being changed and if it's a duplicate
    if (updates.name !== undefined && updates.name !== currentEstablishment.name) {
      const isDuplicate = await EstablishmentModel.checkDuplicateName(
        partnerId,
        updates.name,
        establishmentId
      );
      if (isDuplicate) {
        throw new AppError(
          'You already have an establishment with this name',
          409,
          'DUPLICATE_ESTABLISHMENT'
        );
      }
    }

    // Determine if major fields are being changed
    const majorFieldsChanged =
      (updates.name !== undefined && updates.name !== currentEstablishment.name) ||
      (updates.categories !== undefined) ||
      (updates.cuisines !== undefined);

    // If currently 'active' and major fields changed, reset to 'pending'
    if (currentEstablishment.status === 'active' && majorFieldsChanged) {
      updates.status = 'pending';
      
      logger.info('Major fields updated, status reset to pending', {
        establishmentId,
        partnerId,
        changedFields: Object.keys(updates),
      });
    }

    // Prevent partners from changing status directly (except through major field changes above)
    // Status changes should only come from admin moderation or submission workflow
    if (updates.status !== undefined && updates.status !== 'pending' && !majorFieldsChanged) {
      delete updates.status;
      
      logger.warn('Partner attempted to change status directly', {
        establishmentId,
        partnerId,
        attemptedStatus: updates.status,
      });
    }

    // Update establishment
    const updatedEstablishment = await EstablishmentModel.updateEstablishment(
      establishmentId,
      updates
    );

    logger.info('Establishment updated successfully', {
      establishmentId,
      partnerId,
      updatedFields: Object.keys(updates),
      newStatus: updatedEstablishment.status,
    });

    return updatedEstablishment;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    // Handle database-specific errors
    if (error.code === '23514') {
      throw new AppError(
        'Establishment data violates database constraints',
        422,
        'CONSTRAINT_VIOLATION'
      );
    }

    logger.error('Unexpected error updating establishment', {
      error: error.message,
      stack: error.stack,
      establishmentId,
      partnerId,
    });

    throw new AppError(
      'Failed to update establishment',
      500,
      'ESTABLISHMENT_UPDATE_FAILED'
    );
  }
};

/**
 * Submit establishment for moderation
 * 
 * Pre-submission validation ensures establishment is ready for review:
 * - Must be in 'draft' status
 * - All required fields complete
 * - At least 1 interior photo uploaded (checked by service)
 * - At least 1 menu photo uploaded (checked by service)
 * - Primary photo is set (checked by service)
 * 
 * Note: Media validation will be implemented in Phase Two when media service exists
 * 
 * @param {string} establishmentId - UUID of the establishment
 * @param {string} partnerId - UUID of the authenticated partner
 * @returns {Promise<Object>} Updated establishment with 'pending' status
 * @throws {AppError} If validation fails or unauthorized
 */
export const submitEstablishmentForModeration = async (establishmentId, partnerId) => {
  try {
    // Check ownership
    const isOwner = await EstablishmentModel.checkOwnership(establishmentId, partnerId);
    if (!isOwner) {
      throw new AppError(
        'Access denied. You can only update your own establishments.',
        403,
        'FORBIDDEN'
      );
    }

    // Fetch establishment to validate status
    const establishment = await EstablishmentModel.findEstablishmentById(establishmentId, true);

    if (!establishment) {
      throw new AppError(
        'Establishment not found',
        404,
        'ESTABLISHMENT_NOT_FOUND'
      );
    }

    // Must be in 'draft' status to submit
    if (establishment.status !== 'draft') {
      throw new AppError(
        `Cannot submit establishment with status '${establishment.status}'. Only draft establishments can be submitted.`,
        400,
        'INVALID_STATUS_FOR_SUBMISSION'
      );
    }

    // Validate all required fields are complete
    const missingFields = [];

    if (!establishment.name) missingFields.push('name');
    if (!establishment.city) missingFields.push('city');
    if (!establishment.address) missingFields.push('address');
    if (!establishment.latitude || !establishment.longitude) missingFields.push('coordinates');
    if (!establishment.categories || establishment.categories.length === 0) missingFields.push('categories');
    if (!establishment.cuisines || establishment.cuisines.length === 0) missingFields.push('cuisines');
    if (!establishment.working_hours) missingFields.push('working_hours');

    if (missingFields.length > 0) {
      throw new AppError(
        `Missing required fields: ${missingFields.join(', ')}`,
        400,
        'INCOMPLETE_ESTABLISHMENT'
      );
    }

    // TODO: Validate media requirements (Phase Two)
    // - At least 1 interior photo
    // - At least 1 menu photo
    // - Primary photo is set
    // This will be added when media service is implemented

    // Submit for moderation (change status to 'pending')
    const submittedEstablishment = await EstablishmentModel.submitForModeration(establishmentId);

    logger.info('Establishment submitted for moderation', {
      establishmentId,
      partnerId,
      name: establishment.name,
    });

    return submittedEstablishment;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    logger.error('Unexpected error submitting establishment for moderation', {
      error: error.message,
      stack: error.stack,
      establishmentId,
      partnerId,
    });

    throw new AppError(
      'Failed to submit establishment for moderation',
      500,
      'ESTABLISHMENT_SUBMIT_FAILED'
    );
  }
};

