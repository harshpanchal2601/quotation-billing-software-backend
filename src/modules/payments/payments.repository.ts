import { AuditAction, Prisma, type PrismaClient } from '@prisma/client';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { currencyCode, decimal, money } from '../../core/money/index.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS, type Permission } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { billingToday, readInvoiceSettlement } from '../invoices/index.js';
import { paymentBalance, receiptAmount } from './payment-balances.js';
import type { AllocatePaymentInput, PaymentListInput, RecordPaymentInput, RefundPaymentInput, ReversePaymentInput } from './payments.schema.js';

const paymentInclude = { company: { select: { name: true } }, reversal: true, refunds: { orderBy: { id: 'asc' as const } }, allocations: { orderBy: { id: 'asc' as const }, include: { invoice: { select: { documentNumber: true } } } } } satisfies Prisma.CustomerPaymentInclude;
type PaymentRecord = Prisma.CustomerPaymentGetPayload<{ include: typeof paymentInclude }>;
type PaymentSummaryRecord = Prisma.CustomerPaymentGetPayload<{ include: { company: { select: { name: true } }; reversal: true } }>;

function summary(row: PaymentSummaryRecord, balances: ReturnType<typeof paymentBalance>) {
  const amount = (value: Prisma.Decimal) => money(value, currencyCode(row.currency)).amount;
  return {
    id: row.id, firmId: row.firmId, companyId: row.companyId, companyName: row.company.name,
    currency: row.currency, amount: amount(row.amount), method: row.method, reference: row.reference,
    receivedDate: row.receivedDate.toISOString().slice(0, 10), createdAt: row.createdAt.toISOString(), createdById: row.createdById,
    status: row.reversal ? 'REVERSED' as const : 'RECORDED' as const, ...balances,
  };
}
function serialise(row: PaymentRecord) {
  const amount = (value: Prisma.Decimal) => money(value, currencyCode(row.currency)).amount;
  return {
    ...summary(row, paymentBalance(row)),
    allocations: row.allocations.map((entry) => ({ id: entry.id, invoiceId: entry.invoiceId, documentNumber: entry.invoice.documentNumber, amount: amount(entry.amount), createdById: entry.createdById, createdAt: entry.createdAt.toISOString(), active: row.reversal === null })),
    reversal: row.reversal ? { id: row.reversal.id, amount: amount(row.reversal.amount), reason: row.reversal.reason, createdById: row.reversal.createdById, createdAt: row.reversal.createdAt.toISOString() } : null,
    refunds: row.refunds.map((entry) => ({ id: entry.id, amount: amount(entry.amount), paidDate: entry.paidDate.toISOString().slice(0, 10), reference: entry.reference, reason: entry.reason, createdById: entry.createdById, createdAt: entry.createdAt.toISOString() })),
  };
}

export async function authorizePayment(tx: Prisma.TransactionClient, firmId: number, actorId: number, permission: Permission) {
  await authorizeFirmJobActor(tx, firmId, actorId, permission);
  await assertTransactionFeature(tx, firmId, permission === PERMISSIONS.PAYMENTS_MANAGE ? 'payments.manage' : 'payments.record');
}

