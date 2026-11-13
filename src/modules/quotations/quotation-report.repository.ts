import type { Prisma } from '@prisma/client';
import { decimal } from '../../core/money/index.js';
import type { DateWindow } from '../../core/validation/date-window.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature } from '../entitlements/index.js';

export async function readQuotationReport(tx: Prisma.TransactionClient, firmId: number, actorId: number, window: DateWindow, currency?: string) {
  await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.QUOTATIONS_VIEW);
  await assertTransactionFeature(tx, firmId, 'quotations');
  const groups = await tx.quotation.groupBy({
    by: ['currency', 'status'],
    where: { firmId, deletedAt: null, isLatestRevision: true, currency, quotationDate: { gte: window.from, lt: window.until } },
    _sum: { grandTotal: true }, _count: { _all: true },
    orderBy: [{ currency: 'asc' }, { status: 'asc' }],
  });
  return [...new Set(groups.map((row) => row.currency))].map((code) => {
    const rows = groups.filter((row) => row.currency === code);
    const count = rows.reduce((total, row) => total + row._count._all, 0);
    const accepted = rows.filter((row) => row.status === 'ACCEPTED' || row.status === 'COMPLETED');
    const acceptedCount = accepted.reduce((total, row) => total + row._count._all, 0);
    return {
      currency: code, count, acceptedCount,
      // Legacy quotations store two decimal places, including currencies outside billing's registry.
      value: rows.reduce((total, row) => total.add(row._sum.grandTotal ?? '0'), decimal('0')).toFixed(2),
      acceptedValue: accepted.reduce((total, row) => total.add(row._sum.grandTotal ?? '0'), decimal('0')).toFixed(2),
      conversionRate: count ? decimal(String(acceptedCount)).mul(100).div(count).toFixed(2) : '0.00',
    };
  });
}
