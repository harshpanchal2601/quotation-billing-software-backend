import { Router, type Request } from 'express';
import { z } from 'zod';
import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { paymentCapabilities } from './payment-links.js';
import { paymentsRepository } from './payments.repository.js';
import { receivablesRepository } from './receivables.repository.js';
import { allocatePaymentSchema, paymentIdSchema, paymentListSchema, receivablesQuerySchema, recordPaymentSchema, refundPaymentSchema, reversePaymentSchema } from './payments.schema.js';

function actor(req: Request) { if (!req.user) throw new AppError('Authentication required', 401); return req.user.id; }
function metadata(req: Request) { return { firmId: getFirmId(req), userId: actor(req), ipAddress: req.ip, userAgent: req.get('user-agent') }; }
export const paymentsRouter = Router();
paymentsRouter.use(requireAuthentication, requireFirmContext);
paymentsRouter.get('/capabilities', requirePermission(PERMISSIONS.PAYMENTS_VIEW), (_req, res) => sendSuccess(res, 200, 'Payment capabilities retrieved', paymentCapabilities));
paymentsRouter.get('/options/customers', requirePermission(PERMISSIONS.PAYMENTS_RECORD), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Payment customers retrieved', { customers: await paymentsRepository.customers(getFirmId(req), actor(req), z.string().trim().max(191).default('').parse(req.query.search)) })));
paymentsRouter.get('/', requirePermission(PERMISSIONS.PAYMENTS_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Payments retrieved', await paymentsRepository.list(getFirmId(req), actor(req), paymentListSchema.parse(req.query)))));
paymentsRouter.post('/', requirePermission(PERMISSIONS.PAYMENTS_RECORD), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Confirmed receipt recorded', { payment: await paymentsRepository.record(getFirmId(req), actor(req), recordPaymentSchema.parse(req.body), metadata(req)) })));
paymentsRouter.get('/:id', requirePermission(PERMISSIONS.PAYMENTS_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Payment retrieved', { payment: await paymentsRepository.get(getFirmId(req), actor(req), paymentIdSchema.parse(req.params).id) })));
paymentsRouter.post('/:id/allocate', requirePermission(PERMISSIONS.PAYMENTS_RECORD), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Receipt allocated', { payment: await paymentsRepository.allocate(getFirmId(req), actor(req), paymentIdSchema.parse(req.params).id, allocatePaymentSchema.parse(req.body), metadata(req)) })));
paymentsRouter.post('/:id/reverse', requirePermission(PERMISSIONS.PAYMENTS_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Receipt reversed', { payment: await paymentsRepository.reverse(getFirmId(req), actor(req), paymentIdSchema.parse(req.params).id, reversePaymentSchema.parse(req.body), metadata(req)) })));
paymentsRouter.post('/:id/refunds', requirePermission(PERMISSIONS.PAYMENTS_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Confirmed external refund recorded', { payment: await paymentsRepository.refund(getFirmId(req), actor(req), paymentIdSchema.parse(req.params).id, refundPaymentSchema.parse(req.body), metadata(req)) })));
export const receivablesRouter = Router();
receivablesRouter.use(requireAuthentication, requireFirmContext, requirePermission(PERMISSIONS.PAYMENTS_VIEW));
receivablesRouter.get('/aging', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Receivables retrieved', await receivablesRepository.aging(getFirmId(req), actor(req), receivablesQuerySchema.parse(req.query)))));
receivablesRouter.get('/invoices/:id', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Invoice settlement retrieved', await receivablesRepository.invoice(getFirmId(req), actor(req), paymentIdSchema.parse(req.params).id))));
