import { Router, type Request } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { AppError } from '../../core/errors/AppError.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { purchasingRepository as repository } from './purchasing.repository.js';
import { expenseSchema, goodsReceiptSchema, purchaseIdSchema, purchaseListSchema, purchaseOrderSchema, purchaseTransitionSchema, receiptReturnSchema, supplierBillSchema } from './purchasing.schema.js';

function actor(req: Request) { if (!req.user) throw new AppError('Authentication required', 401); return req.user.id; }
function metadata(req: Request) { return { firmId: getFirmId(req), userId: actor(req), ipAddress: req.ip, userAgent: req.get('user-agent') }; }
export const purchaseOrdersRouter = Router();
export const goodsReceiptsRouter = Router();
export const supplierBillsRouter = Router();
export const expensesRouter = Router();
for (const router of [purchaseOrdersRouter, goodsReceiptsRouter, supplierBillsRouter, expensesRouter]) router.use(requireAuthentication, requireFirmContext);
for (const [router, scope, permission] of [[purchaseOrdersRouter, 'purchasing', PERMISSIONS.PURCHASING_VIEW], [supplierBillsRouter, 'bills', PERMISSIONS.SUPPLIER_BILLS_VIEW], [expensesRouter, 'expenses', PERMISSIONS.EXPENSES_VIEW]] as const) router.get('/reference-options', requirePermission(permission), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Purchasing options retrieved', await repository.options(getFirmId(req), actor(req), scope, z.string().trim().max(191).default('').parse(req.query.search), z.string().trim().max(191).default('').parse(req.query.warehouseSearch)))));
for (const [router, kind, permission] of [[purchaseOrdersRouter, 'orders', PERMISSIONS.PURCHASING_VIEW], [goodsReceiptsRouter, 'receipts', PERMISSIONS.PURCHASING_VIEW], [supplierBillsRouter, 'bills', PERMISSIONS.SUPPLIER_BILLS_VIEW], [expensesRouter, 'expenses', PERMISSIONS.EXPENSES_VIEW]] as const) {
  router.get('/', requirePermission(permission), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Purchasing documents retrieved', await repository.list(getFirmId(req), actor(req), kind, purchaseListSchema.parse(req.query)))));
  router.get('/:id', requirePermission(permission), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Purchasing document retrieved', { record: await repository.get(getFirmId(req), actor(req), kind, purchaseIdSchema.parse(req.params).id) })));
}
purchaseOrdersRouter.post('/', requirePermission(PERMISSIONS.PURCHASING_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Purchase order created', { record: await repository.createOrder(getFirmId(req), actor(req), purchaseOrderSchema.parse(req.body), metadata(req)) })));
for (const action of ['approve', 'cancel'] as const) purchaseOrdersRouter.post(`/:id/${action}`, requirePermission(action === 'approve' ? PERMISSIONS.PURCHASING_APPROVE : PERMISSIONS.PURCHASING_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Purchase order updated', { record: await repository.transitionOrder(getFirmId(req), actor(req), purchaseIdSchema.parse(req.params).id, action, purchaseTransitionSchema.parse(req.body), metadata(req)) })));
goodsReceiptsRouter.post('/', requirePermission(PERMISSIONS.PURCHASING_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Goods received', { record: await repository.receive(getFirmId(req), actor(req), goodsReceiptSchema.parse(req.body), metadata(req)) })));
goodsReceiptsRouter.post('/:id/returns', requirePermission(PERMISSIONS.PURCHASING_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Supplier return recorded', { record: await repository.returnReceipt(getFirmId(req), actor(req), purchaseIdSchema.parse(req.params).id, receiptReturnSchema.parse(req.body), metadata(req)) })));
goodsReceiptsRouter.get('/:id/returns', requirePermission(PERMISSIONS.PURCHASING_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Supplier returns retrieved', await repository.receiptReturns(getFirmId(req), actor(req), purchaseIdSchema.parse(req.params).id, purchaseListSchema.parse(req.query)))));
goodsReceiptsRouter.post('/:id/cancel', requirePermission(PERMISSIONS.PURCHASING_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Receipt cancelled', { record: await repository.cancelReceipt(getFirmId(req), actor(req), purchaseIdSchema.parse(req.params).id, purchaseTransitionSchema.parse(req.body), metadata(req)) })));
supplierBillsRouter.post('/', requirePermission(PERMISSIONS.SUPPLIER_BILLS_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Supplier bill draft created', { record: await repository.createBill(getFirmId(req), actor(req), supplierBillSchema.parse(req.body), metadata(req)) })));
for (const action of ['post', 'void'] as const) supplierBillsRouter.post(`/:id/${action}`, requirePermission(PERMISSIONS.SUPPLIER_BILLS_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Supplier bill updated', { record: await repository.transitionBill(getFirmId(req), actor(req), purchaseIdSchema.parse(req.params).id, action, purchaseTransitionSchema.parse(req.body), metadata(req)) })));
expensesRouter.post('/', requirePermission(PERMISSIONS.EXPENSES_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Expense recorded', { record: await repository.createExpense(getFirmId(req), actor(req), expenseSchema.parse(req.body), metadata(req)) })));
expensesRouter.post('/:id/void', requirePermission(PERMISSIONS.EXPENSES_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Expense cancelled', { record: await repository.voidExpense(getFirmId(req), actor(req), purchaseIdSchema.parse(req.params).id, z.object({ reason: z.string().trim().min(5).max(2000) }).strict().parse(req.body).reason, metadata(req)) })));
