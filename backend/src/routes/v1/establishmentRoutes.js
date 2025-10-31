/**
 * Establishment Routes
 * 
 * This module defines all establishment-related API endpoints for partners,
 * composing controllers, validation middleware, and authentication middleware
 * into complete request handling pipelines.
 * 
 * Architecture note: Routes are declarative specifications of how requests flow
 * through middleware chains. They should be readable as documentation of the API
 * surface without containing any logic themselves.
 * 
 * All endpoints in this file are partner-only and require authentication.
 * The base path is /api/v1/partner/establishments when mounted in v1/index.js
 */

import express from 'express';
import * as EstablishmentController from '../../controllers/establishmentController.js';
import * as EstablishmentValidation from '../../validators/establishmentValidation.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/errorHandler.js';
import mediaRoutes from './mediaRoutes.js';

const router = express.Router();

/**
 * Apply authentication to all routes in this router
 * 
 * All establishment management endpoints require:
 * 1. Valid JWT token (authenticate middleware)
 * 2. 'partner' role (authorize middleware)
 * 
 * This is more efficient than repeating authentication on each route.
 */
router.use(authenticate);
router.use(authorize('partner'));

/**
 * Get all establishments for the authenticated partner
 * 
 * GET /api/v1/partner/establishments
 * 
 * Query parameters (all optional):
 * - status: Filter by status ('draft', 'pending', 'active', 'suspended')
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 50)
 * 
 * Flow: Authentication → Authorization → Validation → Controller → Service → Model
 * 
 * Returns: Array of establishments with pagination metadata
 * 
 * Protected: Yes (partner role required)
 */
router.get(
  '/',
  EstablishmentValidation.validateList,
  validate,
  EstablishmentController.listPartnerEstablishments
);

/**
 * Create a new establishment
 * 
 * POST /api/v1/partner/establishments
 * 
 * Creates a new establishment in 'draft' status, allowing partners to build
 * their listing incrementally before submission.
 * 
 * Request body: Complete establishment data (see validation for schema)
 * 
 * Flow: Authentication → Authorization → Validation → Controller → Service → Model
 * 
 * Returns: Created establishment with 201 status
 * 
 * Protected: Yes (partner role required)
 * Rate Limited: Yes (100 requests/minute per partner)
 */
router.post(
  '/',
  EstablishmentValidation.validateCreate,
  validate,
  EstablishmentController.createEstablishment
);

/**
 * Get a specific establishment by ID
 * 
 * GET /api/v1/partner/establishments/:id
 * 
 * Returns complete establishment details for the partner's editing interface.
 * The service layer verifies ownership before returning data.
 * 
 * Path parameters:
 * - id: UUID of the establishment
 * 
 * Flow: Authentication → Authorization → Validation → Controller → Service → Ownership Check
 * 
 * Returns: Complete establishment object
 * 
 * Protected: Yes (partner role required, ownership verified)
 */
router.get(
  '/:id',
  EstablishmentValidation.validateGetDetails,
  validate,
  EstablishmentController.getEstablishmentDetails
);

/**
 * Update an existing establishment
 * 
 * PUT /api/v1/partner/establishments/:id
 * 
 * Allows partners to modify their establishment details. The service layer
 * enforces business rules about which fields can be updated and handles
 * status transitions.
 * 
 * Path parameters:
 * - id: UUID of the establishment
 * 
 * Request body: Fields to update (all optional)
 * 
 * Flow: Authentication → Authorization → Validation → Controller → Service → Ownership Check
 * 
 * Returns: Updated establishment object
 * 
 * Protected: Yes (partner role required, ownership verified)
 * 
 * Note: Major changes (name, categories, cuisines) will automatically reset
 * status from 'active' to 'pending' to require re-moderation.
 */
router.put(
  '/:id',
  EstablishmentValidation.validateUpdate,
  validate,
  EstablishmentController.updateEstablishment
);

/**
 * Submit establishment for moderation
 * 
 * POST /api/v1/partner/establishments/:id/submit
 * 
 * Changes establishment status from 'draft' to 'pending' after validating
 * that all required information is complete and required media is uploaded.
 * 
 * Path parameters:
 * - id: UUID of the establishment
 * 
 * Flow: Authentication → Authorization → Validation → Controller → Service → Pre-submission Checks
 * 
 * Returns: Updated establishment with 'pending' status
 * 
 * Protected: Yes (partner role required, ownership verified)
 * 
 * Pre-submission requirements (enforced by service layer):
 * - Establishment must be in 'draft' status
 * - All required fields must be complete
 * - At least 1 interior photo uploaded
 * - At least 1 menu photo uploaded
 * - Primary photo must be set
 */
router.post(
  '/:id/submit',
  EstablishmentValidation.validateSubmit,
  validate,
  EstablishmentController.submitForModeration
);

/**
 * Mount media routes (Phase Two integration)
 * 
 * This nests all media management endpoints under the establishment routes,
 * creating the following URL structure:
 * 
 * POST   /partner/establishments/:id/media           - Upload media
 * GET    /partner/establishments/:id/media           - Get all media
 * PUT    /partner/establishments/:id/media/:mediaId  - Update media
 * DELETE /partner/establishments/:id/media/:mediaId  - Delete media
 * 
 * The :id parameter from this router is accessible to media routes through
 * Express's mergeParams: true setting in the media router configuration.
 * 
 * IMPORTANT: This mount must come AFTER the /:id/submit route definition
 * to prevent '/:id/media' from being matched as '/:id/:submit' due to
 * Express's route matching order.
 */
router.use('/:id/media', mediaRoutes);

export default router;

