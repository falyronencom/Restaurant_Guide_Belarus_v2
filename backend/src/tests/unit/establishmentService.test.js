/**
 * Unit Tests: establishmentService.js
 *
 * Tests establishment business logic in isolation using mocked model layer.
 * These tests verify:
 * - Establishment creation with validation
 * - Ownership verification
 * - Pagination and filtering
 * - Business rules enforcement
 * - Geographic bounds validation (Belarus-specific)
 */

import { jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('../../models/establishmentModel.js', () => ({
  createEstablishment: jest.fn(),
  getEstablishmentsByPartner: jest.fn(),
  countPartnerEstablishments: jest.fn(),
  findEstablishmentById: jest.fn(),
  checkOwnership: jest.fn(),
  checkDuplicateName: jest.fn(),
  updateEstablishment: jest.fn(),
  deleteEstablishment: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import after mocking
const EstablishmentModel = await import('../../models/establishmentModel.js');
const logger = (await import('../../utils/logger.js')).default;

const {
  createEstablishment,
  getPartnerEstablishments,
  getEstablishmentById,
  updateEstablishment,
} = await import('../../services/establishmentService.js');

import { createMockEstablishment, createMockPartner } from '../mocks/helpers.js';
import { AppError } from '../../middleware/errorHandler.js';

describe('establishmentService', () => {
  let partnerId;
  let mockEstablishment;

  beforeEach(() => {
    jest.clearAllMocks();
    partnerId = 'partner-123';
    mockEstablishment = createMockEstablishment({ partner_id: partnerId });
  });

  describe('createEstablishment', () => {
    const validEstablishmentData = {
      name: 'Test Restaurant',
      description: 'A test restaurant',
      city: 'Минск',
      address: 'Test Street 1',
      latitude: 53.9,
      longitude: 27.5,
      phone: '+375171234567',
      email: 'test@restaurant.com',
      website: 'https://test.com',
      categories: ['Ресторан'],
      cuisines: ['Европейская'],
      price_range: '$$',
      working_hours: {
        monday: '09:00-22:00',
        tuesday: '09:00-22:00',
        wednesday: '09:00-22:00',
        thursday: '09:00-22:00',
        friday: '09:00-23:00',
        saturday: '10:00-23:00',
        sunday: '10:00-22:00',
      },
    };

    test('should create establishment with valid data', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);
      EstablishmentModel.createEstablishment.mockResolvedValue(mockEstablishment);

      const result = await createEstablishment(partnerId, validEstablishmentData);

      expect(result).toEqual(mockEstablishment);
      expect(EstablishmentModel.checkDuplicateName).toHaveBeenCalledWith(
        partnerId,
        validEstablishmentData.name
      );
      expect(EstablishmentModel.createEstablishment).toHaveBeenCalledWith(
        expect.objectContaining({
          partner_id: partnerId,
          name: validEstablishmentData.name,
          city: validEstablishmentData.city,
        })
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Establishment created successfully',
        expect.objectContaining({ partnerId })
      );
    });

    test('should throw error for invalid city', async () => {
      const invalidData = {
        ...validEstablishmentData,
        city: 'Москва', // Not in Belarus
      };

      await expect(createEstablishment(partnerId, invalidData)).rejects.toThrow(AppError);
      await expect(createEstablishment(partnerId, invalidData)).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CITY',
      });
    });

    test('should accept all valid Belarus cities', async () => {
      const validCities = ['Минск', 'Гродно', 'Брест', 'Гомель', 'Витебск', 'Могилев', 'Бобруйск'];

      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);
      EstablishmentModel.createEstablishment.mockResolvedValue(mockEstablishment);

      for (const city of validCities) {
        await expect(
          createEstablishment(partnerId, { ...validEstablishmentData, city })
        ).resolves.toBeDefined();
      }
    });

    test('should throw error for invalid categories length', async () => {
      // Too few categories
      await expect(
        createEstablishment(partnerId, { ...validEstablishmentData, categories: [] })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CATEGORIES_LENGTH',
      });

      // Too many categories
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          categories: ['Ресторан', 'Кофейня', 'Бар'], // 3 items
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CATEGORIES_LENGTH',
      });
    });

    test('should throw error for invalid category values', async () => {
      const invalidData = {
        ...validEstablishmentData,
        categories: ['Invalid Category'],
      };

      await expect(createEstablishment(partnerId, invalidData)).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CATEGORY_VALUE',
      });
    });

    test('should accept 1-2 valid categories', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);
      EstablishmentModel.createEstablishment.mockResolvedValue(mockEstablishment);

      // 1 category
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          categories: ['Ресторан'],
        })
      ).resolves.toBeDefined();

      // 2 categories
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          categories: ['Ресторан', 'Бар'],
        })
      ).resolves.toBeDefined();
    });

    test('should throw error for invalid cuisines length', async () => {
      // Too few
      await expect(
        createEstablishment(partnerId, { ...validEstablishmentData, cuisines: [] })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CUISINES_LENGTH',
      });

      // Too many
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          cuisines: ['Народная', 'Европейская', 'Азиатская', 'Итальянская'], // 4 items
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CUISINES_LENGTH',
      });
    });

    test('should throw error for invalid cuisine values', async () => {
      const invalidData = {
        ...validEstablishmentData,
        cuisines: ['Invalid Cuisine'],
      };

      await expect(createEstablishment(partnerId, invalidData)).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_CUISINE_VALUE',
      });
    });

    test('should accept 1-3 valid cuisines', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);
      EstablishmentModel.createEstablishment.mockResolvedValue(mockEstablishment);

      // 1 cuisine
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          cuisines: ['Народная'],
        })
      ).resolves.toBeDefined();

      // 3 cuisines
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          cuisines: ['Народная', 'Европейская', 'Азиатская'],
        })
      ).resolves.toBeDefined();
    });

    test('should validate latitude within Belarus bounds', async () => {
      // Too low (south of Belarus)
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          latitude: 50.0, // Below 51.0
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_LATITUDE',
      });

      // Too high (north of Belarus)
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          latitude: 57.0, // Above 56.0
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_LATITUDE',
      });
    });

    test('should validate longitude within Belarus bounds', async () => {
      // Too low (west of Belarus)
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          longitude: 22.0, // Below 23.0
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_LONGITUDE',
      });

      // Too high (east of Belarus)
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          longitude: 34.0, // Above 33.0
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_LONGITUDE',
      });
    });

    test('should accept valid Belarus coordinates', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);
      EstablishmentModel.createEstablishment.mockResolvedValue(mockEstablishment);

      // Minsk coordinates
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          latitude: 53.9,
          longitude: 27.5,
        })
      ).resolves.toBeDefined();

      // Brest coordinates
      await expect(
        createEstablishment(partnerId, {
          ...validEstablishmentData,
          latitude: 52.1,
          longitude: 23.7,
        })
      ).resolves.toBeDefined();
    });

    test('should throw error for duplicate establishment name', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(true);

      await expect(createEstablishment(partnerId, validEstablishmentData)).rejects.toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_ESTABLISHMENT',
      });

      expect(EstablishmentModel.createEstablishment).not.toHaveBeenCalled();
    });

    test('should handle database unique constraint violation', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);

      const dbError = new Error('Unique violation');
      dbError.code = '23505';
      EstablishmentModel.createEstablishment.mockRejectedValue(dbError);

      await expect(createEstablishment(partnerId, validEstablishmentData)).rejects.toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_ESTABLISHMENT',
      });
    });

    test('should handle database check constraint violation', async () => {
      EstablishmentModel.checkDuplicateName.mockResolvedValue(false);

      const dbError = new Error('Check constraint violation');
      dbError.code = '23514';
      EstablishmentModel.createEstablishment.mockRejectedValue(dbError);

      await expect(createEstablishment(partnerId, validEstablishmentData)).rejects.toMatchObject({
        statusCode: 422,
        code: 'CONSTRAINT_VIOLATION',
      });
    });
  });

  describe('getPartnerEstablishments', () => {
    test('should fetch establishments with default pagination', async () => {
      const mockEstablishments = [
        createMockEstablishment(),
        createMockEstablishment(),
      ];

      EstablishmentModel.getEstablishmentsByPartner.mockResolvedValue(mockEstablishments);
      EstablishmentModel.countPartnerEstablishments.mockResolvedValue(15);

      const result = await getPartnerEstablishments(partnerId);

      expect(result.establishments).toEqual(mockEstablishments);
      expect(result.meta).toEqual({
        total: 15,
        page: 1,
        limit: 20,
        pages: 1,
      });

      expect(EstablishmentModel.getEstablishmentsByPartner).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          limit: 20,
          offset: 0,
        })
      );
    });

    test('should handle custom pagination parameters', async () => {
      EstablishmentModel.getEstablishmentsByPartner.mockResolvedValue([]);
      EstablishmentModel.countPartnerEstablishments.mockResolvedValue(100);

      const result = await getPartnerEstablishments(partnerId, { page: 3, limit: 10 });

      expect(result.meta).toEqual({
        total: 100,
        page: 3,
        limit: 10,
        pages: 10,
      });

      expect(EstablishmentModel.getEstablishmentsByPartner).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          limit: 10,
          offset: 20, // (page 3 - 1) * 10
        })
      );
    });

    test('should enforce maximum limit of 50', async () => {
      EstablishmentModel.getEstablishmentsByPartner.mockResolvedValue([]);
      EstablishmentModel.countPartnerEstablishments.mockResolvedValue(100);

      await getPartnerEstablishments(partnerId, { page: 1, limit: 100 });

      expect(EstablishmentModel.getEstablishmentsByPartner).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          limit: 50, // Capped at 50
        })
      );
    });

    test('should filter by status when provided', async () => {
      EstablishmentModel.getEstablishmentsByPartner.mockResolvedValue([]);
      EstablishmentModel.countPartnerEstablishments.mockResolvedValue(5);

      await getPartnerEstablishments(partnerId, { status: 'active' });

      expect(EstablishmentModel.getEstablishmentsByPartner).toHaveBeenCalledWith(
        partnerId,
        expect.objectContaining({
          status: 'active',
        })
      );

      expect(EstablishmentModel.countPartnerEstablishments).toHaveBeenCalledWith(
        partnerId,
        'active'
      );
    });

    test('should handle database errors gracefully', async () => {
      EstablishmentModel.getEstablishmentsByPartner.mockRejectedValue(
        new Error('Database error')
      );

      await expect(getPartnerEstablishments(partnerId)).rejects.toMatchObject({
        statusCode: 500,
        code: 'ESTABLISHMENTS_FETCH_FAILED',
      });

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getEstablishmentById', () => {
    const establishmentId = 'establishment-123';

    test('should fetch establishment when partner owns it', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);

      const result = await getEstablishmentById(establishmentId, partnerId);

      expect(result).toEqual(mockEstablishment);
      expect(EstablishmentModel.checkOwnership).toHaveBeenCalledWith(
        establishmentId,
        partnerId
      );
      expect(EstablishmentModel.findEstablishmentById).toHaveBeenCalledWith(
        establishmentId,
        true
      );
    });

    test('should throw error when partner does not own establishment', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(false);

      await expect(getEstablishmentById(establishmentId, partnerId)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ESTABLISHMENT_NOT_FOUND',
      });

      expect(EstablishmentModel.findEstablishmentById).not.toHaveBeenCalled();
    });

    test('should throw error when establishment not found', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(null);

      await expect(getEstablishmentById(establishmentId, partnerId)).rejects.toMatchObject({
        statusCode: 404,
        code: 'ESTABLISHMENT_NOT_FOUND',
      });
    });

    test('should handle database errors', async () => {
      EstablishmentModel.checkOwnership.mockRejectedValue(new Error('Database error'));

      await expect(getEstablishmentById(establishmentId, partnerId)).rejects.toMatchObject({
        statusCode: 500,
        code: 'ESTABLISHMENT_FETCH_FAILED',
      });

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('updateEstablishment', () => {
    const establishmentId = 'establishment-123';

    test('should update establishment when partner owns it', async () => {
      const updates = {
        description: 'Updated description',
        phone: '+375171234568',
      };

      const updatedEstablishment = {
        ...mockEstablishment,
        ...updates,
      };

      EstablishmentModel.checkOwnership.mockResolvedValue(true);
      EstablishmentModel.findEstablishmentById.mockResolvedValue(mockEstablishment);
      EstablishmentModel.updateEstablishment.mockResolvedValue(updatedEstablishment);

      const result = await updateEstablishment(establishmentId, partnerId, updates);

      expect(result).toEqual(updatedEstablishment);
      expect(EstablishmentModel.checkOwnership).toHaveBeenCalledWith(
        establishmentId,
        partnerId
      );
    });

    test('should throw error when partner does not own establishment', async () => {
      EstablishmentModel.checkOwnership.mockResolvedValue(false);

      await expect(
        updateEstablishment(establishmentId, partnerId, { description: 'New' })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      });

      expect(EstablishmentModel.updateEstablishment).not.toHaveBeenCalled();
    });
  });
});
