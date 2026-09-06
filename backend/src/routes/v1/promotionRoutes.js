/**
 * Promotion Routes
 *
 * Partner-facing promotion CRUD endpoints:
 *   POST   /api/v1/partner/promotions                              — create promotion
 *   GET    /api/v1/partner/promotions/establishment/:establishmentId — list promotions
 *   PATCH  /api/v1/partner/promotions/:id                          — update promotion
 *   DELETE /api/v1/partner/promotions/:id                          — deactivate promotion
 *
 * All endpoints require authentication and partner role.
 * Ownership verified at the service layer.
 *
 * File upload: POST and PATCH accept optional image via multipart/form-data.
 * Follows multer config pattern from mediaRoutes.js.
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as PromotionController from '../../controllers/promotionController.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { TEMP_UPLOAD_DIR } from '../../middleware/upload.js';

const router = express.Router();

// Multer config — same pattern as mediaRoutes.js; the temp dir is the
// module-relative TEMP_UPLOAD_DIR (created at import by middleware/upload.js)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and HEIC images are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// All promotion routes require authenticated partner
router.use(authenticate);
router.use(authorize(['partner']));

// POST / — create promotion (optional image)
router.post(
  '/',
  upload.single('image'),
  PromotionController.createPromotion,
);

// GET /establishment/:establishmentId — list promotions for partner's establishment
router.get(
  '/establishment/:establishmentId',
  PromotionController.getPromotions,
);

// PATCH /:id — update promotion (optional new image)
router.patch(
  '/:id',
  upload.single('image'),
  PromotionController.updatePromotion,
);

// DELETE /:id — deactivate promotion (soft delete)
router.delete(
  '/:id',
  PromotionController.deletePromotion,
);

export default router;
