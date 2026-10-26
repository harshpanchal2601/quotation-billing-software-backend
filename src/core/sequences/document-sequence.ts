import type { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';

export type SequenceReset = 'NEVER' | 'CALENDAR_YEAR' | 'FINANCIAL_YEAR';
export function sequencePeriod(date: Date, reset: SequenceReset, financialYearStartMonth = 4) {
  if (!Number.isFinite(date.getTime()) || !Number.isInteger(financialYearStartMonth) || financialYearStartMonth < 1 || financialYearStartMonth > 12) throw new Error('Invalid sequence period');
  const year = date.getUTCFullYear();
  if (reset === 'NEVER') return 'ALL';
  if (reset === 'CALENDAR_YEAR') return `CY:${year}`;
  if (reset !== 'FINANCIAL_YEAR') throw new Error('Unsupported sequence reset rule');
  return `FY:${date.getUTCMonth() + 1 >= financialYearStartMonth ? year : year - 1}:${financialYearStartMonth}`;
}

// The owning resource MUST be written in this transaction. A rollback returns
// its reservation. The unique scope and atomic update serialize concurrent writers.
export async function reserveDocumentSequence(tx: Prisma.TransactionClient, scope: {
  firmId: number; documentType: string; period: string;
}, initialValue = 1n) {
  if (!Number.isSafeInteger(scope.firmId) || scope.firmId <= 0 || !/^[A-Z][A-Z0-9_]{0,31}$/.test(scope.documentType) || !/^[A-Z0-9:_-]{1,32}$/.test(scope.period) || initialValue < 1n || initialValue >= 9223372036854775807n) throw new Error('Invalid document sequence scope');
  // MySQL Prisma upserts may use a read-then-create path. Use native SQL so
  // concurrent first reservations serialize on the unique key too.
  await tx.$executeRaw`INSERT INTO document_sequences (firm_id, document_type, period, next_value, updated_at)
    VALUES (${scope.firmId}, ${scope.documentType}, ${scope.period}, ${initialValue + 1n}, UTC_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE next_value = next_value + 1, updated_at = UTC_TIMESTAMP(3)`;
  const reserved = await tx.documentSequence.findUniqueOrThrow({ where: { firmId_documentType_period: scope } });
  if (reserved.nextValue > 9223372036854775807n) throw new AppError('Document sequence exhausted', 409);
  return reserved.nextValue - 1n;
}
