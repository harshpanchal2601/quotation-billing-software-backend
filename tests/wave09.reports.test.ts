import { Prisma, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors/AppError.js';
import { readAssistantSales } from '../src/modules/invoices/assistant-read.repository.js';

const guards = vi.hoisted(() => ({ actor: vi.fn(), feature: vi.fn() }));
vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: guards.actor }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: guards.feature }));
vi.mock('../src/modules/invoices/invoices.repository.js', () => ({ invoicesRepository: {} }));
beforeEach(() => vi.resetAllMocks());
describe('Wave 09 domain sales report accuracy', () => {
  function fixture() {
    const groupBy = vi.fn().mockResolvedValue([
      { currency: 'INR', kind: 'INVOICE', _sum: { grandTotal: new Prisma.Decimal('900719925474099312345.12') }, _count: { _all: 2 } },
      { currency: 'INR', kind: 'CREDIT_NOTE', _sum: { grandTotal: new Prisma.Decimal('0.01') }, _count: { _all: 1 } },
      { currency: 'USD', kind: 'INVOICE', _sum: { grandTotal: new Prisma.Decimal('1.25') }, _count: { _all: 1 } },
      { currency: 'KWD', kind: 'DEBIT_NOTE', _sum: { grandTotal: new Prisma.Decimal('0.001') }, _count: { _all: 1 } },
    ]);
    const tx = { invoice: { groupBy } };
    const db = { $transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
    return { db, groupBy };
  }
  it('preserves precision beyond Number and keeps currencies separate after credits', async () => {
    const { db, groupBy } = fixture();
    const report = await readAssistantSales(1, 10, { dateFrom: '2026-11-01', dateTo: '2026-11-09' }, db);
    expect(report.currencies).toEqual([{ currency: 'INR', netSales: '900719925474099312345.11', documents: 3 }, { currency: 'USD', netSales: '1.25', documents: 1 }, { currency: 'KWD', netSales: '0.001', documents: 1 }]);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ firmId: 1, status: 'ISSUED', kind: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] }, invoiceDate: { gte: new Date('2026-11-01'), lte: new Date('2026-11-09') } }) }));
  });
  it('denies the report before reading when adjustment access is revoked', async () => {
    const { db, groupBy } = fixture();
    guards.actor.mockResolvedValueOnce({ id: 10 }).mockRejectedValueOnce(new AppError('Adjustment access denied', 403));
    await expect(readAssistantSales(1, 10, {}, db)).rejects.toMatchObject({ statusCode: 403 }); expect(groupBy).not.toHaveBeenCalled();
  });
  it('returns an empty report without inventing totals', async () => {
    const { db, groupBy } = fixture(); groupBy.mockResolvedValue([]);
    expect((await readAssistantSales(1, 10, {}, db)).currencies).toEqual([]);
  });
});
