import { Router } from 'express';

import { prisma } from '../core/database/prisma.js';
import { asyncHandler } from '../core/http/asyncHandler.js';
import { sendSuccess } from '../core/http/apiResponse.js';

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
