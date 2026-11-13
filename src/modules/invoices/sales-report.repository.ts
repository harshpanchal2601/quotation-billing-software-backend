import type { Prisma } from '@prisma/client';
import { currencyCode, decimal, money } from '../../core/money/index.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature } from '../entitlements/index.js';

// Both conventional reporting and the assistant use the billing-owned definition.
export async function readSalesReport(tx: Prisma.TransactionClient, firmId: number, actorId: number, input: { dateFrom?: string; dateTo?: string; currency?: string }) {
  await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.INVOICES_VIEW);
  await assertTransactionFeature(tx, firmId, 'billing.invoices');
  await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.ADJUSTMENTS_VIEW);
  await assertTransactionFeature(tx, firmId, 'billing.adjustments');
  const rows = await tx.invoice.groupBy({
    by: ['currency', 'kind'],
    where: {
      firmId, status: 'ISSUED', kind: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] }, currency: input.currency,
      ...(input.dateFrom || input.dateTo ? { invoiceDate: {
        ...(input.dateFrom ? { gte: new Date(input.dateFrom) } : {}),
        ...(input.dateTo ? { lte: new Date(input.dateTo) } : {}),
      } } : {}),
    },
    _sum: { grandTotal: true }, _count: { _all: true },
  });
  return {
    basis: 'ISSUED_DOCUMENTS', dateFrom: input.dateFrom ?? null, dateTo: input.dateTo ?? null,
    currencies: [...new Set(rows.map((row) => row.currency))].map((currency) => {
      const entries = rows.filter((row) => row.currency === currency);
      const net = entries.reduce((sum, row) => row.kind === 'CREDIT_NOTE'
        ? sum.sub(row._sum.grandTotal ?? '0') : sum.add(row._sum.grandTotal ?? '0'), decimal('0'));
      return { currency, netSales: money(net, currencyCode(currency)).amount, documents: entries.reduce((sum, row) => sum + row._count._all, 0) };
    }),
    href: '/invoices',
  };
}
