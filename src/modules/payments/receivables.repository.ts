import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { currencyCode, money } from '../../core/money/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { billingToday, readInvoiceSettlement } from '../invoices/index.js';
import { authorizePayment } from './payments.repository.js';
import type { ReceivablesQuery } from './payments.schema.js';

type BalanceRow = { id: number; company_id: number; company_name: string; document_number: string; currency: string; due_date: Date | null; adjusted_total: Prisma.Decimal; allocated: Prisma.Decimal; outstanding: Prisma.Decimal };
type AgeingRow = { currency: string; bucket: string; amount: Prisma.Decimal; count: bigint };

// Aggregate before joining to avoid multiplying allocations by adjustment rows.
// All subqueries carry their own firm predicate, including nested joins.
function projection(firmId: number, query: ReceivablesQuery) {
  return Prisma.sql`SELECT b.*, b.adjusted_total - b.allocated AS outstanding FROM (
    SELECT i.id, i.company_id, c.name AS company_name, i.document_number, i.currency, i.due_date,
      i.grand_total + COALESCE(n.adjustment, 0) AS adjusted_total, COALESCE(a.allocated, 0) AS allocated
    FROM invoices i JOIN companies c ON c.id = i.company_id AND c.firm_id = i.firm_id
    LEFT JOIN (SELECT source_invoice_id, SUM(CASE WHEN kind = 'CREDIT_NOTE' THEN -grand_total ELSE grand_total END) AS adjustment
      FROM invoices WHERE firm_id = ${firmId} AND status = 'ISSUED' AND kind IN ('CREDIT_NOTE', 'DEBIT_NOTE') GROUP BY source_invoice_id) n ON n.source_invoice_id = i.id
    LEFT JOIN (SELECT a.invoice_id, SUM(a.amount) AS allocated FROM payment_allocations a
      JOIN customer_payments p ON p.id = a.payment_id AND p.firm_id = a.firm_id
      LEFT JOIN payment_reversals r ON r.payment_id = p.id AND r.firm_id = p.firm_id
      WHERE a.firm_id = ${firmId} AND p.firm_id = ${firmId} AND r.id IS NULL GROUP BY a.invoice_id) a ON a.invoice_id = i.id
    WHERE i.firm_id = ${firmId} AND i.kind = 'INVOICE' AND i.status = 'ISSUED'
      ${query.companyId ? Prisma.sql`AND i.company_id = ${query.companyId}` : Prisma.empty}
      ${query.currency ? Prisma.sql`AND i.currency = ${query.currency}` : Prisma.empty}
      ${query.search ? Prisma.sql`AND (i.document_number LIKE ${`%${query.search}%`} OR c.name LIKE ${`%${query.search}%`})` : Prisma.empty}
    ) b`;
}

