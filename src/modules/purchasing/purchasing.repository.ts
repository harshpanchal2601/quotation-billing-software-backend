import { AuditAction, Prisma, type PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { decimal } from '../../core/money/index.js';
import { reserveDocumentSequence } from '../../core/sequences/index.js';
import { jsonObject } from '../../core/serialization/json.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS, type Permission } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction, type FeatureKey } from '../entitlements/index.js';
import { postStock, postReturnedStock, trackedItem } from '../inventory/index.js';
import { resolveBusinessPolicy } from '../settings/index.js';
import { calculatePurchase, purchasePolicyFromSnapshot } from './purchase-calculations.js';
import type { expenseSchema, goodsReceiptSchema, purchaseListSchema, purchaseOrderSchema, purchaseTransitionSchema, receiptReturnSchema, supplierBillSchema } from './purchasing.schema.js';

type Query = z.infer<typeof purchaseListSchema>;
type Transition = z.infer<typeof purchaseTransitionSchema>;
const paging = (query: Query) => ({ take: query.limit, skip: (query.page - 1) * query.limit });
const orderInclude = { lines: { orderBy: { lineNumber: 'asc' as const } } };
const billInclude = { lines: { orderBy: { lineNumber: 'asc' as const } } };

async function audit(tx: Prisma.TransactionClient, firmId: number, actorId: number, entityType: string, row: { id: number }, values: unknown, metadata: RequestMetadata) {
  await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType, entityId: String(row.id), action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: jsonObject(values) });
}
async function supplier(tx: Prisma.TransactionClient, firmId: number, id: number) {
  const row = await tx.company.findFirst({ where: { id, firmId, isSupplier: true, isActive: true, deletedAt: null } });
  if (!row) throw new AppError('Supplier unavailable', 404);
  return row;
}
async function refreshOrder(tx: Prisma.TransactionClient, firmId: number, id: number) {
  const row = await tx.purchaseOrder.findFirst({ where: { id, firmId }, include: orderInclude });
  if (!row) throw new AppError('Purchase order unavailable', 404);
  const status = row.status === 'CANCELLED' ? 'CANCELLED' : row.lines.every((line) => line.receivedQuantity.eq(line.quantity)) ? 'RECEIVED' : row.lines.some((line) => line.receivedQuantity.gt(0)) ? 'PARTIALLY_RECEIVED' : 'APPROVED';
  return tx.purchaseOrder.update({ where: { id }, data: { status, version: { increment: 1 } }, include: orderInclude });
}

