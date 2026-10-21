import type { Prisma } from '@prisma/client';

import { AppError } from '../../../core/errors/AppError.js';

export async function generateUniqueQuotationNumber(
  tx: Prisma.TransactionClient,
  settingsId: number,
  firmId: number,
  quotationDate: Date = new Date(),
): Promise<string> {
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // The increment locks the settings row until the owning create transaction commits.
    // Read the reserved value from this write, never from the earlier settings read.
    const reserved = await tx.quotationSetting.update({
      where: { id: settingsId },
      data: { nextSequenceNumber: { increment: 1 } },
    });
    const currentSeq = reserved.nextSequenceNumber - 1;
    const prefix = reserved.quotationPrefix || 'ERP';
    const fyString = getFinancialYearString(quotationDate, reserved.financialYearFormat || 'YYYY-YY');
    const paddedSeq = String(currentSeq).padStart(6, '0');
    const candidateNumber = `${prefix}/${fyString}/${paddedSeq}`;

    const existing = await tx.quotation.findFirst({
      where: { firmId, quotationNumber: candidateNumber },
      select: { id: true },
    });

    if (!existing) {
      return candidateNumber;
    }
  }

  throw new AppError('Quotation number could not be generated safely due to concurrency. Please retry.', 409);
}

export function getFinancialYearString(date: Date, format: string): string {
  const month = date.getUTCMonth() + 1; // Quotation dates are stored as UTC date-only values.
  const year = date.getUTCFullYear();

  const startYear = month >= 4 ? year : year - 1;
  const endYear = startYear + 1;

  const startYY = String(startYear).slice(-2);
  const endYY = String(endYear).slice(-2);

  if (format === 'YY-YY') {
    return `${startYY}-${endYY}`;
  }
  if (format === 'YYYY-YYYY') {
    return `${startYear}-${endYear}`;
  }
  // Default YYYY-YY
  return `${startYear}-${endYY}`;
}
