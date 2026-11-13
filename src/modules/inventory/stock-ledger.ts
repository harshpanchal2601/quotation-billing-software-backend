import { Prisma, type StockPosition } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';
import { decimal, roundDecimal } from '../../core/money/index.js';
import { assertTransactionFeature } from '../entitlements/index.js';
import { resolveBusinessPolicy } from '../settings/index.js';

export function trackedItem(snapshot: Prisma.JsonValue): number | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.stockTracking !== true) return null;
  if (snapshot.kind !== 'GOODS' || typeof snapshot.itemId !== 'number' || !Number.isInteger(snapshot.itemId) || snapshot.itemId < 1) throw new AppError('Tracked goods snapshot is invalid', 409);
  return snapshot.itemId;
}

export async function readStockContext(tx: Prisma.TransactionClient, firmId: number, warehouseId: number, itemId: number, currency?: string) {
  await assertTransactionFeature(tx, firmId, 'inventory');
  const { policy, version } = await resolveBusinessPolicy(tx, firmId);
  if (policy.sales?.preset === 'SERVICE') throw new AppError('Inventory is disabled for the service-only business preset', 403);
  if (currency !== undefined && currency !== policy.currency) throw new AppError('Inventory uses the configured firm currency; an approved FX workflow is required for other currencies', 409);
  const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, firmId, isActive: true } });
  const item = await tx.item.findFirst({ where: { id: itemId, firmId, deletedAt: null, isActive: true, kind: 'GOODS', stockTracking: true }, include: { measurementUnit: true } });
  if (!warehouse || !item) throw new AppError('Tracked item or warehouse unavailable', 404);
  if (item.measurementUnit.firmId !== firmId || item.measurementUnit.deletedAt || !item.measurementUnit.isActive) throw new AppError('Stock unit is unavailable', 409);
  return { policy, policyVersion: version, item, warehouse };
}

export async function stockPosition(tx: Prisma.TransactionClient, firmId: number, warehouseId: number, itemId: number, currency?: string) {
  const { policy, item } = await readStockContext(tx, firmId, warehouseId, itemId, currency);
  const position = await tx.stockPosition.upsert({ where: { firmId_warehouseId_itemId: { firmId, warehouseId, itemId } }, create: { firmId, warehouseId, itemId, currency: policy.currency }, update: {} });
  if (position.currency !== policy.currency) throw new AppError('Inventory currency cannot change after postings', 409);
  return { position, allowDecimal: item.measurementUnit.allowDecimal };
}

export async function previewStockAdjustment(tx: Prisma.TransactionClient, firmId: number, input: { warehouseId: number; itemId: number; direction: 'IN' | 'OUT'; quantity: string; unitCost?: string }) {
  const context = await readStockContext(tx, firmId, input.warehouseId, input.itemId);
  const existing = await tx.stockPosition.findUnique({ where: { firmId_warehouseId_itemId: { firmId, warehouseId: input.warehouseId, itemId: input.itemId } } });
  const position = existing ?? { onHand: decimal('0'), reserved: decimal('0'), value: decimal('0'), currency: context.policy.currency };
  if (position.currency !== context.policy.currency) throw new AppError('Inventory currency cannot change after postings', 409);
  const quantity = decimal(input.quantity).mul(input.direction === 'IN' ? 1 : -1);
  assertStockQuantity(quantity, context.item.measurementUnit.allowDecimal);
  if (input.direction === 'IN' && input.unitCost === undefined) throw new AppError('Inbound adjustments require a cost', 400);
  const projected = projectStock(position, quantity, input.direction === 'IN' ? quantity.mul(decimal(input.unitCost!)) : undefined);
  const movement = await tx.stockMovement.findFirst({ where: { firmId, position: { firmId, itemId: input.itemId, warehouseId: input.warehouseId } }, orderBy: { id: 'desc' }, select: { id: true } });
  return {
    before: { currency: position.currency, onHand: position.onHand.toString(), reserved: position.reserved.toString(), inventoryValue: position.value.toString(), policyVersion: context.policyVersion, itemUpdatedAt: context.item.updatedAt.toISOString(), lastMovementId: movement?.id ?? null, warehouse: context.warehouse.code, unit: context.item.measurementUnit.symbol },
    after: { onHand: projected.onHand.toString(), inventoryValue: projected.value.toString(), currency: position.currency },
  };
}

