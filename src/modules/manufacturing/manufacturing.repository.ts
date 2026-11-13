import { listOrderBy } from '../../core/validation/list-sort.js';
import { AuditAction, Prisma, type PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { decimal } from '../../core/money/index.js';
import { jsonObject } from '../../core/serialization/json.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS, type Permission } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { assertStockQuantity, postStock, readStockContext } from '../inventory/index.js';
import { resolveBusinessPolicy } from '../settings/index.js';
import { workOrderSnapshotSchema, type bomCreateSchema, type manufacturingListSchema, type workOrderActionSchema, type workOrderCreateSchema } from './manufacturing.schema.js';

const bomInclude = { components: { orderBy: { id: 'asc' as const } } } satisfies Prisma.BillOfMaterialsInclude;
const orderInclude = { movements: { orderBy: { id: 'asc' as const } } } satisfies Prisma.WorkOrderInclude;
type Bom = Prisma.BillOfMaterialsGetPayload<{ include: typeof bomInclude }>;
type Order = Prisma.WorkOrderGetPayload<{ include: typeof orderInclude }>;
function bomDto(row: Bom) { return { id: row.id, code: row.code, name: row.name, revision: row.revision, outputItemId: row.outputItemId, outputName: row.outputName, outputUnit: row.outputUnit, outputQuantity: row.outputQuantity.toFixed(3), components: row.components.map((line) => ({ id: line.id, itemId: line.itemId, name: line.name, unit: line.unit, quantity: line.quantity.toFixed(3) })) }; }
function orderDto(row: Order) { return { id: row.id, bomId: row.bomId, warehouseId: row.warehouseId, quantity: row.quantity.toFixed(3), currency: row.currency, status: row.status, version: row.version, snapshot: workOrderSnapshotSchema.parse(row.snapshot), createdAt: row.createdAt.toISOString(), movements: row.movements.map((movement) => ({ id: movement.id, positionId: movement.positionId, eventType: movement.eventType, quantity: movement.quantity.toFixed(3), value: movement.value.toFixed(6), originalMovementId: movement.originalMovementId })) }; }
async function audit(tx: Prisma.TransactionClient, firmId: number, actorId: number, entityType: string, id: number, event: 'VERSION_CREATED' | 'CREATED' | 'COMPLETED' | 'CANCELLED', values: unknown, metadata: RequestMetadata) {
  await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType, entityId: String(id), action: event === 'CREATED' || event === 'VERSION_CREATED' ? AuditAction.CREATE : AuditAction.UPDATE, policy: 'REQUIRED', newValues: jsonObject({ event, values }) });
}

