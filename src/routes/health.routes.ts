import { Router } from 'express';

import { env } from '../config/env.js';
import { checkDatabaseHealth } from '../core/database/database-health.js';
import { asyncHandler } from '../core/http/asyncHandler.js';
import { sendSuccess } from '../core/http/apiResponse.js';
import { runtimeState } from '../core/observability/runtime.js';

export const healthRouter = Router();
healthRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

healthRouter.get(
  ['/', '/live'],
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, 200, 'ERP API is running', {
      status: 'healthy',
    });
  }),
);

healthRouter.get('/ready', asyncHandler(async (_req, res) => {
  try {
    if (runtimeState.isDraining() || !runtimeState.workerReady(env.OUTBOX_WORKER_ENABLED, env.WORKER_STALE_AFTER_MS)) throw new Error('Not ready');
    await checkDatabaseHealth();
    // Shutdown can begin while the database probe is pending.
    if (runtimeState.isDraining() || !runtimeState.workerReady(env.OUTBOX_WORKER_ENABLED, env.WORKER_STALE_AFTER_MS)) throw new Error('Not ready');
    return sendSuccess(res, 200, 'Service is ready', { status: 'ready' });
  } catch {
    return res.status(503).json({ success: false, message: 'Service is not ready', data: { status: 'not_ready' } });
  }
}));

healthRouter.get('/worker', (_req, res) => {
  const healthy = runtimeState.workerReady(env.OUTBOX_WORKER_ENABLED, env.WORKER_STALE_AFTER_MS);
  return res.status(healthy ? 200 : 503).json({ success: healthy, message: healthy ? 'Worker is available' : 'Worker is unavailable', data: { status: healthy ? env.OUTBOX_WORKER_ENABLED ? 'healthy' : 'disabled' : 'unhealthy' } });
});

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
