import { Router } from 'express';

import { prisma } from '../config/database.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

export const healthRouter = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, 200, 'Buminex API is running', {
      status: 'healthy',
    });
  }),
);

healthRouter.get(
  '/database',
  asyncHandler(async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;

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
