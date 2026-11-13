import { Router, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { sendError, sendSuccess } from '../../core/http/apiResponse.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { manufacturingRepository as repository } from './manufacturing.repository.js';
import { bomCreateSchema, manufacturingIdSchema, manufacturingListSchema, workOrderActionSchema, workOrderCreateSchema } from './manufacturing.schema.js';

const actor = (req: Request) => req.user!.id;
const metadata = (req: Request) => ({ firmId: getFirmId(req), userId: actor(req), ipAddress: req.ip, userAgent: req.get('user-agent') });
const trustedOrigin: RequestHandler = (req, _res, next) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('origin') === new URL(env.FRONTEND_URL).origin ? next() : next(new AppError('Manufacturing request origin is not allowed', 403));
export const manufacturingRouter = Router();
manufacturingRouter.use(requireAuthentication, requireFirmContext, trustedOrigin);
manufacturingRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
manufacturingRouter.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `${getFirmId(req)}:${actor(req)}`,
  handler: (_req, res) => { sendError(res, 429, 'Manufacturing request rate limit reached'); },
}));
manufacturingRouter.get('/reference-options', requirePermission(PERMISSIONS.MANUFACTURING_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Manufacturing options retrieved', await repository.options(getFirmId(req), actor(req), z.string().trim().max(191).default('').parse(req.query.search)))));
for (const kind of ['boms', 'work-orders'] as const) manufacturingRouter.get(`/${kind}`, requirePermission(PERMISSIONS.MANUFACTURING_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Manufacturing records retrieved', await repository.list(getFirmId(req), actor(req), kind, manufacturingListSchema.parse(req.query)))));
manufacturingRouter.post('/boms', requirePermission(PERMISSIONS.MANUFACTURING_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'BOM version created', { bom: await repository.createBom(getFirmId(req), actor(req), bomCreateSchema.parse(req.body), metadata(req)) })));
manufacturingRouter.post('/work-orders', requirePermission(PERMISSIONS.MANUFACTURING_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Work order created', { order: await repository.createOrder(getFirmId(req), actor(req), workOrderCreateSchema.parse(req.body), metadata(req)) })));
manufacturingRouter.get('/work-orders/:id', requirePermission(PERMISSIONS.MANUFACTURING_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Work order retrieved', { order: await repository.getOrder(getFirmId(req), actor(req), manufacturingIdSchema.parse(req.params.id)) })));
for (const action of ['complete', 'cancel'] as const) manufacturingRouter.post(`/work-orders/:id/${action}`, requirePermission(PERMISSIONS.MANUFACTURING_POST), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Work order updated', { order: await repository.transition(getFirmId(req), actor(req), manufacturingIdSchema.parse(req.params.id), action, workOrderActionSchema.parse(req.body), metadata(req)) })));
