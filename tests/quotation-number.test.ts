import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { generateUniqueQuotationNumber, getFinancialYearString } from '../src/modules/quotations/numbering/quotation-number.js';

describe('quotation sequence reservation', () => {
  it('uses UTC quotation dates at the financial year boundary', () => {
    expect(getFinancialYearString(new Date('2026-03-31T00:00:00Z'), 'YYYY-YY')).toBe('2025-26');
    expect(getFinancialYearString(new Date('2026-04-01T00:00:00Z'), 'YYYY-YY')).toBe('2026-27');
  });
  it('uses the atomically reserved sequence and skips occupied legacy numbers', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 2 }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      quotationSetting: { findUniqueOrThrow: vi.fn().mockResolvedValue({ nextSequenceNumber: 1, quotationPrefix: 'ERP', financialYearFormat: 'YYYY-YY' }) },
      documentSequence: { findUniqueOrThrow: vi.fn().mockResolvedValueOnce({ nextValue: 42n }).mockResolvedValueOnce({ nextValue: 43n }) },
      quotation: { findFirst: vi.fn().mockResolvedValueOnce({ id: 9 }).mockResolvedValueOnce(null) },
    };
    await expect(generateUniqueQuotationNumber(
      tx as unknown as Prisma.TransactionClient, 2, 1,
      new Date('2026-10-21T00:00:00Z'),
    )).resolves.toBe('ERP/2026-27/000042');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(tx.documentSequence.findUniqueOrThrow).toHaveBeenCalledWith({ where: { firmId_documentType_period: { firmId: 1, documentType: 'QUOTATION', period: 'LEGACY' } } });
    expect(tx.quotation.findFirst).toHaveBeenLastCalledWith({
      where: { firmId: 1, quotationNumber: 'ERP/2026-27/000042' }, select: { id: true },
    });
  });
  it('denies settings belonging to another firm before reserving a number', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn() };
    await expect(generateUniqueQuotationNumber(tx as unknown as Prisma.TransactionClient, 2, 1)).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
