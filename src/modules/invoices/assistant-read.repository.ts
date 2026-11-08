import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../core/database/prisma.js';
import { currencyCode, decimal, money } from '../../core/money/index.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature } from '../entitlements/index.js';
import { invoicesRepository } from './invoices.repository.js';
import { invoiceListSchema } from './invoices.schema.js';

// Financial report queries remain owned by the billing domain.

export async function searchAssistantInvoices(firmId: number, search: string, page: number) {
  const result = await invoicesRepository.list(firmId, 'INVOICE', invoiceListSchema.parse({ search, page, limit: 20 }));
  return { records: result.documents.map((row) => ({ id: row.id, label: row.documentNumber ?? `Draft ${row.id}`, customer: String(row.buyerSnapshot && typeof row.buyerSnapshot === 'object' && !Array.isArray(row.buyerSnapshot) ? row.buyerSnapshot.name ?? '' : ''), href: `/invoices/${row.id}`, status: row.status, currency: row.currency, total: row.grandTotal, version: row.version })), pagination: result.pagination };
}

// Issued document sales, segmented by currency. Receipts are reported by Payments.
export async function readAssistantSales(firmId: number, actorId: number, input: { dateFrom?: string; dateTo?: string; currency?: string }, db: PrismaClient = prisma) {
  return db.$transaction(async (tx) => {
    await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.INVOICES_VIEW);
    await assertTransactionFeature(tx, firmId, 'billing.invoices');
    await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.ADJUSTMENTS_VIEW);
    await assertTransactionFeature(tx, firmId, 'billing.adjustments');
    const rows = await tx.invoice.groupBy({ by: ['currency', 'kind'], where: {
      firmId, status: 'ISSUED', kind: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] }, currency: input.currency,
      ...(input.dateFrom || input.dateTo ? { invoiceDate: { ...(input.dateFrom ? { gte: new Date(input.dateFrom) } : {}), ...(input.dateTo ? { lte: new Date(input.dateTo) } : {}) } } : {}),
    }, _sum: { grandTotal: true }, _count: { _all: true } });
    const currencies = [...new Set(rows.map((row) => row.currency))];
    return { basis: 'ISSUED_DOCUMENTS', dateFrom: input.dateFrom ?? null, dateTo: input.dateTo ?? null,
      currencies: currencies.map((currency) => {
        const entries = rows.filter((row) => row.currency === currency);
        const net = entries.reduce((sum, row) => row.kind === 'CREDIT_NOTE' ? sum.sub(row._sum.grandTotal ?? 0) : sum.add(row._sum.grandTotal ?? 0), decimal('0'));
        return { currency, netSales: money(net, currencyCode(currency)).amount, documents: entries.reduce((sum, row) => sum + row._count._all, 0) };
      }), href: '/invoices' };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
