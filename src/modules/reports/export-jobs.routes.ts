import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { exportJobsRepository as repository } from './export-jobs.repository.js';
import { exportJobCreateSchema, exportJobIdSchema, exportJobListSchema } from './export-jobs.schema.js';

export const exportJobsRouter = Router();
const metadata = (req: Request) => ({ userId: req.user!.id, firmId: getFirmId(req), ipAddress: req.ip, userAgent: req.get('user-agent') });
exportJobsRouter.use(requireAuthentication, requireFirmContext, requirePermission(PERMISSIONS.REPORTS_EXPORT));
exportJobsRouter.use((req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); return ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('origin') === new URL(env.FRONTEND_URL).origin ? next() : next(new AppError('Export request origin is not allowed', 403)); });
exportJobsRouter.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `${getFirmId(req)}:${req.user!.id}` }));
exportJobsRouter.get('/', asyncHandler(async (req, res) => { const { page, limit, ...sort } = exportJobListSchema.parse(req.query); return sendSuccess(res, 200, 'Export jobs retrieved', await repository.list(getFirmId(req), req.user!.id, page, limit, sort)); }));
exportJobsRouter.post('/', asyncHandler(async (req, res) => sendSuccess(res, 202, 'Export job queued', { job: await repository.create(getFirmId(req), req.user!.id, exportJobCreateSchema.parse(req.body), metadata(req)) })));
exportJobsRouter.get('/:id/download', asyncHandler(async (req, res) => {
  const id = exportJobIdSchema.parse(req.params.id);
  const result = await repository.download(getFirmId(req), req.user!.id, id, metadata(req));
  res.setHeader('Content-Type', result.format === 'csv' ? 'text/csv; charset=utf-8' : result.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report-${id}.${result.format}"`);
  return res.status(200).send(result.buffer);
}));
exportJobsRouter.delete('/:id', asyncHandler(async (req, res) => { await repository.remove(getFirmId(req), req.user!.id, exportJobIdSchema.parse(req.params.id), metadata(req)); return sendSuccess(res, 200, 'Export job removed', {}); }));
