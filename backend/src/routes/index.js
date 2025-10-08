import express from 'express';
import v1Routes from './v1/index.js';

const router = express.Router();

/**
 * API Routes Entry Point
 * 
 * This file serves as the main router that mounts all API versions.
 * Currently supports v1, with room for future API versioning (v2, v3, etc.)
 */

// Mount v1 routes at /api/v1
router.use('/v1', v1Routes);

/**
 * API Version Info - GET /api
 * 
 * Returns information about available API versions
 */
router.get('/', (req, res) => {
  res.json({
    message: 'Restaurant Guide Belarus API',
    version: '1.0.0',
    availableVersions: ['v1'],
    endpoints: {
      v1: '/api/v1',
      health: '/api/v1/health',
      docs: '/api/v1/docs' // Future: API documentation
    }
  });
});

export default router;

