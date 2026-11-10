import type { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';
import type { DateWindow } from '../../core/validation/date-window.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature } from '../entitlements/index.js';

export async function readBillingJournalSources(tx: Prisma.TransactionClient, firmId: number, actorId: number, window: DateWindow) {
  await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.INVOICES_VIEW);
  await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.ADJUSTMENTS_VIEW);
  await assertTransactionFeature(tx, firmId, 'billing.invoices');
  await assertTransactionFeature(tx, firmId, 'billing.adjustments');
  const bounds = { gte: window.from, lt: window.until };
  const sources = await tx.invoice.findMany({ where: { firmId, kind: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] }, OR: [{ issuedAt: bounds }, { voidedAt: bounds }] }, select: { id: true, kind: true, currency: true, documentNumber: true, issuedAt: true, voidedAt: true, issueSnapshot: true, statusHistory: { where: { toStatus: { in: ['ISSUED', 'VOID'] } }, select: { version: true, toStatus: true }, orderBy: { version: 'asc' } } }, orderBy: { id: 'asc' }, take: 1001 });
  if (sources.length > 1000) throw new AppError('Accounting export exceeds 1000 source documents; select a shorter period', 413);
  return sources;
}
