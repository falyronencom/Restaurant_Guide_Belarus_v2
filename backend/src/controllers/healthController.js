import pool from '../config/database.js';
import redisClient from '../config/redis.js';
import logger from '../utils/logger.js';

/**
 * Health check endpoint controller.
 * 
 * This endpoint is critical for production monitoring and load balancer health checks.
 * It verifies that all critical dependencies (database, Redis) are operational.
 * 
 * Health check philosophy:
 * - Fast: Should respond in <100ms to avoid triggering load balancer timeouts
 * - Comprehensive: Check all critical dependencies, not just that the server is running
 * - Informative: Provide enough detail for debugging without exposing security issues
 * 
 * Response format follows industry standards for health checks, making it compatible
 * with common monitoring tools (Kubernetes, AWS ELB, etc.).
 * 
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const healthCheck = async (req, res) => {
  const startTime = Date.now();
  
  // Track status of each dependency
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      database: { status: 'unknown', responseTime: null },
      redis: { status: 'unknown', responseTime: null },
      memory: { status: 'healthy', usage: null },
    },
  };

  // Check database connectivity
  try {
    const dbStartTime = Date.now();
    await pool.query('SELECT 1');
    health.checks.database = {
      status: 'healthy',
      responseTime: Date.now() - dbStartTime,
    };
  } catch (error) {
    health.status = 'unhealthy';
    health.checks.database = {
      status: 'unhealthy',
      error: error.message,
      responseTime: null,
    };
    logger.error('Database health check failed', { error: error.message });
  }

  // Check Redis connectivity
  try {
    const redisStartTime = Date.now();
    await redisClient.ping();
    health.checks.redis = {
      status: 'healthy',
      responseTime: Date.now() - redisStartTime,
    };
  } catch (error) {
    health.status = 'unhealthy';
    health.checks.redis = {
      status: 'unhealthy',
      error: error.message,
      responseTime: null,
    };
    logger.error('Redis health check failed', { error: error.message });
  }

  // Check memory usage
  const memoryUsage = process.memoryUsage();
  const memoryUsageMB = {
    rss: Math.round(memoryUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    external: Math.round(memoryUsage.external / 1024 / 1024),
  };

  health.checks.memory = {
    status: 'healthy',
    usage: memoryUsageMB,
  };

  // Calculate total response time
  health.responseTime = Date.now() - startTime;

  // Return appropriate HTTP status code based on health
  const statusCode = health.status === 'healthy' ? 200 : 503;
  
  res.status(statusCode).json({
    success: health.status === 'healthy',
    data: health,
    timestamp: new Date().toISOString(),
  });
};
