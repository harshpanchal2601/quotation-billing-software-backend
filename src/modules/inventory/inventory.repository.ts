import { AuditAction, Prisma, type PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { decimal, roundDecimal } from '../../core/money/index.js';
import { jsonObject } from '../../core/serialization/json.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS, type Permission } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { assertSalesCapability } from '../settings/index.js';
import { emitAutomationEvent, enforceApproval } from '../automation/runtime.js';
import { assertStockQuantity, postStock, postReturnedStock, stockPosition, trackedItem } from './stock-ledger.js';
import type { inventoryListSchema, reorderSchema, stockAdjustmentSchema, stockReservationSchema, stockReturnSchema, stockTransferSchema, warehouseSchema } from './inventory.schema.js';

export async function auditInventory(tx: Prisma.TransactionClient, firmId: number, actorId: number, entityType: string, entityId: number, values: unknown, metadata: RequestMetadata) {
  await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType, entityId: String(entityId), action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: jsonObject(values) });
}

async function operation(tx: Prisma.TransactionClient, firmId: number, actorId: number, kind: string, input: { idempotencyKey: string }) {
  const hash = requestHash({ kind, ...input });
  const replay = await tx.stockOperation.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } } });
  if (replay) { if (replay.kind !== kind || replay.requestHash !== hash) throw new AppError('Stock operation idempotency conflict', 409); return { row: replay, replayed: true }; }
  return { row: await tx.stockOperation.create({ data: { firmId, actorId, kind, idempotencyKey: input.idempotencyKey, requestHash: hash, payload: jsonObject(input) } }), replayed: false };
}

