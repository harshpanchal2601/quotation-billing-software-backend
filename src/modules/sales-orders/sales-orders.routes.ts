import { Router, type Request } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { AppError } from '../../core/errors/AppError.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { salesOrdersRepository } from './sales-orders.repository.js';
import { cancelSalesSchema, fulfillmentSchema, orderConversionSchema, salesIdSchema, salesListSchema } from './sales-orders.schema.js';
function actor(req: Request) { if (!req.user) throw new AppError('Authentication required', 401); return req.user.id; }
function metadata(req: Request) { return { firmId: getFirmId(req), userId: actor(req), ipAddress: req.ip, userAgent: req.get('user-agent') }; }
export const salesOrdersRouter = Router();
salesOrdersRouter.use(requireAuthentication, requireFirmContext);
salesOrdersRouter.get('/', requirePermission(PERMISSIONS.SALES_ORDERS_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Sales orders retrieved', await salesOrdersRepository.list(getFirmId(req), actor(req), salesListSchema.parse(req.query)))));
salesOrdersRouter.post('/from-quotation', requirePermission(PERMISSIONS.SALES_ORDERS_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Sales order created', { order: await salesOrdersRepository.convert(getFirmId(req), actor(req), orderConversionSchema.parse(req.body), metadata(req)) })));
salesOrdersRouter.get('/:id', requirePermission(PERMISSIONS.SALES_ORDERS_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Sales order retrieved', { order: await salesOrdersRepository.get(getFirmId(req), actor(req), salesIdSchema.parse(req.params).id, z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.historyPage)) })));
salesOrdersRouter.post('/:id/cancel', requirePermission(PERMISSIONS.SALES_ORDERS_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Sales order cancelled', { order: await salesOrdersRepository.cancel(getFirmId(req), actor(req), salesIdSchema.parse(req.params).id, cancelSalesSchema.parse(req.body), metadata(req)) })));
export const fulfillmentsRouter = Router();
fulfillmentsRouter.use(requireAuthentication, requireFirmContext, requirePermission(PERMISSIONS.FULFILLMENTS_MANAGE));
fulfillmentsRouter.get('/warehouse-options', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Dispatch warehouses retrieved', await salesOrdersRepository.fulfillmentWarehouses(getFirmId(req), actor(req), z.string().trim().max(191).default('').parse(req.query.search)))));
fulfillmentsRouter.post('/', asyncHandler(async (req, res) => sendSuccess(res, 201, 'Completion recorded', { order: await salesOrdersRepository.fulfill(getFirmId(req), actor(req), fulfillmentSchema.parse(req.body), metadata(req)) })));
fulfillmentsRouter.post('/:id/cancel', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Completion cancelled', { order: await salesOrdersRepository.cancelFulfillment(getFirmId(req), actor(req), salesIdSchema.parse(req.params).id, cancelSalesSchema.parse(req.body), metadata(req)) })));
