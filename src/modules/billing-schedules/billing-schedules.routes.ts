import { Router, type Request } from 'express';
import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { billingSchedulesRepository as repository } from './billing-schedules.repository.js';
import { scheduleApproveSchema, scheduleCreateSchema, scheduleIdSchema, scheduleListSchema, scheduleRetrySchema, scheduleUpdateSchema, scheduleVersionSchema } from './billing-schedules.schema.js';

function actor(req: Request) { if (!req.user) throw new AppError('Authentication required', 401); return req.user.id; }
function metadata(req: Request) { return { firmId: getFirmId(req), userId: actor(req), ipAddress: req.ip, userAgent: req.get('user-agent') }; }
export const billingSchedulesRouter = Router();
billingSchedulesRouter.use(requireAuthentication, requireFirmContext, requirePermission(PERMISSIONS.BILLING_RECURRING), requirePermission(PERMISSIONS.INVOICES_CREATE));
billingSchedulesRouter.get('/', asyncHandler(async (req, res) => { const query = scheduleListSchema.parse(req.query); return sendSuccess(res, 200, 'Billing schedules retrieved', await repository.list(getFirmId(req), actor(req), query.page, query.limit)); }));
billingSchedulesRouter.post('/', asyncHandler(async (req, res) => sendSuccess(res, 201, 'Paused schedule created', { schedule: await repository.create(getFirmId(req), actor(req), scheduleCreateSchema.parse(req.body), metadata(req)) })));
billingSchedulesRouter.get('/:id', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Billing schedule retrieved', { schedule: await repository.get(getFirmId(req), actor(req), scheduleIdSchema.parse(req.params).id) })));
billingSchedulesRouter.patch('/:id', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Schedule revision created', { schedule: await repository.update(getFirmId(req), actor(req), scheduleIdSchema.parse(req.params).id, scheduleUpdateSchema.parse(req.body), metadata(req)) })));
billingSchedulesRouter.get('/:id/preview', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Schedule approval preview retrieved', await repository.preview(getFirmId(req), actor(req), scheduleIdSchema.parse(req.params).id))));
billingSchedulesRouter.post('/:id/approve', asyncHandler(async (req, res) => { const input = scheduleApproveSchema.parse(req.body); return sendSuccess(res, 200, 'Schedule approved', { schedule: await repository.approve(getFirmId(req), actor(req), scheduleIdSchema.parse(req.params).id, input.expectedVersion, input.previewToken, metadata(req)) }); }));
for (const action of ['pause', 'cancel'] as const) billingSchedulesRouter.post(`/:id/${action}`, asyncHandler(async (req, res) => sendSuccess(res, 200, 'Schedule stopped', { schedule: await repository.stop(getFirmId(req), actor(req), scheduleIdSchema.parse(req.params).id, scheduleVersionSchema.parse(req.body).expectedVersion, action === 'pause' ? 'PAUSED' : 'CANCELLED', metadata(req)) })));
billingSchedulesRouter.post('/:id/runs/:runId/retry', asyncHandler(async (req, res) => { const ids = scheduleIdSchema.parse(req.params); return sendSuccess(res, 200, 'Billing period requeued', await repository.retry(getFirmId(req), actor(req), ids.id, ids.runId!, scheduleRetrySchema.parse(req.body).expectedRetryCount, metadata(req))); }));