export class PurchasingRepository {
  constructor(private readonly db: PrismaClient) {}
  private async access(tx: Prisma.TransactionClient, firmId: number, actorId: number, permission: Permission, feature: FeatureKey) { await authorizeFirmJobActor(tx, firmId, actorId, permission); await assertTransactionFeature(tx, firmId, feature); }
  async options(firmId: number, actorId: number, scope: 'purchasing' | 'bills' | 'expenses', search: string, warehouseSearch = '') {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId, scope === 'expenses' ? PERMISSIONS.EXPENSES_VIEW : scope === 'bills' ? PERMISSIONS.SUPPLIER_BILLS_VIEW : PERMISSIONS.PURCHASING_VIEW, scope === 'expenses' ? 'expenses' : scope === 'bills' ? 'purchasing.bills' : 'purchasing');
      const financial = await resolveBusinessPolicy(tx, firmId);
      let warehouses: Array<{ id: number; name: string }> = [];
      if (scope === 'purchasing') {
        try { await assertTransactionFeature(tx, firmId, 'inventory'); warehouses = await tx.warehouse.findMany({ where: { firmId, isActive: true, OR: [{ name: { contains: warehouseSearch } }, { code: { contains: warehouseSearch } }] }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 100 }); }
        catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error; }
      }
      const receiptLines = scope === 'bills' ? await tx.goodsReceiptLine.findMany({ where: { firmId, receipt: { cancelledAt: null }, OR: [{ receipt: { reference: { contains: search } } }, { orderLine: { order: { supplier: { name: { contains: search } } } } }, { orderLine: { item: { name: { contains: search } } } }] }, include: { receipt: { select: { reference: true } }, orderLine: { include: { order: { select: { supplierId: true, currency: true, financialSnapshot: true } } } } }, orderBy: { id: 'desc' }, take: 100 }) : [];
      return { warehouses, receiptLines: receiptLines.map((line) => ({ id: line.id, purchaseOrderLineId: line.purchaseOrderLineId, supplierId: line.orderLine.order.supplierId, currency: line.orderLine.order.currency, taxMode: String(jsonObject(line.orderLine.order.financialSnapshot).taxMode), reference: line.receipt.reference, quantity: line.quantity.sub(line.returnedQuantity).toFixed(3), unitCost: line.orderLine.unitCost.toString(), taxRate: String(jsonObject(line.orderLine.snapshot).taxRate), description: String(jsonObject(line.orderLine.snapshot).description) })), suppliers: await tx.company.findMany({ where: { firmId, isSupplier: true, isActive: true, deletedAt: null, name: { contains: search } }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 100 }), items: scope === 'purchasing' ? await tx.item.findMany({ where: { firmId, isActive: true, deletedAt: null, name: { contains: search } }, select: { id: true, name: true, kind: true, stockTracking: true, measurementUnit: { select: { symbol: true, allowDecimal: true } } }, orderBy: { name: 'asc' }, take: 100 }) : [], financial };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async list(firmId: number, actorId: number, kind: 'orders' | 'receipts' | 'bills' | 'expenses', query: Query) {
    return this.db.$transaction(async (tx) => {
      const permission = kind === 'bills' ? PERMISSIONS.SUPPLIER_BILLS_VIEW : kind === 'expenses' ? PERMISSIONS.EXPENSES_VIEW : PERMISSIONS.PURCHASING_VIEW;
      await this.access(tx, firmId, actorId, permission, kind === 'bills' ? 'purchasing.bills' : kind === 'expenses' ? 'expenses' : 'purchasing');
      const period = { gte: query.from ? new Date(`${query.from}T00:00:00Z`) : undefined, lte: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined };
      if (kind === 'orders') {
        const where: Prisma.PurchaseOrderWhereInput = { firmId, supplierId: query.supplierId, createdAt: period };
        return { records: await tx.purchaseOrder.findMany({ where, ...paging(query), orderBy: { id: 'desc' }, include: { supplier: { select: { name: true } } } }), pagination: { page: query.page, limit: query.limit, total: await tx.purchaseOrder.count({ where }) } };
      }
      if (kind === 'receipts') {
        const where: Prisma.GoodsReceiptWhereInput = { firmId, order: { firmId, supplierId: query.supplierId }, createdAt: period };
        return { records: await tx.goodsReceipt.findMany({ where, ...paging(query), orderBy: { id: 'desc' }, include: { lines: true } }), pagination: { page: query.page, limit: query.limit, total: await tx.goodsReceipt.count({ where }) } };
      }
      if (kind === 'bills') {
        const where: Prisma.SupplierBillWhereInput = { firmId, supplierId: query.supplierId, billDate: period };
        return { records: await tx.supplierBill.findMany({ where, ...paging(query), orderBy: { id: 'desc' }, include: { supplier: { select: { name: true } } } }), pagination: { page: query.page, limit: query.limit, total: await tx.supplierBill.count({ where }) }, totals: await tx.supplierBill.groupBy({ by: ['currency'], where: { ...where, status: 'POSTED' }, _sum: { total: true } }) };
      }
      const where: Prisma.ExpenseWhereInput = { firmId, supplierId: query.supplierId, expenseDate: period };
      return { records: await tx.expense.findMany({ where, ...paging(query), orderBy: { id: 'desc' } }), pagination: { page: query.page, limit: query.limit, total: await tx.expense.count({ where }) }, totals: await tx.expense.groupBy({ by: ['currency', 'category'], where: { ...where, status: 'POSTED' }, _sum: { total: true } }) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async get(firmId: number, actorId: number, kind: 'orders' | 'receipts' | 'bills' | 'expenses', id: number) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId, kind === 'bills' ? PERMISSIONS.SUPPLIER_BILLS_VIEW : kind === 'expenses' ? PERMISSIONS.EXPENSES_VIEW : PERMISSIONS.PURCHASING_VIEW, kind === 'bills' ? 'purchasing.bills' : kind === 'expenses' ? 'expenses' : 'purchasing');
      const row = kind === 'orders' ? await tx.purchaseOrder.findFirst({ where: { id, firmId }, include: orderInclude }) : kind === 'receipts' ? await tx.goodsReceipt.findFirst({ where: { id, firmId }, include: { lines: true } }) : kind === 'bills' ? await tx.supplierBill.findFirst({ where: { id, firmId }, include: billInclude }) : await tx.expense.findFirst({ where: { id, firmId } });
      if (!row) throw new AppError('Purchasing document not found', 404); return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async createOrder(firmId: number, actorId: number, input: z.infer<typeof purchaseOrderSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.PURCHASING_MANAGE, 'purchasing');
      const hash = requestHash(input);
      const replay = await tx.purchaseOrder.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } }, include: orderInclude });
      if (replay) { if (replay.requestHash !== hash) throw new AppError('Purchase order idempotency conflict', 409); return replay; }
      const vendor = await supplier(tx, firmId, input.supplierId);
      const items = await tx.item.findMany({ where: { id: { in: input.lines.map((line) => line.itemId) }, firmId, isActive: true, deletedAt: null }, include: { measurementUnit: true } });
      const financial = calculatePurchase(input.lines, await resolveBusinessPolicy(tx, firmId), input.taxMode);
      const lines = financial.lines.map((line) => {
        const item = items.find((entry) => entry.id === line.itemId);
        if (!item || item.measurementUnit.firmId !== firmId || item.measurementUnit.deletedAt || !item.measurementUnit.isActive) throw new AppError('Purchase item or unit unavailable', 404);
        if (!item.measurementUnit.allowDecimal && !decimal(line.quantity).isInteger()) throw new AppError('Item requires whole quantities', 400);
        return { itemId: item.id, lineNumber: line.lineNumber, quantity: decimal(line.quantity), unitCost: decimal(line.unitCost), snapshot: jsonObject({ ...line, itemId: item.id, itemName: item.name, itemCode: item.itemCode, kind: item.kind, stockTracking: item.stockTracking, allowDecimal: item.measurementUnit.allowDecimal, measurementUnit: item.measurementUnit.symbol }) };
      });
      if (items.some((item) => item.stockTracking)) await assertTransactionFeature(tx, firmId, 'inventory');
      const sequence = await reserveDocumentSequence(tx, { firmId, documentType: 'PURCHASE_ORDER', period: 'ALL' });
      const row = await tx.purchaseOrder.create({ data: { firmId, supplierId: vendor.id, orderNumber: `PO-${String(sequence).padStart(6, '0')}`, expectedDate: input.expectedDate ? new Date(input.expectedDate) : null, currency: financial.currency, supplierSnapshot: jsonObject({ id: vendor.id, name: vendor.name, legalName: vendor.legalName, gstin: vendor.gstin }), financialSnapshot: jsonObject(financial), total: decimal(financial.total), actorId, idempotencyKey: input.idempotencyKey, requestHash: hash, lines: { create: lines } }, include: orderInclude });
      await audit(tx, firmId, actorId, 'PurchaseOrder', row, row, metadata); return row;
    });
  }
  async transitionOrder(firmId: number, actorId: number, id: number, action: 'approve' | 'cancel', input: Transition, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, action === 'approve' ? PERMISSIONS.PURCHASING_APPROVE : PERMISSIONS.PURCHASING_MANAGE, 'purchasing');
      const row = await tx.purchaseOrder.findFirst({ where: { id, firmId }, include: orderInclude });
      if (!row) throw new AppError('Purchase order not found', 404);
      if (action === 'cancel' && row.status === 'CANCELLED' && row.cancellationReason === input.reason) return row;
      if (action === 'approve' && row.status === 'APPROVED' && row.version === input.expectedVersion + 1) return row;
      if (row.version !== input.expectedVersion) throw new AppError('Purchase order changed; reload', 409);
      if (action === 'approve' && row.status !== 'DRAFT' || action === 'cancel' && ['CANCELLED', 'RECEIVED'].includes(row.status)) throw new AppError('Purchase order transition is unavailable', 409);
      if (action === 'approve') await supplier(tx, firmId, row.supplierId);
      const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: action === 'approve' ? 'APPROVED' : 'CANCELLED', version: { increment: 1 }, cancellationReason: action === 'cancel' ? input.reason : null }, include: orderInclude });
      await audit(tx, firmId, actorId, 'PurchaseOrder', updated, { ...updated, reason: input.reason }, metadata); return updated;
    });
  }
  async receive(firmId: number, actorId: number, input: z.infer<typeof goodsReceiptSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.PURCHASING_MANAGE, 'purchasing');
      const hash = requestHash(input);
      const replay = await tx.goodsReceipt.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } }, include: { lines: true } });
      if (replay) { if (replay.requestHash !== hash) throw new AppError('Receipt idempotency conflict', 409); return replay; }
      const order = await tx.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, firmId }, include: orderInclude });
      if (!order) throw new AppError('Purchase order not found', 404);
      if (order.version !== input.expectedVersion || !['APPROVED', 'PARTIALLY_RECEIVED'].includes(order.status)) throw new AppError('Purchase order changed or is not receivable', 409);
      if (input.warehouseId) { await assertTransactionFeature(tx, firmId, 'inventory'); if (!await tx.warehouse.findFirst({ where: { id: input.warehouseId, firmId, isActive: true } })) throw new AppError('Warehouse unavailable', 404); }
      for (const line of input.lines) {
        const source = order.lines.find((entry) => entry.id === line.purchaseOrderLineId);
        if (!source) throw new AppError('Purchase line unavailable', 404);
        if (source.receivedQuantity.add(decimal(line.quantity)).gt(source.quantity)) throw new AppError('Receipt exceeds outstanding purchase quantity', 409);
        const snapshot = jsonObject(source.snapshot);
        if (snapshot.allowDecimal === false && !decimal(line.quantity).isInteger()) throw new AppError('Receipt unit requires whole quantities', 400);
        if (trackedItem(source.snapshot) && !input.warehouseId) throw new AppError('Tracked goods require an explicit warehouse', 400);
      }
      const row = await tx.goodsReceipt.create({ data: { firmId, purchaseOrderId: order.id, warehouseId: input.warehouseId, reference: input.reference, actorId, idempotencyKey: input.idempotencyKey, requestHash: hash, lines: { create: input.lines.map((line) => ({ purchaseOrderLineId: line.purchaseOrderLineId, quantity: decimal(line.quantity) })) } }, include: { lines: true } });
      for (const line of row.lines) {
        const source = order.lines.find((entry) => entry.id === line.purchaseOrderLineId)!;
        if (trackedItem(source.snapshot)) await postStock(tx, { firmId, actorId, warehouseId: input.warehouseId!, itemId: source.itemId, currency: order.currency, quantity: decimal(line.quantity), inboundValue: decimal(line.quantity).mul(decimal(source.unitCost)), sourceType: 'RECEIPT', sourceId: row.id, sourceLineId: line.id, eventType: 'RECEIVE', reason: `Purchase receipt: ${input.reference}` });
        await tx.purchaseOrderLine.update({ where: { id: source.id }, data: { receivedQuantity: { increment: line.quantity } } });
      }
      await refreshOrder(tx, firmId, order.id); await audit(tx, firmId, actorId, 'GoodsReceipt', row, row, metadata); return row;
    });
  }
  async receiptReturns(firmId: number, actorId: number, id: number, query: Query) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.PURCHASING_VIEW, 'purchasing');
      if (!await tx.goodsReceipt.findFirst({ where: { id, firmId }, select: { id: true } })) throw new AppError('Receipt not found', 404);
      const where = { firmId, line: { goodsReceiptId: id, firmId } };
      return { records: await tx.goodsReceiptReturn.findMany({ where, ...paging(query), orderBy: { id: 'desc' } }), pagination: { page: query.page, limit: query.limit, total: await tx.goodsReceiptReturn.count({ where }) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async returnReceipt(firmId: number, actorId: number, id: number, input: z.infer<typeof receiptReturnSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.PURCHASING_MANAGE, 'purchasing');
      const hash = requestHash({ receiptId: id, ...input });
      const replay = await tx.goodsReceiptReturn.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } } });
      if (replay) { if (replay.requestHash !== hash) throw new AppError('Receipt return idempotency conflict', 409); return replay; }
      const line = await tx.goodsReceiptLine.findFirst({ where: { id: input.receiptLineId, firmId, goodsReceiptId: id }, include: { receipt: true, orderLine: true } });
      if (!line || line.receipt.cancelledAt) throw new AppError('Receipt line unavailable', 404);
      const quantity = decimal(input.quantity);
      if (quantity.gt(line.quantity.sub(line.returnedQuantity))) throw new AppError('Return exceeds the net received quantity', 409);
      if (jsonObject(line.orderLine.snapshot).allowDecimal === false && !quantity.isInteger()) throw new AppError('Return unit requires whole quantities', 400);
      if (await tx.supplierBillLine.findFirst({ where: { firmId, OR: [{ goodsReceiptLineId: line.id }, { purchaseOrderLineId: line.purchaseOrderLineId }], bill: { status: 'POSTED' } } })) throw new AppError('Correct or void the matched supplier bill before returning billed goods', 409);
      const row = await tx.goodsReceiptReturn.create({ data: { firmId, actorId, receiptLineId: line.id, quantity, reason: input.reason, idempotencyKey: input.idempotencyKey, requestHash: hash } });
      if (trackedItem(line.orderLine.snapshot)) {
        const original = await tx.stockMovement.findFirst({ where: { firmId, sourceType: 'RECEIPT', sourceId: id, sourceLineId: line.id, eventType: 'RECEIVE' } });
        if (!original) throw new AppError('Original receipt stock posting is unavailable', 409);
        await postReturnedStock(tx, { firmId, actorId, originalMovementId: original.id, originalSource: 'RECEIPT', quantity, sourceType: 'RECEIPT_RETURN', sourceId: row.id, sourceLineId: line.id, reason: input.reason });
      }
      await tx.goodsReceiptLine.update({ where: { id: line.id }, data: { returnedQuantity: { increment: quantity } } });
      await tx.purchaseOrderLine.update({ where: { id: line.purchaseOrderLineId }, data: { receivedQuantity: { decrement: quantity } } });
      await refreshOrder(tx, firmId, line.receipt.purchaseOrderId);
      await audit(tx, firmId, actorId, 'GoodsReceiptReturn', row, row, metadata); return row;
    });
  }
  async cancelReceipt(firmId: number, actorId: number, id: number, input: Transition, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.PURCHASING_MANAGE, 'purchasing');
      const row = await tx.goodsReceipt.findFirst({ where: { id, firmId }, include: { lines: true, order: true } });
      if (!row) throw new AppError('Receipt not found', 404);
      if (row.cancelledAt) { if (row.cancellationReason !== input.reason) throw new AppError('Receipt already cancelled', 409); return row; }
      if (row.order.version !== input.expectedVersion) throw new AppError('Purchase order changed; reload', 409);
      for (const line of row.lines) {
        if (!line.returnedQuantity.isZero() || await tx.supplierBillLine.findFirst({ where: { firmId, OR: [{ goodsReceiptLineId: line.id }, { purchaseOrderLineId: line.purchaseOrderLineId }], bill: { status: 'POSTED' } } })) throw new AppError('Returned or billed receipt cannot be cancelled; correct the linked documents first', 409);
        const original = await tx.stockMovement.findFirst({ where: { firmId, sourceType: 'RECEIPT', sourceId: row.id, sourceLineId: line.id, eventType: 'RECEIVE' }, include: { position: true } });
        if (original) await postStock(tx, { firmId, actorId, warehouseId: original.position.warehouseId, itemId: original.position.itemId, quantity: original.quantity.neg(), reversalValue: original.value.neg(), sourceType: 'RECEIPT', sourceId: row.id, sourceLineId: line.id, eventType: 'RECEIPT_REVERSAL', originalMovementId: original.id, reason: input.reason });
        await tx.purchaseOrderLine.update({ where: { id: line.purchaseOrderLineId }, data: { receivedQuantity: { decrement: line.quantity } } });
      }
      const updated = await tx.goodsReceipt.update({ where: { id }, data: { cancelledAt: new Date(), cancellationReason: input.reason }, include: { lines: true } });
      await refreshOrder(tx, firmId, row.purchaseOrderId); await audit(tx, firmId, actorId, 'GoodsReceipt', updated, updated, metadata); return updated;
    });
  }
  async createBill(firmId: number, actorId: number, input: z.infer<typeof supplierBillSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.SUPPLIER_BILLS_MANAGE, 'purchasing.bills');
      const hash = requestHash(input);
      const replay = await tx.supplierBill.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } }, include: billInclude });
      if (replay) { if (replay.requestHash !== hash) throw new AppError('Supplier bill idempotency conflict', 409); return replay; }
      const vendor = await supplier(tx, firmId, input.supplierId);
      if (await tx.expense.findFirst({ where: { firmId, supplierId: vendor.id, reference: input.supplierReference, status: 'POSTED' } })) throw new AppError('Supplier reference is already recorded as an expense', 409);
      const sources = await tx.purchaseOrder.findMany({ where: { firmId, lines: { some: { OR: [{ id: { in: input.lines.flatMap((line) => line.purchaseOrderLineId ? [line.purchaseOrderLineId] : []) } }, { receiptLines: { some: { id: { in: input.lines.flatMap((line) => line.goodsReceiptLineId ? [line.goodsReceiptLineId] : []) } } } }] } } } });
      const approvedPolicy = sources.length ? purchasePolicyFromSnapshot(sources[0]!.financialSnapshot) : await resolveBusinessPolicy(tx, firmId);
      if (sources.some((source) => requestHash(purchasePolicyFromSnapshot(source.financialSnapshot).policy) !== requestHash(approvedPolicy.policy))) throw new AppError('Matched purchases use different financial policies; create separate supplier bills', 409);
      const financial = calculatePurchase(input.lines, approvedPolicy, input.taxMode);
      const row = await tx.supplierBill.create({ data: { firmId, supplierId: vendor.id, supplierReference: input.supplierReference, billDate: new Date(input.billDate), dueDate: input.dueDate ? new Date(input.dueDate) : null, currency: financial.currency, supplierSnapshot: jsonObject({ id: vendor.id, name: vendor.name, gstin: vendor.gstin }), financialSnapshot: jsonObject(financial), total: decimal(financial.total), actorId, idempotencyKey: input.idempotencyKey, requestHash: hash, lines: { create: financial.lines.map((line) => ({ lineNumber: line.lineNumber, purchaseOrderLineId: line.purchaseOrderLineId, goodsReceiptLineId: line.goodsReceiptLineId, quantity: decimal(line.quantity), snapshot: jsonObject(line) })) } }, include: billInclude });
      await this.validateBillMatches(tx, firmId, row);
      const normalized = await tx.supplierBill.findFirstOrThrow({ where: { id: row.id, firmId }, include: billInclude });
      await audit(tx, firmId, actorId, 'SupplierBill', normalized, normalized, metadata); return normalized;
    });
  }
  private async validateBillMatches(tx: Prisma.TransactionClient, firmId: number, bill: Prisma.SupplierBillGetPayload<{ include: typeof billInclude }>) {
    const local = new Map<number, Prisma.Decimal>();
    for (const line of bill.lines) {
      let orderLineId = line.purchaseOrderLineId;
      if (line.goodsReceiptLineId) {
        const receipt = await tx.goodsReceiptLine.findFirst({ where: { id: line.goodsReceiptLineId, firmId, receipt: { cancelledAt: null } } });
        if (!receipt) throw new AppError('Matched receipt unavailable', 404);
        if (orderLineId && orderLineId !== receipt.purchaseOrderLineId) throw new AppError('Bill purchase and receipt lines disagree', 409);
        orderLineId = receipt.purchaseOrderLineId;
        const billed = await tx.supplierBillLine.aggregate({ where: { firmId, goodsReceiptLineId: receipt.id, bill: { status: 'POSTED', id: { not: bill.id } } }, _sum: { quantity: true } });
        const inBill = bill.lines.filter((entry) => entry.goodsReceiptLineId === receipt.id).reduce((sum, entry) => sum.add(entry.quantity), decimal('0'));
        if (inBill.add(billed._sum.quantity ?? '0').gt(receipt.quantity.sub(receipt.returnedQuantity))) throw new AppError('Bill exceeds the net received quantity', 409);
      }
      if (!orderLineId) { if (!jsonObject(line.snapshot).expenseCategory) throw new AppError('A standalone supplier bill line requires an expense classification', 400); continue; }
      const orderLine = await tx.purchaseOrderLine.findFirst({ where: { id: orderLineId, firmId, order: { supplierId: bill.supplierId } }, include: { order: true } });
      if (!orderLine) throw new AppError('Matched purchase line unavailable', 404);
      if (orderLine.order.currency !== bill.currency || orderLine.order.status === 'DRAFT') throw new AppError('Supplier bill currency or approval differs from purchase order', 409);
      const snapshot = jsonObject(line.snapshot);
      if (!decimal(String(snapshot.unitCost)).eq(orderLine.unitCost) || !decimal(String(snapshot.taxRate)).eq(String(jsonObject(orderLine.snapshot).taxRate)) || jsonObject(bill.financialSnapshot).taxMode !== jsonObject(orderLine.order.financialSnapshot).taxMode) throw new AppError('Matched supplier cost/tax differs from the approved purchase snapshot', 409);
      local.set(orderLineId, (local.get(orderLineId) ?? decimal('0')).add(line.quantity));
      if (line.purchaseOrderLineId === null) await tx.supplierBillLine.update({ where: { id: line.id }, data: { purchaseOrderLineId: orderLineId } });
    }
    for (const [orderLineId, quantity] of local) {
      const orderLine = await tx.purchaseOrderLine.findFirstOrThrow({ where: { id: orderLineId, firmId } });
      const billed = await tx.supplierBillLine.aggregate({ where: { firmId, purchaseOrderLineId: orderLineId, bill: { status: 'POSTED', id: { not: bill.id } } }, _sum: { quantity: true } });
      if (quantity.add(billed._sum.quantity ?? '0').gt(orderLine.receivedQuantity)) throw new AppError('Bill exceeds net receipts for the approved purchase line', 409);
    }
  }
  async transitionBill(firmId: number, actorId: number, id: number, action: 'post' | 'void', input: Transition, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.SUPPLIER_BILLS_MANAGE, 'purchasing.bills');
      const row = await tx.supplierBill.findFirst({ where: { id, firmId }, include: billInclude });
      if (!row) throw new AppError('Supplier bill not found', 404);
      if (action === 'void' && row.status === 'VOID' && row.voidReason === input.reason) return row;
      if (action === 'post' && row.status === 'POSTED' && row.version === input.expectedVersion + 1) return row;
      if (row.version !== input.expectedVersion || action === 'post' && row.status !== 'DRAFT' || action === 'void' && row.status === 'VOID') throw new AppError('Supplier bill changed or transition unavailable', 409);
      if (action === 'post') { await supplier(tx, firmId, row.supplierId); await this.validateBillMatches(tx, firmId, row); if (await tx.expense.findFirst({ where: { firmId, supplierId: row.supplierId, reference: row.supplierReference, status: 'POSTED' } })) throw new AppError('Supplier reference is already recorded as an expense', 409); }
      const updated = await tx.supplierBill.update({ where: { id }, data: { status: action === 'post' ? 'POSTED' : 'VOID', version: { increment: 1 }, voidReason: action === 'void' ? input.reason : null }, include: billInclude });
      await audit(tx, firmId, actorId, 'SupplierBill', updated, { ...updated, reason: input.reason }, metadata); return updated;
    });
  }
  async createExpense(firmId: number, actorId: number, input: z.infer<typeof expenseSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.EXPENSES_MANAGE, 'expenses');
      const hash = requestHash(input);
      const replay = await tx.expense.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } } });
      if (replay) { if (replay.requestHash !== hash) throw new AppError('Expense idempotency conflict', 409); return replay; }
      const vendor = input.supplierId ? await supplier(tx, firmId, input.supplierId) : null;
      if (vendor && (await tx.supplierBill.findFirst({ where: { firmId, supplierId: vendor.id, supplierReference: input.reference, status: { not: 'VOID' } } }) || await tx.expense.findFirst({ where: { firmId, supplierId: vendor.id, reference: input.reference, status: 'POSTED' } }))) throw new AppError('Supplier reference is already recorded', 409);
      const financial = calculatePurchase([{ description: input.description, quantity: '1', unitCost: input.amount, taxRate: input.taxRate, expenseCategory: input.category }], await resolveBusinessPolicy(tx, firmId), input.taxMode);
      const row = await tx.expense.create({ data: { firmId, supplierId: vendor?.id, category: input.category, reference: input.reference, expenseDate: new Date(input.expenseDate), currency: financial.currency, total: decimal(financial.total), snapshot: jsonObject({ ...financial, supplier: vendor ? { id: vendor.id, name: vendor.name, gstin: vendor.gstin } : null }), actorId, idempotencyKey: input.idempotencyKey, requestHash: hash } });
      await audit(tx, firmId, actorId, 'Expense', row, row, metadata); return row;
    });
  }
  async voidExpense(firmId: number, actorId: number, id: number, reason: string, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => { await this.access(tx, firmId, actorId, PERMISSIONS.EXPENSES_MANAGE, 'expenses'); const row = await tx.expense.findFirst({ where: { id, firmId } }); if (!row) throw new AppError('Expense not found', 404); if (row.status === 'VOID') { if (row.voidReason !== reason) throw new AppError('Expense was already voided', 409); return row; } const updated = await tx.expense.update({ where: { id }, data: { status: 'VOID', voidReason: reason } }); await audit(tx, firmId, actorId, 'Expense', updated, updated, metadata); return updated; });
  }
}
export const purchasingRepository = new PurchasingRepository(prisma);
