import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { sendError, sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { reportQuerySchema, reportsRepository } from '../reports/index.js';
import { apiKeysRepository } from './api-keys.repository.js';
import type { ApiScope } from './connections.schema.js';

export const externalApiRouter = Router();
externalApiRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
externalApiRouter.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
const authenticate = (scope: ApiScope): RequestHandler => (req, res, next) => {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  void apiKeysRepository.authenticate(token, scope).then((identity) => { res.locals.apiIdentity = identity; next(); }).catch(next);
};
const budget = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (_req, res) => res.locals.apiIdentity.id as string, handler: (_req, res) => { sendError(res, 429, 'API credential request rate limit reached'); } });
externalApiRouter.get('/reports/overview', authenticate('reports.read'), budget, asyncHandler(async (req, res) => {
  const identity = res.locals.apiIdentity as { firmId: number; actorId: number };
  const report = await reportsRepository.overview(identity.firmId, identity.actorId, reportQuerySchema.parse(req.query));
  await apiKeysRepository.authenticate(req.get('authorization')!.slice(7), 'reports.read');
  return sendSuccess(res, 200, 'Report retrieved', report);
}));
for (const format of ['csv', 'xlsx', 'pdf'] as const) {
  externalApiRouter.get(`/reports/export.${format}`, authenticate('reports.export'), budget, asyncHandler(async (req, res) => {
    const identity = res.locals.apiIdentity as { firmId: number; actorId: number };
    const query = reportQuerySchema.parse(req.query);
    const output = await reportsRepository.exportReport(identity.firmId, identity.actorId, query, { userId: identity.actorId, firmId: identity.firmId }, format);
    await apiKeysRepository.authenticate(req.get('authorization')!.slice(7), 'reports.export');
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reports-${query.dateFrom}-${query.dateTo}.${format}"`);
    return res.status(200).send(output);
  }));
}
