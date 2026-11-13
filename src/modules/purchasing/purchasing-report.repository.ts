import type { Prisma } from '@prisma/client';
import { currencyCode, money } from '../../core/money/index.js';
import type { DateWindow } from '../../core/validation/date-window.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature } from '../entitlements/index.js';

export async function readPurchasingReport(tx: Prisma.TransactionClient, firmId: number, actorId: number, kind: 'purchaseOrders' | 'supplierBills' | 'expenses', window: DateWindow, currency?: string) {
  const permission = kind === 'purchaseOrders' ? PERMISSIONS.PURCHASING_VIEW : kind === 'supplierBills' ? PERMISSIONS.SUPPLIER_BILLS_VIEW : PERMISSIONS.EXPENSES_VIEW;
  const feature = kind === 'purchaseOrders' ? 'purchasing' : kind === 'supplierBills' ? 'purchasing.bills' : 'expenses';
  await authorizeFirmJobActor(tx, firmId, actorId, permission);
  await assertTransactionFeature(tx, firmId, feature);
  const bounds = { gte: window.from, lt: window.until };
  const aggregate = { by: ['currency'] as ['currency'], _sum: { total: true as const }, _count: { _all: true as const }, orderBy: { currency: 'asc' as const } };
  const rows = kind === 'purchaseOrders'
    ? await tx.purchaseOrder.groupBy({ ...aggregate, where: { firmId, currency, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'] }, createdAt: bounds } })
    : kind === 'supplierBills'
      ? await tx.supplierBill.groupBy({ ...aggregate, where: { firmId, currency, status: 'POSTED', billDate: bounds } })
      : await tx.expense.groupBy({ ...aggregate, where: { firmId, currency, status: 'POSTED', expenseDate: bounds } });
  return rows.map((row) => ({ currency: row.currency, amount: money(row._sum.total ?? '0', currencyCode(row.currency)).amount, count: row._count._all }));
}