export class ManufacturingRepository {
  constructor(private readonly db: PrismaClient) {}
  private async access(tx: Prisma.TransactionClient, firmId: number, actorId: number, permission: Permission) {
    await authorizeFirmJobActor(tx, firmId, actorId, permission);
    await assertTransactionFeature(tx, firmId, 'manufacturing');
    await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.INVENTORY_VIEW);
    await assertTransactionFeature(tx, firmId, 'inventory');
  }
  private async item(tx: Prisma.TransactionClient, firmId: number, itemId: number) {
    const item = await tx.item.findFirst({ where: { id: itemId, firmId, isActive: true, deletedAt: null, kind: 'GOODS', stockTracking: true }, include: { measurementUnit: true } });
    if (!item) throw new AppError('Tracked manufacturing item not found', 404);
    if (item.measurementUnit.firmId !== firmId || !item.measurementUnit.isActive || item.measurementUnit.deletedAt) throw new AppError('Manufacturing measurement unit is unavailable', 409);
    return item;
  }
  async options(firmId: number, actorId: number, search: string) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.MANUFACTURING_VIEW);
      return {
        items: await tx.item.findMany({ where: { firmId, isActive: true, deletedAt: null, kind: 'GOODS', stockTracking: true, OR: [{ name: { contains: search } }, { itemCode: { contains: search } }] }, select: { id: true, name: true, itemCode: true }, orderBy: { id: 'asc' }, take: 100 }),
      };
    });
  }
  async list(firmId: number, actorId: number, kind: 'boms' | 'work-orders', query: z.infer<typeof manufacturingListSchema>) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.MANUFACTURING_VIEW);
      const page = { take: query.limit, skip: (query.page - 1) * query.limit, orderBy: listOrderBy(query, kind === 'boms' ? ['id', 'code', 'name', 'revision', 'outputQuantity', 'createdAt'] : ['id', 'status', 'quantity', 'createdAt']) };
      if (kind === 'boms') {
        const where = { firmId, OR: [{ code: { contains: query.search } }, { name: { contains: query.search } }] };
        return { records: (await tx.billOfMaterials.findMany({ where, ...page, include: bomInclude })).map(bomDto), pagination: { page: query.page, limit: query.limit, total: await tx.billOfMaterials.count({ where }) } };
      }
      const where = { firmId, bom: { firmId, OR: [{ code: { contains: query.search } }, { name: { contains: query.search } }] } };
      return { records: (await tx.workOrder.findMany({ where, ...page, include: orderInclude })).map(orderDto), pagination: { page: query.page, limit: query.limit, total: await tx.workOrder.count({ where }) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async getOrder(firmId: number, actorId: number, id: number) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.MANUFACTURING_VIEW);
      const row = await tx.workOrder.findFirst({ where: { id, firmId }, include: { ...orderInclude, warehouse: { select: { code: true, name: true } } } });
      if (!row) throw new AppError('Work order not found', 404);
      return { ...orderDto(row), warehouse: row.warehouse };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async createBom(firmId: number, actorId: number, input: z.infer<typeof bomCreateSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.MANUFACTURING_MANAGE);
      const { policy } = await resolveBusinessPolicy(tx, firmId);
      if (policy.sales?.preset === 'SERVICE') throw new AppError('Manufacturing is disabled for the service-only business preset', 403);
      const hash = requestHash(input);
      const replay = await tx.billOfMaterials.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } }, include: bomInclude });
      if (replay) { if (replay.requestHash !== hash) throw new AppError('BOM request key conflict', 409); return bomDto(replay); }
      const output = await this.item(tx, firmId, input.outputItemId); assertStockQuantity(decimal(input.outputQuantity), output.measurementUnit.allowDecimal);
      const components: Prisma.BomComponentUncheckedCreateWithoutBomInput[] = [];
      for (const line of input.components) {
        const item = await this.item(tx, firmId, line.itemId); assertStockQuantity(decimal(line.quantity), item.measurementUnit.allowDecimal);
        components.push({ itemId: item.id, quantity: decimal(line.quantity), unitId: item.measurementUnitId, name: item.name, unit: item.measurementUnit.symbol });
      }
      const latest = await tx.billOfMaterials.findFirst({ where: { firmId, code: input.code }, orderBy: { revision: 'desc' }, select: { revision: true } });
      const row = await tx.billOfMaterials.create({ data: { firmId, code: input.code, name: input.name, revision: (latest?.revision ?? 0) + 1, outputItemId: output.id, outputQuantity: decimal(input.outputQuantity), outputUnitId: output.measurementUnitId, outputName: output.name, outputUnit: output.measurementUnit.symbol, actorId, idempotencyKey: input.idempotencyKey, requestHash: hash, components: { create: components } }, include: bomInclude });
      await audit(tx, firmId, actorId, 'BillOfMaterials', row.id, 'VERSION_CREATED', bomDto(row), metadata); return bomDto(row);
    });
  }
  async createOrder(firmId: number, actorId: number, input: z.infer<typeof workOrderCreateSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.MANUFACTURING_MANAGE);
      const hash = requestHash(input);
      const replay = await tx.workOrder.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } }, include: orderInclude });
      if (replay) { if (replay.requestHash !== hash) throw new AppError('Work order request key conflict', 409); return orderDto(replay); }
      const bom = await tx.billOfMaterials.findFirst({ where: { id: input.bomId, firmId }, include: bomInclude });
      if (!bom) throw new AppError('BOM not found', 404);
      const output = await readStockContext(tx, firmId, input.warehouseId, bom.outputItemId);
      if (output.item.measurementUnitId !== bom.outputUnitId) throw new AppError('BOM output unit changed; create a new BOM version', 409);
      const quantity = decimal(input.quantity); assertStockQuantity(quantity, output.item.measurementUnit.allowDecimal);
      const components = [];
      for (const line of bom.components) {
        const context = await readStockContext(tx, firmId, input.warehouseId, line.itemId);
        if (context.item.measurementUnitId !== line.unitId) throw new AppError('BOM component unit changed; create a new BOM version', 409);
        const required = decimal(line.quantity).mul(quantity).div(bom.outputQuantity);
        assertStockQuantity(required, context.item.measurementUnit.allowDecimal);
        components.push({ lineId: line.id, itemId: line.itemId, unitId: line.unitId, name: line.name, unit: line.unit, quantity: required.toFixed(3) });
      }
      const snapshot = workOrderSnapshotSchema.parse({ bomCode: bom.code, bomRevision: bom.revision, output: { itemId: bom.outputItemId, unitId: bom.outputUnitId, name: bom.outputName, unit: bom.outputUnit, quantity: quantity.toFixed(3) }, components });
      const row = await tx.workOrder.create({ data: { firmId, bomId: bom.id, warehouseId: input.warehouseId, quantity, currency: output.policy.currency, snapshot: jsonObject(snapshot), actorId, idempotencyKey: input.idempotencyKey, requestHash: hash }, include: orderInclude });
      await audit(tx, firmId, actorId, 'WorkOrder', row.id, 'CREATED', orderDto(row), metadata); return orderDto(row);
    });
  }
  async transition(firmId: number, actorId: number, id: number, action: 'complete' | 'cancel', input: z.infer<typeof workOrderActionSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.MANUFACTURING_POST);
      const row = await tx.workOrder.findFirst({ where: { id, firmId }, include: orderInclude });
      if (!row) throw new AppError('Work order not found', 404);
      const hash = requestHash({ action, ...input });
      if (action === 'complete' && row.status === 'COMPLETED' && row.completionHash === hash || action === 'cancel' && row.status === 'CANCELLED' && row.cancellationHash === hash) return orderDto(row);
      if (row.version !== input.expectedVersion) throw new AppError('Work order changed; reload', 409);
      if (action === 'complete' && row.status !== 'DRAFT' || action === 'cancel' && row.status === 'CANCELLED') throw new AppError('Work order transition is unavailable', 409);
      const snapshot = workOrderSnapshotSchema.parse(row.snapshot);
      if (action === 'complete') {
        let consumedValue = decimal('0');
        // Every consumption and the output receipt commit in the same firm-locked transaction.
        for (const line of snapshot.components) {
          const context = await readStockContext(tx, firmId, row.warehouseId, line.itemId, row.currency);
          if (context.item.measurementUnitId !== line.unitId) throw new AppError('Component unit changed; cancel and recreate the work order', 409);
          const movement = await postStock(tx, { firmId, actorId, warehouseId: row.warehouseId, itemId: line.itemId, currency: row.currency, quantity: decimal(line.quantity).neg(), sourceType: 'WORK_ORDER', sourceId: id, sourceLineId: line.lineId, eventType: 'CONSUME', workOrderId: id, reason: input.reason });
          consumedValue = consumedValue.sub(movement.value);
        }
        const output = await readStockContext(tx, firmId, row.warehouseId, snapshot.output.itemId, row.currency);
        if (output.item.measurementUnitId !== snapshot.output.unitId) throw new AppError('Output unit changed; cancel and recreate the work order', 409);
        await postStock(tx, { firmId, actorId, warehouseId: row.warehouseId, itemId: snapshot.output.itemId, currency: row.currency, quantity: decimal(snapshot.output.quantity), inboundValue: consumedValue, sourceType: 'WORK_ORDER', sourceId: id, sourceLineId: 0, eventType: 'PRODUCE', workOrderId: id, reason: input.reason });
      } else if (row.status === 'COMPLETED') {
        const originals = await tx.stockMovement.findMany({ where: { firmId, workOrderId: id, sourceType: 'WORK_ORDER', sourceId: id, eventType: { in: ['CONSUME', 'PRODUCE'] } }, include: { position: true, corrections: true }, orderBy: { id: 'asc' } });
        if (originals.length !== snapshot.components.length + 1 || originals.some((movement) => movement.corrections.length > 0)) throw new AppError('Work order movements do not reconcile', 409);
        // Remove output first. Consumption or reservations can correctly prevent cancellation.
        originals.sort((left, right) => Number(right.quantity.gt(0)) - Number(left.quantity.gt(0)));
        for (const movement of originals) await postStock(tx, { firmId, actorId, warehouseId: movement.position.warehouseId, itemId: movement.position.itemId, currency: row.currency, quantity: movement.quantity.neg(), ...(movement.quantity.gt(0) ? { reversalValue: movement.value.neg() } : { inboundValue: movement.value.neg() }), sourceType: 'WORK_ORDER', sourceId: id, sourceLineId: movement.sourceLineId, eventType: movement.eventType === 'PRODUCE' ? 'PRODUCE_REVERSAL' : 'CONSUME_REVERSAL', workOrderId: id, originalMovementId: movement.id, reason: input.reason });
      }
      const updated = await tx.workOrder.update({ where: { id }, data: { version: { increment: 1 }, status: action === 'complete' ? 'COMPLETED' : 'CANCELLED', ...(action === 'complete' ? { completionKey: input.idempotencyKey, completionHash: hash } : { cancellationKey: input.idempotencyKey, cancellationHash: hash }) }, include: orderInclude });
      await audit(tx, firmId, actorId, 'WorkOrder', id, action === 'complete' ? 'COMPLETED' : 'CANCELLED', { order: orderDto(updated), reason: input.reason }, metadata); return orderDto(updated);
    });
  }
}
export const manufacturingRepository = new ManufacturingRepository(prisma);
