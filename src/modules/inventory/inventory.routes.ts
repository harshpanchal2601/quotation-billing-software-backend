import { Router, type Request } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { AppError } from '../../core/errors/AppError.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { inventoryRepository as repository } from './inventory.repository.js';
import { inventoryIdSchema, inventoryListSchema, reorderSchema, stockAdjustmentSchema, stockReleaseSchema, stockReservationSchema, stockReturnSchema, stockTransferSchema, warehouseSchema, warehouseSearchSchema } from './inventory.schema.js';

function actor(req: Request) { if (!req.user) throw new AppError('Authentication required', 401); return req.user.id; }
function metadata(req: Request) { return { firmId: getFirmId(req), userId: actor(req), ipAddress: req.ip, userAgent: req.get('user-agent') }; }
export const warehousesRouter = Router();
warehousesRouter.use(requireAuthentication, requireFirmContext);
warehousesRouter.get('/', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Warehouses retrieved', await repository.warehouses(getFirmId(req), actor(req), warehouseSearchSchema.parse(req.query).search))));
warehousesRouter.post('/', requirePermission(PERMISSIONS.INVENTORY_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Warehouse created', { warehouse: await repository.createWarehouse(getFirmId(req), actor(req), warehouseSchema.parse(req.body), metadata(req)) })));
export const stockRouter = Router();
stockRouter.use(requireAuthentication, requireFirmContext);
stockRouter.get('/reference-options', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Inventory options retrieved', await repository.options(getFirmId(req), actor(req), z.string().trim().max(191).default('').parse(req.query.search)))));
stockRouter.get('/availability', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Stock retrieved', await repository.positions(getFirmId(req), actor(req), inventoryListSchema.parse(req.query)))));
stockRouter.get('/reports', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Stock report retrieved', await repository.positions(getFirmId(req), actor(req), inventoryListSchema.parse(req.query)))));
stockRouter.get('/movements', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Stock movements retrieved', await repository.movements(getFirmId(req), actor(req), inventoryListSchema.parse(req.query)))));
stockRouter.get('/reservations', requirePermission(PERMISSIONS.INVENTORY_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Stock reservations retrieved', await repository.reservations(getFirmId(req), actor(req), inventoryListSchema.parse(req.query)))));
stockRouter.post('/adjustments', requirePermission(PERMISSIONS.STOCK_ADJUST), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Stock adjusted', { operation: await repository.adjust(getFirmId(req), actor(req), stockAdjustmentSchema.parse(req.body), metadata(req)) })));
stockRouter.post('/transfers', requirePermission(PERMISSIONS.INVENTORY_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Stock transferred', { operation: await repository.transfer(getFirmId(req), actor(req), stockTransferSchema.parse(req.body), metadata(req)) })));
stockRouter.post('/returns', requirePermission(PERMISSIONS.INVENTORY_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Customer return recorded', { operation: await repository.customerReturn(getFirmId(req), actor(req), stockReturnSchema.parse(req.body), metadata(req)) })));
stockRouter.post('/reservations', requirePermission(PERMISSIONS.INVENTORY_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Stock reserved', { reservation: await repository.reserve(getFirmId(req), actor(req), stockReservationSchema.parse(req.body), metadata(req)) })));
stockRouter.post('/reservations/:id/release', requirePermission(PERMISSIONS.INVENTORY_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Stock released', { reservation: await repository.release(getFirmId(req), actor(req), inventoryIdSchema.parse(req.params).id, stockReleaseSchema.parse(req.body).reason, metadata(req)) })));
stockRouter.put('/reorder-level', requirePermission(PERMISSIONS.INVENTORY_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Stock threshold saved', { position: await repository.reorder(getFirmId(req), actor(req), reorderSchema.parse(req.body), metadata(req)) })));