export class PaymentsRepository {
  constructor(private readonly db: PrismaClient) {}
  private async find(tx: Prisma.TransactionClient, firmId: number, id: number) {
    const payment = await tx.customerPayment.findFirst({ where: { firmId, id }, include: paymentInclude });
    if (!payment) throw new AppError('Payment not found', 404);
    return payment;
  }
  private async customer(tx: Prisma.TransactionClient, firmId: number, id: number, active = false) {
    const company = await tx.company.findFirst({ where: { id, firmId, ...(active ? { isActive: true, deletedAt: null } : {}) }, select: { id: true } });
    if (!company) throw new AppError('Customer not found', 404);
  }
  private async audit(tx: Prisma.TransactionClient, firmId: number, actorId: number, row: PaymentRecord, action: AuditAction, metadata: RequestMetadata) {
    await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'CustomerPayment', entityId: String(row.id), action, policy: 'REQUIRED', newValues: JSON.parse(JSON.stringify(serialise(row))) as Prisma.InputJsonObject });
  }
  async list(firmId: number, actorId: number, query: PaymentListInput) {
    return this.db.$transaction(async (tx) => {
      await authorizePayment(tx, firmId, actorId, PERMISSIONS.PAYMENTS_VIEW);
      if (query.companyId) await this.customer(tx, firmId, query.companyId);
      const where: Prisma.CustomerPaymentWhereInput = { firmId, companyId: query.companyId, currency: query.currency,
        ...(query.search ? { OR: [{ reference: { contains: query.search } }, { company: { firmId, name: { contains: query.search } } }] } : {}) };
      const rows = await tx.customerPayment.findMany({ where, include: { company: { select: { name: true } }, reversal: true }, orderBy: { id: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit });
      const paymentIds = rows.map((row) => row.id);
      const allocations = await tx.paymentAllocation.groupBy({ by: ['paymentId'], where: { firmId, paymentId: { in: paymentIds } }, _sum: { amount: true } });
      const refunds = await tx.customerRefund.groupBy({ by: ['paymentId'], where: { firmId, paymentId: { in: paymentIds } }, _sum: { amount: true } });
      const allocatedById = new Map(allocations.map((row) => [row.paymentId, row._sum.amount ?? decimal('0')]));
      const refundedById = new Map(refunds.map((row) => [row.paymentId, row._sum.amount ?? decimal('0')]));
      const total = await tx.customerPayment.count({ where });
      return { payments: rows.map((row) => summary(row, paymentBalance({ ...row, allocations: [{ amount: allocatedById.get(row.id) ?? decimal('0') }], refunds: [{ amount: refundedById.get(row.id) ?? decimal('0') }] }))), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async get(firmId: number, actorId: number, id: number) {
    return this.db.$transaction(async (tx) => {
      await authorizePayment(tx, firmId, actorId, PERMISSIONS.PAYMENTS_VIEW);
      return serialise(await this.find(tx, firmId, id));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async customers(firmId: number, actorId: number, search: string) {
    return this.db.$transaction(async (tx) => {
      await authorizePayment(tx, firmId, actorId, PERMISSIONS.PAYMENTS_RECORD);
      return tx.company.findMany({ where: { firmId, deletedAt: null, isActive: true, name: { contains: search } }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 50 });
    });
  }
  async record(firmId: number, actorId: number, input: RecordPaymentInput, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorizePayment(tx, firmId, actorId, PERMISSIONS.PAYMENTS_RECORD);
      const hash = requestHash(input);
      const previous = await tx.customerPayment.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } }, include: paymentInclude });
      if (previous) {
        if (previous.requestHash !== hash) throw new AppError('Idempotency key was used for another receipt', 409);
        return serialise(previous);
      }
      await this.customer(tx, firmId, input.companyId, true);
      if (input.receivedDate > billingToday()) throw new AppError('A confirmed receipt cannot be future dated', 400);
      const amount = receiptAmount(input.amount, input.currency);
      const row = await tx.customerPayment.create({ data: { firmId, companyId: input.companyId, currency: input.currency, amount, method: input.method, reference: input.reference, receivedDate: new Date(input.receivedDate), idempotencyKey: input.idempotencyKey, requestHash: hash, createdById: actorId }, include: paymentInclude });
      if (input.allocations.length > 0) await this.allocateRows(tx, firmId, actorId, row, { allocations: input.allocations, idempotencyKey: input.idempotencyKey });
      const record = await this.find(tx, firmId, row.id);
      await this.audit(tx, firmId, actorId, record, AuditAction.CREATE, metadata);
      return serialise(record);
    });
  }
  private async allocateRows(tx: Prisma.TransactionClient, firmId: number, actorId: number, payment: PaymentRecord, input: AllocatePaymentInput) {
    const hash = requestHash({ paymentId: payment.id, ...input });
    const replay = payment.allocations.filter((row) => row.requestKey === input.idempotencyKey);
    if (replay.length > 0) {
      if (replay.some((row) => row.requestHash !== hash)) throw new AppError('Allocation idempotency conflict', 409);
      return;
    }
    if (payment.reversal) throw new AppError('Reversed receipts cannot be allocated', 409);
    const rows = input.allocations.map((row) => ({ ...row, amount: receiptAmount(row.amount, payment.currency) }));
    const requested = rows.reduce((total, row) => total.add(row.amount), decimal('0'));
    if (requested.gt(paymentBalance(payment).unapplied)) throw new AppError('Allocations exceed the unapplied receipt amount', 409);
    for (const row of rows) {
      const invoice = await readInvoiceSettlement(tx, firmId, row.invoiceId);
      if (invoice.companyId !== payment.companyId || invoice.currency !== payment.currency) throw new AppError('Invoice must belong to the receipt customer and currency', 409);
      if (decimal(row.amount).gt(invoice.outstanding)) throw new AppError('Allocation exceeds invoice outstanding amount', 409);
    }
    await tx.paymentAllocation.createMany({ data: rows.map((row) => ({ ...row, firmId, companyId: payment.companyId, currency: payment.currency, paymentId: payment.id, requestKey: input.idempotencyKey, requestHash: hash, createdById: actorId })) });
  }
  async allocate(firmId: number, actorId: number, id: number, input: AllocatePaymentInput, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorizePayment(tx, firmId, actorId, PERMISSIONS.PAYMENTS_RECORD);
      const old = await this.find(tx, firmId, id);
      const replay = old.allocations.some((row) => row.requestKey === input.idempotencyKey);
      await this.allocateRows(tx, firmId, actorId, old, input);
      const record = await this.find(tx, firmId, id);
      if (!replay) await this.audit(tx, firmId, actorId, record, AuditAction.UPDATE, metadata);
      return serialise(record);
    });
  }
  async reverse(firmId: number, actorId: number, id: number, input: ReversePaymentInput, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorizePayment(tx, firmId, actorId, PERMISSIONS.PAYMENTS_MANAGE);
      const old = await this.find(tx, firmId, id);
      const hash = requestHash({ paymentId: id, ...input });
      if (old.reversal) {
        if (old.reversal.requestHash !== hash || old.reversal.idempotencyKey !== input.idempotencyKey) throw new AppError('Receipt was already reversed', 409);
        return serialise(old);
      }
      // Refunds remain historical cash outflows. Compensate only the remaining
      // confirmed funds, and invalidate all original allocations exactly once.
      const remaining = paymentBalance(old).netAmount;
      await tx.paymentReversal.create({ data: { firmId, paymentId: id, amount: remaining, reason: input.reason, idempotencyKey: input.idempotencyKey, requestHash: hash, createdById: actorId } });
      const record = await this.find(tx, firmId, id);
      await this.audit(tx, firmId, actorId, record, AuditAction.UPDATE, metadata);
      return serialise(record);
    });
  }
  async refund(firmId: number, actorId: number, id: number, input: RefundPaymentInput, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorizePayment(tx, firmId, actorId, PERMISSIONS.PAYMENTS_MANAGE);
      const old = await this.find(tx, firmId, id);
      const hash = requestHash({ paymentId: id, ...input });
      const replay = await tx.customerRefund.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } } });
      if (replay) {
        if (replay.paymentId !== id || replay.requestHash !== hash) throw new AppError('Refund idempotency conflict', 409);
        return serialise(old);
      }
      if (old.reversal) throw new AppError('A reversed receipt cannot be refunded', 409);
      if (input.paidDate < old.receivedDate.toISOString().slice(0, 10) || input.paidDate > billingToday()) throw new AppError('Refund date must be between receipt date and today', 400);
      const amount = receiptAmount(input.amount, old.currency);
      if (decimal(amount).gt(paymentBalance(old).unapplied)) throw new AppError('Refund exceeds available unapplied funds', 409);
      await tx.customerRefund.create({ data: { firmId, paymentId: id, amount, paidDate: new Date(input.paidDate), reference: input.reference, reason: input.reason, idempotencyKey: input.idempotencyKey, requestHash: hash, createdById: actorId } });
      const record = await this.find(tx, firmId, id);
      await this.audit(tx, firmId, actorId, record, AuditAction.UPDATE, metadata);
      return serialise(record);
    });
  }
}

export const paymentsRepository = new PaymentsRepository(prisma);
