import type { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';

// Billing selects an exact revision. Never resolve the mutable latest-family pointer.
export async function readAcceptedQuotationForBilling(tx: Prisma.TransactionClient, firmId: number, revisionId: number) {
  const rows = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM quotations WHERE id = ${revisionId} AND firm_id = ${firmId} AND deleted_at IS NULL FOR UPDATE`;
  if (rows.length !== 1) throw new AppError('Quotation revision not found', 404);
  const source = await tx.quotation.findFirst({ where: { id: revisionId, firmId, deletedAt: null }, include: { items: { orderBy: { lineNumber: 'asc' } } } });
  if (!source) throw new AppError('Quotation revision not found', 404);
  if (source.status !== 'ACCEPTED') throw new AppError('Only an accepted quotation revision can be converted', 409);
  return source;
}
