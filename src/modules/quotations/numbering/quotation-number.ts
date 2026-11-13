import type { Prisma } from '@prisma/client';

import { AppError } from '../../../core/errors/AppError.js';
import { reserveDocumentSequence } from '../../../core/sequences/index.js';

export async function generateUniqueQuotationNumber(
  tx: Prisma.TransactionClient,
  settingsId: number,
  firmId: number,
  quotationDate: Date = new Date(),
): Promise<string> {
  // Lock the legacy settings scope for lazy initialization as well as settings
  // edits. Migration seeds the high-water mark; fresh firms initialize here.
  const rows = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT s.id FROM quotation_settings s JOIN business_profiles p ON p.id = s.business_profile_id
    WHERE s.id = ${settingsId} AND p.firm_id = ${firmId} FOR UPDATE`;
  if (rows.length !== 1) throw new AppError('Quotation settings not found', 404);
  const settings = await tx.quotationSetting.findUniqueOrThrow({ where: { id: settingsId } });
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const currentSeq = await reserveDocumentSequence(tx, { firmId, documentType: 'QUOTATION', period: 'LEGACY' }, BigInt(settings.nextSequenceNumber));
    const prefix = settings.quotationPrefix || 'ERP';
    const fyString = getFinancialYearString(quotationDate, settings.financialYearFormat || 'YYYY-YY');
    const paddedSeq = String(currentSeq).padStart(6, '0');
    const candidateNumber = `${prefix}/${fyString}/${paddedSeq}`;
    if (candidateNumber.length > 50) throw new AppError('Quotation number exceeds its supported length', 409);

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
