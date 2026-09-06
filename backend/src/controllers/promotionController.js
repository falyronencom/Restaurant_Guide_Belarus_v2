/**
 * Promotion Controller
 *
 * HTTP handlers for promotion CRUD endpoints.
 * Thin layer: extracts params, delegates to promotionService, formats response.
 * Follows patterns from mediaController.js.
 */

import * as PromotionService from '../services/promotionService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { discardTempUpload } from '../utils/tempUpload.js';
import logger from '../utils/logger.js';

/**
 * POST /api/v1/partner/promotions
 * Create a new promotion (multipart/form-data for optional image).
 */
export const createPromotion = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { establishment_id, title, description, terms_and_conditions, valid_from, valid_until, position } = req.body;

  // The optional image is already on disk (multer, TEMP_UPLOAD_DIR) and nothing
  // downstream deletes it: the finally discards it on every outcome — the 400s
  // below, a service throw, a DB error, success — and the 201 is sent only
  // after the disk is clean.
  let promotion;
  try {
    if (!establishment_id) {
      return res.status(400).json({
        success: false,
        message: 'establishment_id is required',
        error: { code: 'VALIDATION_ERROR' },
      });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'title is required',
        error: { code: 'VALIDATION_ERROR' },
      });
    }

    promotion = await PromotionService.createPromotion(
      partnerId,
      establishment_id,
      { title: title.trim(), description, terms_and_conditions, valid_from, valid_until, position },
      req.file || null,
    );
  } finally {
    await discardTempUpload(req.file);
  }

  logger.info('Promotion created via API', {
    promotionId: promotion.id,
    establishmentId: establishment_id,
    partnerId,
    endpoint: 'POST /api/v1/partner/promotions',
  });

  res.status(201).json({
    success: true,
    data: promotion,
  });
});

/**
 * GET /api/v1/partner/promotions/establishment/:establishmentId
 * List all promotions for a partner's establishment (including inactive).
 */
export const getPromotions = asyncHandler(async (req, res) => {
  const { establishmentId } = req.params;

  const promotions = await PromotionService.getPromotions(establishmentId, true);

  res.status(200).json({
    success: true,
    data: promotions,
  });
});

/**
 * PATCH /api/v1/partner/promotions/:id
 * Update a promotion.
 */
export const updatePromotion = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { id } = req.params;
  const { title, description, terms_and_conditions, valid_from, valid_until, position } = req.body;

  // Same ownership of the optional image as in createPromotion: discarded in
  // the finally on every outcome, before the 200 leaves.
  let promotion;
  try {
    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description;
    if (terms_and_conditions !== undefined) updateData.terms_and_conditions = terms_and_conditions;
    if (valid_from !== undefined) updateData.valid_from = valid_from;
    if (valid_until !== undefined) updateData.valid_until = valid_until;
    if (position !== undefined) updateData.position = position;

    promotion = await PromotionService.updatePromotion(
      partnerId,
      id,
      updateData,
      req.file || null,
    );
  } finally {
    await discardTempUpload(req.file);
  }

  logger.info('Promotion updated via API', {
    promotionId: id,
    partnerId,
    endpoint: 'PATCH /api/v1/partner/promotions/:id',
  });

  res.status(200).json({
    success: true,
    data: promotion,
  });
});

/**
 * DELETE /api/v1/partner/promotions/:id
 * Deactivate a promotion (soft delete → status='expired').
 */
export const deletePromotion = asyncHandler(async (req, res) => {
  const partnerId = req.user.userId;
  const { id } = req.params;

  const promotion = await PromotionService.deactivatePromotion(partnerId, id);

  logger.info('Promotion deactivated via API', {
    promotionId: id,
    partnerId,
    endpoint: 'DELETE /api/v1/partner/promotions/:id',
  });

  res.status(200).json({
    success: true,
    data: promotion,
  });
});
