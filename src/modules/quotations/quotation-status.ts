import { QuotationStatus, type Prisma, type PrismaClient } from '@prisma/client';

import { AppError } from '../../core/errors/AppError.js';

const ALLOWED_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  [QuotationStatus.DRAFT]: [QuotationStatus.PENDING, QuotationStatus.SENT, QuotationStatus.CANCELLED],
  [QuotationStatus.PENDING]: [QuotationStatus.SENT, QuotationStatus.ACCEPTED, QuotationStatus.REJECTED, QuotationStatus.CANCELLED],
  [QuotationStatus.SENT]: [QuotationStatus.ACCEPTED, QuotationStatus.REJECTED, QuotationStatus.EXPIRED, QuotationStatus.CANCELLED],
  [QuotationStatus.ACCEPTED]: [QuotationStatus.COMPLETED, QuotationStatus.CANCELLED],
  [QuotationStatus.REJECTED]: [],
  [QuotationStatus.COMPLETED]: [],
  [QuotationStatus.EXPIRED]: [],
  [QuotationStatus.CANCELLED]: [],
};

export function validateStatusTransition(currentStatus: QuotationStatus, targetStatus: QuotationStatus): void {
  if (currentStatus === targetStatus) {
    throw new AppError(`Quotation is already in status ${targetStatus}.`, 400);
  }

  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(targetStatus)) {
    throw new AppError(`Invalid quotation status transition from ${currentStatus} to ${targetStatus}.`, 409);
  }
}

export function getStatusTimestampUpdate(targetStatus: QuotationStatus): Record<string, Date> {
  const now = new Date();
  switch (targetStatus) {
    case QuotationStatus.SENT:
      return { sentAt: now };
    case QuotationStatus.ACCEPTED:
      return { acceptedAt: now };
    case QuotationStatus.REJECTED:
      return { rejectedAt: now };
    case QuotationStatus.COMPLETED:
      return { completedAt: now };
    default:
      return {};
  }
}

export async function recordStatusHistory(
  db: PrismaClient | Prisma.TransactionClient,
  quotationId: number,
  fromStatus: QuotationStatus | null,
  toStatus: QuotationStatus,
  changedById: number,
  comment?: string | null,
): Promise<void> {
  await db.quotationStatusHistory.create({
    data: {
      quotationId,
      fromStatus,
      toStatus,
      changedById,
      comment: comment ?? null,
    },
  });
}
