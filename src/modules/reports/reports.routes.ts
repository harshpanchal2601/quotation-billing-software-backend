import { Router, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';
import { sendError, sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { reportsRepository as repository } from './reports.repository.js';
import { reportQuerySchema, savedViewCreateSchema, savedViewIdSchema, savedViewUpdateSchema, savedViewsQuerySchema } from './reports.schema.js';

const actor = (req: Request) => req.user!.id;
const metadata = (req: Request) => ({ userId: actor(req), firmId: getFirmId(req), ipAddress: req.ip, userAgent: req.get('user-agent') });
const trustedOrigin: RequestHandler = (req, _res, next) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('origin') === new URL(env.FRONTEND_URL).origin ? next() : next(new AppError('Report request origin is not allowed', 403));
export const reportsRouter = Router();
reportsRouter.use(requireAuthentication, requireFirmContext, requirePermission(PERMISSIONS.REPORTS_VIEW), trustedOrigin);
reportsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
reportsRouter.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `${getFirmId(req)}:${actor(req)}`,
  handler: (_req, res) => { sendError(res, 429, 'Report request rate limit reached'); },
}));
reportsRouter.get('/overview', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Report retrieved', await repository.overview(getFirmId(req), actor(req), reportQuerySchema.parse(req.query)))));
reportsRouter.get('/export.csv', requirePermission(PERMISSIONS.REPORTS_EXPORT), asyncHandler(async (req, res) => {
  const query = reportQuerySchema.parse(req.query);
  const csv = await repository.exportCsv(getFirmId(req), actor(req), query, metadata(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="reports-${query.dateFrom}-${query.dateTo}.csv"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(csv);
}));
reportsRouter.get('/saved-views', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Saved reports retrieved', await repository.listViews(getFirmId(req), actor(req), savedViewsQuerySchema.parse(req.query)))));
reportsRouter.post('/saved-views', asyncHandler(async (req, res) => sendSuccess(res, 201, 'Report view saved', { view: await repository.saveView(getFirmId(req), actor(req), savedViewCreateSchema.parse(req.body), metadata(req)) })));
reportsRouter.put('/saved-views/:id', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Report view updated', { view: await repository.saveView(getFirmId(req), actor(req), savedViewUpdateSchema.parse(req.body), metadata(req), savedViewIdSchema.parse(req.params.id)) })));
reportsRouter.delete('/saved-views/:id', asyncHandler(async (req, res) => {
  const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
  await repository.deleteView(getFirmId(req), actor(req), savedViewIdSchema.parse(req.params.id), expectedVersion, metadata(req));
  return sendSuccess(res, 200, 'Saved report deleted', {});
}));
