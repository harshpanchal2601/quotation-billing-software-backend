import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';
import { sendError, sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { importsRepository as repository } from './imports.repository.js';
import { importCommandSchema, importIdSchema, importListSchema, importPreviewSchema } from './imports.schema.js';

export const importsRouter = Router();
const actor = (req: Request) => req.user!.id;
const metadata = (req: Request) => ({ userId: actor(req), firmId: getFirmId(req), ipAddress: req.ip, userAgent: req.get('user-agent') });
importsRouter.use(requireAuthentication, requireFirmContext, requirePermission(PERMISSIONS.IMPORTS_MANAGE));
importsRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== new URL(env.FRONTEND_URL).origin) return next(new AppError('Import request origin is not allowed', 403));
  return next();
});
importsRouter.use(rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `${getFirmId(req)}:${actor(req)}`, handler: (_req, res) => { sendError(res, 429, 'Import request rate limit reached'); } }));
importsRouter.get('/', asyncHandler(async (req, res) => {
  const { page, limit, ...sort } = importListSchema.parse(req.query);
  return sendSuccess(res, 200, 'Imports retrieved', await repository.list(getFirmId(req), actor(req), page, limit, sort));
}));
importsRouter.post('/preview', asyncHandler(async (req, res) => {
  const input = importPreviewSchema.parse(req.body);
  const { id } = await repository.preview(getFirmId(req), actor(req), input.target, input.csv, metadata(req));
  return sendSuccess(res, 201, 'Import preview created', await repository.detail(getFirmId(req), actor(req), id));
}));
importsRouter.get('/:id', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Import retrieved', await repository.detail(getFirmId(req), actor(req), importIdSchema.parse(req.params.id)))));
importsRouter.post('/:id/commit', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Import processed', await repository.commit(getFirmId(req), actor(req), importIdSchema.parse(req.params.id), importCommandSchema.parse(req.body).expectedVersion, metadata(req)))));
importsRouter.post('/:id/rows/:rowId/compensate', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Imported record deactivated', await repository.compensate(getFirmId(req), actor(req), importIdSchema.parse(req.params.id), importIdSchema.parse(req.params.rowId), importCommandSchema.parse(req.body).expectedVersion, metadata(req)))));
