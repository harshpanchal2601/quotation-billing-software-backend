import { listOrderBy } from '../../core/validation/list-sort.js';
import { AuditAction, Prisma, type PrismaClient } from '@prisma/client';
import { discountPercentage, emitAutomationEvent, enforceApproval } from '../automation/runtime.js';
import type { z } from 'zod';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { jsonObject as json } from '../../core/serialization/json.js';
import { decimal } from '../../core/money/index.js';
import { reserveDocumentSequence } from '../../core/sequences/index.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS, type Permission } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { readAcceptedQuotationForBilling, customerQuotationSnapshot } from '../quotations/index.js';
import { assertSalesCapability, readCustomerSellerSnapshot } from '../settings/index.js';
import { postFulfillmentStock, reverseFulfillmentStock, releaseOrderStock } from '../inventory/index.js';
import { availableOrderQuantity, fulfillmentStatus } from './order-quantities.js';
import type { cancelSalesSchema, fulfillmentSchema, orderConversionSchema, salesDetailSchema, salesListSchema } from './sales-orders.schema.js';

type DetailQuery = Partial<z.infer<typeof salesDetailSchema>>;

export async function readOrderForInvoicing(tx: Prisma.TransactionClient, firmId: number, id: number) {
  await assertSalesCapability(tx, firmId, 'orders');
  const order = await tx.salesOrder.findFirst({ where: { firmId, id }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
  if (!order) throw new AppError('Sales order not found', 404);
  if (order.status === 'CANCELLED') throw new AppError('Sales order is cancelled', 409);
  const fulfilled = await tx.fulfillmentLine.groupBy({ by: ['salesOrderLineId'], where: { firmId, salesOrderId: id, fulfillment: { cancelledAt: null } }, _sum: { quantity: true } });
  const reserved = await tx.salesOrderInvoiceLine.groupBy({ by: ['salesOrderLineId'], where: { firmId, salesOrderId: id, invoice: { status: { not: 'VOID' } } }, _sum: { quantity: true } });
  return { ...order, lines: order.lines.map((line) => {
    const delivered = fulfilled.find((row) => row.salesOrderLineId === line.id)?._sum.quantity ?? decimal('0');
    const invoiced = reserved.find((row) => row.salesOrderLineId === line.id)?._sum.quantity ?? decimal('0');
    return { ...line, fulfilled: delivered, reserved: invoiced, available: availableOrderQuantity(line.quantity, delivered, invoiced) };
  }) };
}
export class SalesOrdersRepository {
  constructor(private readonly db: PrismaClient) {}
  async fulfillmentWarehouses(firmId: number, actorId: number, search = '') {
    return this.db.$transaction(async (tx) => { await this.access(tx, firmId, actorId, PERMISSIONS.FULFILLMENTS_MANAGE); await assertTransactionFeature(tx, firmId, 'inventory'); return { warehouses: await tx.warehouse.findMany({ where: { firmId, isActive: true, OR: [{ name: { contains: search } }, { code: { contains: search } }] }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 100 }) }; });
  }
  private async access(tx: Prisma.TransactionClient, firmId: number, actorId: number, permission: Permission) { await authorizeFirmJobActor(tx, firmId, actorId, permission); await assertTransactionFeature(tx, firmId, 'sales.orders'); await assertSalesCapability(tx, firmId, 'orders'); }
  private async detail(tx: Prisma.TransactionClient, firmId: number, id: number, query: DetailQuery = {}) {
    const historyPage = query.historyPage ?? 1;
    // Preserve the former shared-page contract for callers that only send historyPage.
    const completionPage = query.completionPage ?? historyPage;
    const invoicePage = query.invoicePage ?? historyPage;
    const paging = (page: number) => ({ skip: (page - 1) * 20, take: 20 });
    const row = await tx.salesOrder.findFirst({ where: { id, firmId }, include: {
      lines: { orderBy: { lineNumber: 'asc' } },
      history: { orderBy: listOrderBy({ sortBy: query.historySortBy, sortOrder: query.historySortOrder }, ['id', 'version', 'status', 'actorId', 'createdAt'], 'version'), ...paging(historyPage) },
      fulfillments: { orderBy: listOrderBy({ sortBy: query.completionSortBy, sortOrder: query.completionSortOrder }, ['id', 'reference', 'occurredAt', 'cancelledAt']), ...paging(completionPage), include: { lines: { orderBy: { id: 'asc' } } } },
      _count: { select: { history: true, fulfillments: true, invoices: true } },
    } });
    if (!row) throw new AppError('Sales order not found', 404);
    const quantities = row.status === 'CANCELLED' ? null : await readOrderForInvoicing(tx, firmId, id);
    return { ...row,
      historyPagination: { page: historyPage, hasMore: Math.max(row._count.history, row._count.fulfillments, row._count.invoices) > historyPage * 20 },
      pagination: { history: { page: historyPage, limit: 20, total: row._count.history }, completions: { page: completionPage, limit: 20, total: row._count.fulfillments }, invoices: { page: invoicePage, limit: 20, total: row._count.invoices } },
      lines: row.lines.map((line) => { const totals = quantities?.lines.find((entry) => entry.id === line.id); return { ...line, quantity: line.quantity.toFixed(3), fulfilled: totals?.fulfilled.toFixed(3) ?? '0.000', reserved: totals?.reserved.toFixed(3) ?? '0.000', available: totals?.available.toFixed(3) ?? '0.000' }; }),
      invoices: await tx.invoice.findMany({ where: { firmId, sourceSalesOrderId: id }, select: { id: true, documentNumber: true, status: true }, orderBy: listOrderBy({ sortBy: query.invoiceSortBy, sortOrder: query.invoiceSortOrder }, ['id', 'documentNumber', 'status']), ...paging(invoicePage) }),
    };
  }
  private async audit(tx: Prisma.TransactionClient, firmId: number, actorId: number, id: number, reason: string, metadata: RequestMetadata) {
    const row = await this.detail(tx, firmId, id);
    await tx.salesOrderHistory.create({ data: { firmId, salesOrderId: id, version: row.version, status: row.status, actorId, reason } });
    await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'SalesOrder', entityId: String(id), action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: json(row) });
  }
  async list(firmId: number, actorId: number, query: z.infer<typeof salesListSchema>) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.SALES_ORDERS_VIEW);
      const where: Prisma.SalesOrderWhereInput = { firmId, companyId: query.companyId, orderNumber: { contains: query.search } };
      return { orders: await tx.salesOrder.findMany({ where, orderBy: listOrderBy(query, ['id', 'orderNumber', 'status', 'currency', 'createdAt']), take: query.limit, skip: (query.page - 1) * query.limit, select: { id: true, orderNumber: true, status: true, currency: true, companyId: true, company: { select: { name: true } }, createdAt: true } }), pagination: { page: query.page, limit: query.limit, total: await tx.salesOrder.count({ where }) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async get(firmId: number, actorId: number, id: number, query: DetailQuery | number = {}) { return this.db.$transaction(async (tx) => { await this.access(tx, firmId, actorId, PERMISSIONS.SALES_ORDERS_VIEW); return this.detail(tx, firmId, id, typeof query === 'number' ? { historyPage: query } : query); }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }); }
  async convert(firmId: number, actorId: number, input: z.infer<typeof orderConversionSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, (tx) => this.convertInTransaction(tx, firmId, actorId, input, metadata));
  }
  async convertInTransaction(tx: Prisma.TransactionClient, firmId: number, actorId: number, input: z.infer<typeof orderConversionSchema>, metadata: RequestMetadata) {
    await this.access(tx, firmId, actorId, PERMISSIONS.SALES_ORDERS_MANAGE);
    await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.QUOTATIONS_VIEW); await assertTransactionFeature(tx, firmId, 'quotations');
    const hash = requestHash(input);
    const previous = await tx.salesOrder.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } } });
    if (previous) { if (previous.requestHash !== hash) throw new AppError('Order idempotency conflict', 409); return this.detail(tx, firmId, previous.id); }
    const source = await readAcceptedQuotationForBilling(tx, firmId, input.sourceRevisionId);
    await enforceApproval(tx, firmId, actorId, { action: 'ORDER_CONFIRM', entityId: input.sourceRevisionId, idempotencyKey: input.idempotencyKey });
    if (await tx.salesOrder.findUnique({ where: { firmId_sourceQuotationId: { firmId, sourceQuotationId: source.id } } })) throw new AppError('Revision already has a sales order', 409);
    if (await tx.invoice.findFirst({ where: { firmId, sourceQuotationId: source.id, status: { not: 'VOID' } } })) throw new AppError('Revision already has a direct invoice', 409);
    if (!source.items.length) throw new AppError('Quotation has no lines', 409);
    const seller = await readCustomerSellerSnapshot(tx, firmId);
    const preset = await assertSalesCapability(tx, firmId, 'orders');
    const snapshot = json({ ...customerQuotationSnapshot(source), seller, invoicingPolicy: 'FULFILLED_QUANTITIES', fulfillmentLabel: preset.preset === 'SERVICE' ? 'Service completion' : preset.preset === 'TRADING' ? 'Delivery / dispatch' : preset.preset === 'MANUFACTURING' ? 'Production delivery / dispatch' : 'Delivery / service completion' });
    const sequence = await reserveDocumentSequence(tx, { firmId, documentType: 'SALES_ORDER', period: 'ALL' });
    const catalog = await tx.item.findMany({ where: { firmId, id: { in: source.items.flatMap((line) => line.itemId ? [line.itemId] : []) }, deletedAt: null }, select: { id: true, kind: true, stockTracking: true } });
    const row = await tx.salesOrder.create({ data: { firmId, companyId: source.companyId, sourceQuotationId: source.id, currency: source.currency, orderNumber: `SO-${sequence.toString().padStart(6, '0')}`, snapshot, snapshotHash: requestHash(snapshot), idempotencyKey: input.idempotencyKey, requestHash: hash, createdById: actorId, lines: { create: source.items.map((line) => ({ lineNumber: line.lineNumber, quantity: line.quantity, snapshot: json({ itemId: line.itemId, kind: catalog.find((item) => item.id === line.itemId)?.kind ?? 'GOODS', stockTracking: catalog.find((item) => item.id === line.itemId)?.stockTracking ?? false, itemName: line.itemNameSnapshot, itemCode: line.itemCodeSnapshot, description: line.descriptionSnapshot, measurementUnit: line.measurementUnitSnapshot, quantity: line.quantity.toFixed(3), unitRate: line.unitRate.toFixed(2), discountType: line.discountType, discountValue: line.discountValue.toFixed(2), taxRate: line.gstRate.toFixed(2) }) })) } } });
    await this.audit(tx, firmId, actorId, row.id, 'Accepted quotation revision converted', metadata);
    await emitAutomationEvent(tx, firmId, actorId, `order:${row.id}`, { trigger: 'order.confirmed', entity: 'SALES_ORDER', entityId: row.id, documentNumber: row.orderNumber, status: row.status, currency: row.currency, total: source.grandTotal.toString(), discountPercent: discountPercentage(source.subtotal, source.itemDiscountAmount.add(source.quotationDiscountAmount)) });
    return this.detail(tx, firmId, row.id);
  }
  private async refresh(tx: Prisma.TransactionClient, firmId: number, actorId: number, id: number, reason: string, metadata: RequestMetadata) {
    const order = await readOrderForInvoicing(tx, firmId, id);
    await tx.salesOrder.update({ where: { id }, data: { status: fulfillmentStatus(order.lines), version: { increment: 1 } } });
    await this.audit(tx, firmId, actorId, id, reason, metadata); return this.detail(tx, firmId, id);
  }
  async fulfill(firmId: number, actorId: number, input: z.infer<typeof fulfillmentSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.FULFILLMENTS_MANAGE);
      const hash = requestHash(input);
      const replay = await tx.fulfillment.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } } });
      if (replay) { if (replay.requestHash !== hash) throw new AppError('Fulfillment idempotency conflict', 409); return this.detail(tx, firmId, replay.salesOrderId); }
      const order = await readOrderForInvoicing(tx, firmId, input.salesOrderId);
      if (order.version !== input.expectedVersion) throw new AppError('Order changed; reload', 409);
      if (new Date(input.occurredAt).getTime() > Date.now()) throw new AppError('Completion cannot be future dated', 400);
      for (const row of input.lines) { const line = order.lines.find((entry) => entry.id === row.salesOrderLineId); if (!line) throw new AppError('Order line unavailable', 404); if (decimal(row.quantity).add(line.fulfilled).gt(line.quantity)) throw new AppError('Completion exceeds ordered quantity', 409); }
      const fulfillment = await tx.fulfillment.create({ data: { firmId, salesOrderId: order.id, reference: input.reference, occurredAt: new Date(input.occurredAt), idempotencyKey: input.idempotencyKey, requestHash: hash, createdById: actorId, lines: { create: input.lines.map((row) => ({ salesOrderLineId: row.salesOrderLineId, quantity: decimal(row.quantity) })) } }, include: { lines: true } });
      await postFulfillmentStock(tx, { firmId, actorId, fulfillmentId: fulfillment.id, salesOrderId: order.id, lines: fulfillment.lines.map((line) => ({ ...line, warehouseId: input.lines.find((entry) => entry.salesOrderLineId === line.salesOrderLineId)?.warehouseId, snapshot: order.lines.find((entry) => entry.id === line.salesOrderLineId)!.snapshot })) });
      return this.refresh(tx, firmId, actorId, order.id, `Completion recorded: ${input.reference}`, metadata);
    });
  }
  async cancelFulfillment(firmId: number, actorId: number, id: number, input: z.infer<typeof cancelSalesSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.FULFILLMENTS_MANAGE);
      const row = await tx.fulfillment.findFirst({ where: { id, firmId }, include: { lines: true } });
      if (!row) throw new AppError('Fulfillment not found', 404);
      if (row.cancelledAt) { if (row.cancellationReason !== input.reason) throw new AppError('Completion already cancelled', 409); return this.detail(tx, firmId, row.salesOrderId); }
      const order = await readOrderForInvoicing(tx, firmId, row.salesOrderId);
      if (order.version !== input.expectedVersion) throw new AppError('Order changed; reload', 409);
      for (const line of row.lines) { const totals = order.lines.find((entry) => entry.id === line.salesOrderLineId)!; if (totals.fulfilled.sub(line.quantity).lt(totals.reserved)) throw new AppError('Void linked invoice drafts/issued documents through billing before cancelling this completion', 409); }
      await reverseFulfillmentStock(tx, firmId, actorId, id, input.reason);
      await tx.fulfillment.update({ where: { id }, data: { cancelledAt: new Date(), cancellationReason: input.reason, cancelledById: actorId } });
      return this.refresh(tx, firmId, actorId, row.salesOrderId, `Completion #${id} cancelled: ${input.reason}`, metadata);
    });
  }
  async cancel(firmId: number, actorId: number, id: number, input: z.infer<typeof cancelSalesSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, PERMISSIONS.SALES_ORDERS_MANAGE);
      const order = await readOrderForInvoicing(tx, firmId, id);
      if (order.version !== input.expectedVersion) throw new AppError('Order changed; reload', 409);
      if (order.lines.some((line) => line.fulfilled.gt(0) || line.reserved.gt(0))) throw new AppError('Cancel completions and void invoices before cancelling the order', 409);
      await releaseOrderStock(tx, firmId, id, input.reason);
      await tx.salesOrder.update({ where: { id }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      await this.audit(tx, firmId, actorId, id, input.reason, metadata); return this.detail(tx, firmId, id);
    });
  }
}
export const salesOrdersRepository = new SalesOrdersRepository(prisma);
export const confirmOrderInTransaction = salesOrdersRepository.convertInTransaction.bind(salesOrdersRepository);
