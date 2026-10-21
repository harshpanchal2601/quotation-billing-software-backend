import { Router } from 'express';

import { checkDatabaseHealth } from '../core/database/database-health.js';
import { asyncHandler } from '../core/http/asyncHandler.js';
import { sendSuccess } from '../core/http/apiResponse.js';

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, 200, 'ERP API is running', {
      status: 'healthy',
    });
  }),
);

healthRouter.get(
  '/database',
  asyncHandler(async (_req, res) => {
    try {
      await checkDatabaseHealth();

      return sendSuccess(res, 200, 'Database connection is healthy', {
        status: 'healthy',
      });
    } catch {
      return res.status(503).json({
        success: false,
        message: 'Database connection is unavailable',
        data: {
          status: 'unhealthy',
        },
      });
    }
  }),
);
