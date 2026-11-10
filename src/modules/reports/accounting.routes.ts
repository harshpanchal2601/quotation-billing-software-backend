import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { accountingRepository as repository } from './accounting.repository.js';
import { accountingExportSchema, accountingMappingCommandSchema } from './accounting.schema.js';

export const accountingRouter = Router();
accountingRouter.use(requireAuthentication, requireFirmContext, requirePermission(PERMISSIONS.ACCOUNTING_EXPORT));
accountingRouter.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `${getFirmId(req)}:${req.user!.id}` }));
accountingRouter.use((req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); return ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('origin') === new URL(env.FRONTEND_URL).origin ? next() : next(new AppError('Accounting request origin is not allowed', 403)); });
accountingRouter.get('/mapping', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Accounting mapping retrieved', await repository.mapping(getFirmId(req), req.user!.id))));
accountingRouter.post('/mapping', requirePermission(PERMISSIONS.ACCOUNTING_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Accounting mapping version published', await repository.saveMapping(getFirmId(req), req.user!.id, accountingMappingCommandSchema.parse(req.body), { userId: req.user!.id, firmId: getFirmId(req), ipAddress: req.ip, userAgent: req.get('user-agent') }))));
accountingRouter.get('/export.csv', asyncHandler(async (req, res) => {
  const query = accountingExportSchema.parse(req.query);
  const result = await repository.export(getFirmId(req), req.user!.id, query, { userId: req.user!.id, firmId: getFirmId(req), ipAddress: req.ip, userAgent: req.get('user-agent') });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="billing-journal-${query.dateFrom}-${query.dateTo}.csv"`);
  res.setHeader('X-Content-SHA256', result.sha256);
  return res.status(200).send(result.csv);
}));
