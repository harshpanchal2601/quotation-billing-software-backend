import type { Prisma, PrismaClient } from '@prisma/client';

import { AppError } from '../../../core/errors/AppError.js';
import { getOrCreateQuotationSettings } from '../../settings/index.js';

export async function generateUniqueQuotationNumber(
  tx: Prisma.TransactionClient,
  dbForSetting: PrismaClient,
  quotationDate: Date = new Date(),
): Promise<string> {
  const settings = await getOrCreateQuotationSettings(dbForSetting);

  const prefix = settings.quotationPrefix || 'BUMINEX';
  const fyFormat = settings.financialYearFormat || 'YYYY-YY';
  const fyString = getFinancialYearString(quotationDate, fyFormat);

  const maxAttempts = 5;
  let currentSeq = settings.nextSequenceNumber;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const paddedSeq = String(currentSeq).padStart(6, '0');
    const candidateNumber = `${prefix}/${fyString}/${paddedSeq}`;

    const existing = await tx.quotation.findFirst({
      where: { quotationNumber: candidateNumber },
      select: { id: true },
    });

    if (!existing) {
      await tx.quotationSetting.update({
        where: { id: settings.id },
        data: { nextSequenceNumber: currentSeq + 1 },
      });
      return candidateNumber;
    }

    currentSeq += 1;
  }

  throw new AppError('Quotation number could not be generated safely due to concurrency. Please retry.', 409);
}

export function getFinancialYearString(date: Date, format: string): string {
  const month = date.getMonth() + 1; // 1-12
  const year = date.getFullYear();

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