export function assertStockQuantity(quantity: Prisma.Decimal, allowDecimal: boolean) {
  if (quantity.isZero() || quantity.abs().gte('1000000000') || quantity.decimalPlaces() > 3 || (!allowDecimal && !quantity.isInteger())) throw new AppError('Quantity exceeds the item unit precision', 400);
}

// Pure projection arithmetic shared by every posting, with no binary floats.
export function projectStock(position: Pick<StockPosition, 'onHand' | 'reserved' | 'value'>, quantity: Prisma.Decimal, inboundValue?: Prisma.Decimal, reversalValue?: Prisma.Decimal) {
  const onHand = decimal(position.onHand).add(quantity);
  if (onHand.lt(0) || onHand.lt(position.reserved)) throw new AppError('Insufficient available stock', 409);
  const value = reversalValue ?? (quantity.gt(0) ? inboundValue : quantity.abs().eq(position.onHand) ? decimal(position.value).neg() : decimal(roundDecimal(decimal(position.value).mul(quantity).div(position.onHand), 6)));
  if (value === undefined || value.isNegative() !== quantity.isNegative() && !value.isZero()) throw new AppError('Invalid movement value', 409);
  const nextValue = decimal(position.value).add(value);
  if (nextValue.lt(0) || (onHand.isZero() && !nextValue.isZero()) || nextValue.gte('1000000000000000000000000') || onHand.gte('1000000000000000')) throw new AppError('Stock valuation cannot be reversed after consumption; use a source-linked return instead', 409);
  return { onHand, value: nextValue, movementValue: value };
}

type Posting = { firmId: number; warehouseId: number; itemId: number; currency?: string; quantity: Prisma.Decimal; inboundValue?: Prisma.Decimal; reversalValue?: Prisma.Decimal; sourceType: string; sourceId: number; sourceLineId: number; eventType: string; actorId: number; reason: string; originalMovementId?: number; workOrderId?: number };

// Caller owns authorization and withFirmEntitlementTransaction. There is no
// update/delete path for a posted movement or arbitrary balance assignment.
export async function postStock(tx: Prisma.TransactionClient, input: Posting) {
  const { position, allowDecimal } = await stockPosition(tx, input.firmId, input.warehouseId, input.itemId, input.currency);
  assertStockQuantity(input.quantity, allowDecimal);
  const key = { firmId: input.firmId, sourceType: input.sourceType, sourceId: input.sourceId, sourceLineId: input.sourceLineId, eventType: input.eventType };
  const replay = await tx.stockMovement.findUnique({ where: { firmId_sourceType_sourceId_sourceLineId_eventType: key } });
  if (replay) {
    if (replay.positionId !== position.id || !replay.quantity.eq(input.quantity)) throw new AppError('Stock source event conflict', 409);
    if (input.workOrderId !== undefined && replay.workOrderId !== input.workOrderId) throw new AppError('Stock work order source conflict', 409);
    return replay;
  }
  const next = projectStock(position, input.quantity, input.inboundValue, input.reversalValue);
  const movement = await tx.stockMovement.create({ data: { ...key, positionId: position.id, quantity: input.quantity, value: next.movementValue, actorId: input.actorId, reason: input.reason, originalMovementId: input.originalMovementId, ...(input.workOrderId === undefined ? {} : { workOrderId: input.workOrderId }) } });
  await tx.stockPosition.update({ where: { id: position.id }, data: { onHand: next.onHand, value: next.value } });
  return movement;
}

export async function postReturnedStock(tx: Prisma.TransactionClient, input: { firmId: number; actorId: number; originalMovementId: number; originalSource: 'RECEIPT' | 'FULFILLMENT'; quantity: Prisma.Decimal; sourceType: string; sourceId: number; sourceLineId: number; reason: string }) {
  await assertTransactionFeature(tx, input.firmId, 'inventory');
  const original = await tx.stockMovement.findFirst({ where: { id: input.originalMovementId, firmId: input.firmId, sourceType: input.originalSource, eventType: input.originalSource === 'RECEIPT' ? 'RECEIVE' : 'DISPATCH' }, include: { position: true } });
  if (!original) throw new AppError('Original stock movement not found', 404);
  const corrections = await tx.stockMovement.aggregate({ where: { firmId: input.firmId, originalMovementId: original.id }, _sum: { quantity: true, value: true } });
  const already = decimal(corrections._sum.quantity ?? '0').abs();
  if (input.quantity.add(already).gt(original.quantity.abs())) throw new AppError('Return exceeds the original movement remainder', 409);
  const incoming = original.quantity.lt(0);
  const cumulativeValue = decimal(roundDecimal(original.value.abs().mul(input.quantity.add(already)).div(original.quantity.abs()), 6));
  const returnedValue = cumulativeValue.sub(decimal(corrections._sum.value ?? '0').abs());
  return postStock(tx, { ...input, warehouseId: original.position.warehouseId, itemId: original.position.itemId, quantity: incoming ? input.quantity : input.quantity.neg(), inboundValue: incoming ? returnedValue : undefined, eventType: incoming ? 'CUSTOMER_RETURN' : 'SUPPLIER_RETURN' });
}