export class InventoryRepository {
  constructor(private readonly db: PrismaClient) {}
  private async access(tx: Prisma.TransactionClient, firmId: number, actorId: number, permission: Permission) {
    await authorizeFirmJobActor(tx, firmId, actorId, permission);
    await assertTransactionFeature(tx, firmId, 'inventory');
  }
  async warehouses(firmId: number, actorId: number, search = '') {
    return this.db.$transaction(async (tx) => { await this.access(tx, firmId, actorId, PERMISSIONS.INVENTORY_VIEW); return { warehouses: await tx.warehouse.findMany({ where: { firmId, isActive: true, OR: [{ name: { contains: search } }, { code: { contains: search } }] }, orderBy: { code: 'asc' }, take: 100 }) }; });
  }
  async options(firmId: number, actorId: number, search: string) {
    return this.db.$transaction(async (tx) => { await this.access(tx, firmId, actorId, PERMISSIONS.INVENTORY_VIEW); return { items: await tx.item.findMany({ where: { firmId, deletedAt: null, isActive: true, stockTracking: true, kind: 'GOODS', name: { contains: search } }, select: { id: true, name: true, measurementUnit: { select: { symbol: true, allowDecimal: true } } }, orderBy: { name: 'asc' }, take: 100 }) }; });
  }
  async createWarehouse(firmId: number, actorId: number, input: z.infer<typeof warehouseSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => { await this.access(tx, firmId, actorId, PERMISSIONS.INVENTORY_MANAGE); const row = await tx.warehouse.create({ data: { firmId, ...input } }); await auditInventory(tx, firmId, actorId, 'Warehouse', row.id, row, metadata); return row; });
  }
  async positions(firmId: number, actorId: number, query: z.infer<typeof inventoryListSchema>) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.INVENTORY_VIEW);
      const where: Prisma.StockPositionWhereInput = { firmId, warehouseId: query.warehouseId, itemId: query.itemId };
      const rows = await tx.stockPosition.findMany({ where, include: { warehouse: true, item: { select: { name: true, itemCode: true } } }, orderBy: { id: 'asc' }, take: query.limit, skip: (query.page - 1) * query.limit });
      const ids = rows.map((row) => row.id);
      const totals = await tx.stockMovement.groupBy({ by: ['positionId'], where: { firmId, positionId: { in: ids } }, _sum: { quantity: true, value: true } });
      const held = await tx.stockReservation.groupBy({ by: ['positionId'], where: { firmId, positionId: { in: ids }, status: 'ACTIVE' }, _sum: { remaining: true } });
      const end = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
      const closing = await tx.stockMovement.groupBy({ by: ['positionId'], where: { firmId, positionId: { in: ids }, postedAt: { lte: end } }, _sum: { quantity: true, value: true } });
      const opening = query.from ? await tx.stockMovement.groupBy({ by: ['positionId'], where: { firmId, positionId: { in: ids }, postedAt: { lt: new Date(`${query.from}T00:00:00.000Z`) } }, _sum: { quantity: true, value: true } }) : [];
      return { positions: rows.map((row) => {
        const sum = totals.find((entry) => entry.positionId === row.id)?._sum;
        const reserved = held.find((entry) => entry.positionId === row.id)?._sum.remaining ?? decimal('0');
        const before = opening.find((entry) => entry.positionId === row.id)?._sum;
        const after = closing.find((entry) => entry.positionId === row.id)?._sum;
        return { ...row, onHand: row.onHand.toFixed(3), reserved: row.reserved.toFixed(3), available: row.onHand.sub(row.reserved).toFixed(3), value: row.value.toFixed(6), averageCost: row.onHand.isZero() ? '0.000000' : roundDecimal(decimal(row.value).div(row.onHand), 6), reorderLevel: row.reorderLevel.toFixed(3), lowStock: row.onHand.sub(row.reserved).lte(row.reorderLevel), reconciled: row.onHand.eq(sum?.quantity ?? '0') && row.value.eq(sum?.value ?? '0') && row.reserved.eq(reserved), openingQuantity: (before?.quantity ?? decimal('0')).toFixed(3), openingValue: (before?.value ?? decimal('0')).toFixed(6), closingQuantity: (after?.quantity ?? decimal('0')).toFixed(3), closingValue: (after?.value ?? decimal('0')).toFixed(6) };
      }), pagination: { page: query.page, limit: query.limit, total: await tx.stockPosition.count({ where }) }, policy: { valuation: 'MOVING_WEIGHTED_AVERAGE', negativeStock: 'BLOCK', quantityScale: 3, valueScale: 6, periodBasis: 'POSTED_AT_UTC', reservations: 'CURRENT' } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async movements(firmId: number, actorId: number, query: z.infer<typeof inventoryListSchema>) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.INVENTORY_VIEW);
      const where: Prisma.StockMovementWhereInput = { firmId, position: { firmId, warehouseId: query.warehouseId, itemId: query.itemId }, postedAt: { gte: query.from ? new Date(`${query.from}T00:00:00Z`) : undefined, lte: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined } };
      return { movements: await tx.stockMovement.findMany({ where, include: { position: { select: { itemId: true, warehouseId: true, currency: true } } }, orderBy: { id: 'desc' }, take: query.limit, skip: (query.page - 1) * query.limit }), pagination: { page: query.page, limit: query.limit, total: await tx.stockMovement.count({ where }) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async adjust(firmId: number, actorId: number, input: z.infer<typeof stockAdjustmentSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, (tx) => this.adjustInTransaction(tx, firmId, actorId, input, metadata));
  }
  async adjustInTransaction(tx: Prisma.TransactionClient, firmId: number, actorId: number, input: z.infer<typeof stockAdjustmentSchema>, metadata: RequestMetadata) {
    await this.access(tx, firmId, actorId, PERMISSIONS.STOCK_ADJUST);
    const result = await operation(tx, firmId, actorId, 'ADJUSTMENT', input);
    if (result.replayed) return result.row;
    const { itemId, ...adjustment } = input;
    await enforceApproval(tx, firmId, actorId, { action: 'STOCK_ADJUST', entityId: itemId, ...adjustment });
    const quantity = decimal(input.quantity);
    await postStock(tx, { firmId, actorId, warehouseId: input.warehouseId, itemId: input.itemId, quantity: input.direction === 'IN' ? quantity : quantity.neg(), inboundValue: input.direction === 'IN' ? quantity.mul(decimal(input.unitCost!)) : undefined, sourceType: 'STOCK_OPERATION', sourceId: result.row.id, sourceLineId: 1, eventType: 'ADJUSTMENT', reason: input.reason });
    await auditInventory(tx, firmId, actorId, 'StockAdjustment', result.row.id, input, metadata);
    const position = await tx.stockPosition.findUniqueOrThrow({ where: { firmId_warehouseId_itemId: { firmId, warehouseId: input.warehouseId, itemId: input.itemId } } });
    await emitAutomationEvent(tx, firmId, actorId, `stock-adjustment:${result.row.id}`, { trigger: 'stock.adjusted', entity: 'STOCK_OPERATION', entityId: result.row.id, documentNumber: String(result.row.id), status: 'POSTED', currency: position.currency, total: position.value.abs().toFixed(6), discountPercent: '0' });
    return result.row;
  }
  async transfer(firmId: number, actorId: number, input: z.infer<typeof stockTransferSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.INVENTORY_MANAGE);
      const result = await operation(tx, firmId, actorId, 'TRANSFER', input);
      if (result.replayed) return result.row;
      const out = await postStock(tx, { firmId, actorId, warehouseId: input.fromWarehouseId, itemId: input.itemId, quantity: decimal(input.quantity).neg(), sourceType: 'STOCK_OPERATION', sourceId: result.row.id, sourceLineId: 1, eventType: 'TRANSFER_OUT', reason: input.reason });
      await postStock(tx, { firmId, actorId, warehouseId: input.toWarehouseId, itemId: input.itemId, quantity: out.quantity.neg(), inboundValue: out.value.neg(), sourceType: 'STOCK_OPERATION', sourceId: result.row.id, sourceLineId: 1, eventType: 'TRANSFER_IN', reason: input.reason });
      await auditInventory(tx, firmId, actorId, 'StockTransfer', result.row.id, input, metadata); return result.row;
    });
  }
  async customerReturn(firmId: number, actorId: number, input: z.infer<typeof stockReturnSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.INVENTORY_MANAGE);
      const result = await operation(tx, firmId, actorId, 'RETURN', input);
      if (result.replayed) return result.row;
      await postReturnedStock(tx, { firmId, actorId, originalMovementId: input.originalMovementId, originalSource: 'FULFILLMENT', quantity: decimal(input.quantity), sourceType: 'STOCK_OPERATION', sourceId: result.row.id, sourceLineId: 1, reason: input.reason });
      await auditInventory(tx, firmId, actorId, 'StockReturn', result.row.id, input, metadata); return result.row;
    });
  }
  async reserve(firmId: number, actorId: number, input: z.infer<typeof stockReservationSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.INVENTORY_MANAGE);
      await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.SALES_ORDERS_VIEW); await assertTransactionFeature(tx, firmId, 'sales.orders'); await assertSalesCapability(tx, firmId, 'orders');
      const hash = requestHash(input);
      const replay = await tx.stockReservation.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } } });
      if (replay) { if (replay.requestHash !== hash) throw new AppError('Reservation idempotency conflict', 409); return replay; }
      const line = await tx.salesOrderLine.findFirst({ where: { id: input.salesOrderLineId, firmId, salesOrderId: input.salesOrderId }, include: { order: true } });
      if (!line) throw new AppError('Sales order line unavailable', 404);
      if (!['OPEN', 'PARTIALLY_FULFILLED'].includes(line.order.status)) throw new AppError('Sales order cannot reserve stock', 409);
      const itemId = trackedItem(line.snapshot);
      if (!itemId) throw new AppError('Only tracked goods can reserve stock', 409);
      const { position, allowDecimal } = await stockPosition(tx, firmId, input.warehouseId, itemId);
      const quantity = decimal(input.quantity); assertStockQuantity(quantity, allowDecimal);
      const delivered = await tx.fulfillmentLine.aggregate({ where: { firmId, salesOrderLineId: line.id, fulfillment: { cancelledAt: null } }, _sum: { quantity: true } });
      const held = await tx.stockReservation.aggregate({ where: { firmId, salesOrderLineId: line.id, status: 'ACTIVE' }, _sum: { remaining: true } });
      if (quantity.add(held._sum.remaining ?? '0').add(delivered._sum.quantity ?? '0').gt(line.quantity) || quantity.gt(position.onHand.sub(position.reserved))) throw new AppError('Reservation exceeds available stock or remaining order quantity', 409);
      const row = await tx.stockReservation.create({ data: { firmId, positionId: position.id, salesOrderId: input.salesOrderId, salesOrderLineId: line.id, quantity, remaining: quantity, actorId, idempotencyKey: input.idempotencyKey, requestHash: hash } });
      await tx.stockPosition.update({ where: { id: position.id }, data: { reserved: { increment: quantity } } });
      await auditInventory(tx, firmId, actorId, 'StockReservation', row.id, row, metadata); return row;
    });
  }
  async reservations(firmId: number, actorId: number, query: z.infer<typeof inventoryListSchema>) {
    return this.db.$transaction(async (tx) => { await this.access(tx, firmId, actorId, PERMISSIONS.INVENTORY_VIEW); const where: Prisma.StockReservationWhereInput = { firmId, salesOrderId: query.salesOrderId, position: { warehouseId: query.warehouseId, itemId: query.itemId, firmId } }; return { reservations: await tx.stockReservation.findMany({ where, orderBy: { id: 'desc' }, take: query.limit, skip: (query.page - 1) * query.limit }), pagination: { page: query.page, limit: query.limit, total: await tx.stockReservation.count({ where }) } }; });
  }
  async release(firmId: number, actorId: number, id: number, reason: string, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => { await this.access(tx, firmId, actorId, PERMISSIONS.INVENTORY_MANAGE); const row = await tx.stockReservation.findFirst({ where: { id, firmId } }); if (!row) throw new AppError('Reservation not found', 404); if (row.status !== 'ACTIVE') return row; await tx.stockPosition.update({ where: { id: row.positionId }, data: { reserved: { decrement: row.remaining } } }); const updated = await tx.stockReservation.update({ where: { id }, data: { status: 'RELEASED', remaining: 0, releaseReason: reason } }); await auditInventory(tx, firmId, actorId, 'StockReservation', id, updated, metadata); return updated; });
  }
  async reorder(firmId: number, actorId: number, input: z.infer<typeof reorderSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => { await this.access(tx, firmId, actorId, PERMISSIONS.INVENTORY_MANAGE); const { position, allowDecimal } = await stockPosition(tx, firmId, input.warehouseId, input.itemId); if (decimal(input.quantity).gt(0)) assertStockQuantity(decimal(input.quantity), allowDecimal); const row = await tx.stockPosition.update({ where: { id: position.id }, data: { reorderLevel: decimal(input.quantity) } }); await auditInventory(tx, firmId, actorId, 'StockThreshold', row.id, row, metadata); return row; });
  }
}
export const inventoryRepository = new InventoryRepository(prisma);
export const adjustStockInTransaction = inventoryRepository.adjustInTransaction.bind(inventoryRepository);