export class ReceivablesRepository {
  constructor(private readonly db: PrismaClient) {}
  async aging(firmId: number, actorId: number, query: ReceivablesQuery) {
    return this.db.$transaction(async (tx) => {
      await authorizePayment(tx, firmId, actorId, PERMISSIONS.PAYMENTS_VIEW);
      if (query.companyId && !await tx.company.findFirst({ where: { id: query.companyId, firmId }, select: { id: true } })) throw new AppError('Customer not found', 404);
      const today = billingToday();
      const source = projection(firmId, query);
      const invalid = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM (${source}) p WHERE p.outstanding < 0 OR p.adjusted_total < 0`;
      if (Number(invalid[0]?.count ?? 0) > 0) throw new AppError('Receivables do not reconcile; review allocations and adjustments', 409);
      const predicate = Prisma.sql`p.outstanding > 0 ${query.overdueOnly === 'true' ? Prisma.sql`AND p.due_date < ${today}` : Prisma.empty}`;
      const rows = await tx.$queryRaw<BalanceRow[]>`SELECT p.* FROM (${source}) p WHERE ${predicate} ORDER BY p.id DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`;
      const buckets = await tx.$queryRaw<AgeingRow[]>`SELECT p.currency,
        CASE WHEN p.due_date IS NULL OR p.due_date >= ${today} THEN 'CURRENT'
          WHEN DATEDIFF(${today}, p.due_date) <= 30 THEN 'DAYS_1_30'
          WHEN DATEDIFF(${today}, p.due_date) <= 60 THEN 'DAYS_31_60'
          WHEN DATEDIFF(${today}, p.due_date) <= 90 THEN 'DAYS_61_90' ELSE 'DAYS_91_PLUS' END AS bucket,
        SUM(p.outstanding) AS amount, COUNT(*) AS count FROM (${source}) p WHERE ${predicate} GROUP BY p.currency, bucket ORDER BY p.currency, bucket`;
      const credits = await tx.$queryRaw<Array<{ currency: string; unapplied: Prisma.Decimal }>>`SELECT p.currency,
        SUM(p.amount - COALESCE(f.refunded, 0) - COALESCE(a.allocated, 0)) AS unapplied
        FROM customer_payments p
        LEFT JOIN payment_reversals r ON r.payment_id = p.id AND r.firm_id = p.firm_id
        LEFT JOIN (SELECT payment_id, SUM(amount) AS refunded FROM customer_refunds WHERE firm_id = ${firmId} GROUP BY payment_id) f ON f.payment_id = p.id
        LEFT JOIN (SELECT payment_id, SUM(amount) AS allocated FROM payment_allocations WHERE firm_id = ${firmId} GROUP BY payment_id) a ON a.payment_id = p.id
        WHERE p.firm_id = ${firmId} AND r.id IS NULL
          ${query.companyId ? Prisma.sql`AND p.company_id = ${query.companyId}` : Prisma.empty}
          ${query.currency ? Prisma.sql`AND p.currency = ${query.currency}` : Prisma.empty}
        GROUP BY p.currency`;
      const total = buckets.reduce((sum, row) => sum + Number(row.count), 0);
      return {
        asOf: today, timezone: 'Asia/Kolkata',
        receivables: rows.map((row) => ({ id: row.id, companyId: row.company_id, companyName: row.company_name, documentNumber: row.document_number, currency: row.currency, dueDate: row.due_date?.toISOString().slice(0, 10) ?? null,
          adjustedTotal: money(row.adjusted_total, currencyCode(row.currency)).amount, allocated: money(row.allocated, currencyCode(row.currency)).amount, outstanding: money(row.outstanding, currencyCode(row.currency)).amount,
          settlementStatus: row.allocated.gt(0) ? 'PARTIAL' as const : 'UNPAID' as const, overdue: row.due_date !== null && row.due_date.toISOString().slice(0, 10) < today })),
        buckets: buckets.map((row) => ({ currency: row.currency, bucket: row.bucket, amount: money(row.amount, currencyCode(row.currency)).amount, count: Number(row.count) })),
        customerCredits: credits.map((row) => ({ currency: row.currency, unapplied: money(row.unapplied, currencyCode(row.currency)).amount })),
        pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async invoice(firmId: number, actorId: number, id: number) {
    return this.db.$transaction(async (tx) => {
      await authorizePayment(tx, firmId, actorId, PERMISSIONS.PAYMENTS_VIEW);
      const balance = await readInvoiceSettlement(tx, firmId, id);
      const allocations = await tx.paymentAllocation.findMany({ where: { invoiceId: id, firmId }, include: { payment: { select: { reference: true, reversal: { select: { id: true } } } } }, orderBy: { id: 'asc' } });
      return { ...balance, allocations: allocations.map((row) => ({ id: row.id, paymentId: row.paymentId, reference: row.payment.reference, active: row.payment.reversal === null, amount: money(row.amount, balance.currency).amount, createdById: row.createdById, createdAt: row.createdAt.toISOString() })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
export const receivablesRepository = new ReceivablesRepository(prisma);