export async function releaseOrderStock(tx: Prisma.TransactionClient, firmId: number, salesOrderId: number, reason: string) {
  const rows = await tx.stockReservation.findMany({ where: { firmId, salesOrderId, status: 'ACTIVE' } });
  if (rows.length) await assertTransactionFeature(tx, firmId, 'inventory');
  for (const row of rows) {
    await tx.stockPosition.update({ where: { id: row.positionId }, data: { reserved: { decrement: row.remaining } } });
    await tx.stockReservation.update({ where: { id: row.id }, data: { remaining: 0, status: 'RELEASED', releaseReason: reason } });
  }
}

export async function postFulfillmentStock(tx: Prisma.TransactionClient, input: { firmId: number; actorId: number; fulfillmentId: number; salesOrderId: number; lines: Array<{ id: number; salesOrderLineId: number; quantity: Prisma.Decimal; warehouseId?: number; snapshot: Prisma.JsonValue }> }) {
  for (const line of input.lines) {
    const itemId = trackedItem(line.snapshot);
    if (itemId === null) continue;
    if (!line.warehouseId) throw new AppError('Choose a warehouse for each tracked goods line', 400);
    const { position } = await stockPosition(tx, input.firmId, line.warehouseId, itemId);
    const reservations = await tx.stockReservation.findMany({ where: { firmId: input.firmId, salesOrderLineId: line.salesOrderLineId, status: 'ACTIVE' }, orderBy: { id: 'asc' } });
    const here = reservations.filter((row) => row.positionId === position.id);
    const elsewhere = reservations.some((row) => row.positionId !== position.id);
    const held = here.reduce((sum, row) => sum.add(row.remaining), decimal('0'));
    if (elsewhere && held.lt(line.quantity)) throw new AppError('Dispatch reserved goods from their warehouse or release the other reservation first', 409);
    let remaining = decimal(line.quantity);
    for (const row of here) {
      const consumed = Prisma.Decimal.min(row.remaining, remaining);
      if (consumed.isZero()) break;
      const left = row.remaining.sub(consumed);
      await tx.stockReservation.update({ where: { id: row.id }, data: { remaining: left, status: left.isZero() ? 'CONSUMED' : 'ACTIVE' } });
      await tx.stockPosition.update({ where: { id: position.id }, data: { reserved: { decrement: consumed } } });
      remaining = remaining.sub(consumed);
    }
    await postStock(tx, { ...input, warehouseId: line.warehouseId, itemId, quantity: decimal(line.quantity).neg(), sourceType: 'FULFILLMENT', sourceId: input.fulfillmentId, sourceLineId: line.id, eventType: 'DISPATCH', reason: 'Sales order dispatch' });
  }
}

export async function reverseFulfillmentStock(tx: Prisma.TransactionClient, firmId: number, actorId: number, fulfillmentId: number, reason: string) {
  const originals = await tx.stockMovement.findMany({ where: { firmId, sourceType: 'FULFILLMENT', sourceId: fulfillmentId, eventType: 'DISPATCH' }, include: { position: true, corrections: true } });
  for (const row of originals) {
    if (row.corrections.length) throw new AppError('A returned dispatch cannot also be cancelled', 409);
    await postStock(tx, { firmId, actorId, warehouseId: row.position.warehouseId, itemId: row.position.itemId, quantity: row.quantity.neg(), inboundValue: row.value.neg(), sourceType: 'FULFILLMENT', sourceId: fulfillmentId, sourceLineId: row.sourceLineId, eventType: 'DISPATCH_REVERSAL', originalMovementId: row.id, reason });
  }
}
