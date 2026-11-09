import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors/AppError.js';
import { dateWindow } from '../src/core/validation/date-window.js';
import { readQuotationReport } from '../src/modules/quotations/quotation-report.repository.js';
import { readStockValuation } from '../src/modules/inventory/stock-report.repository.js';
import { readPurchasingReport } from '../src/modules/purchasing/purchasing-report.repository.js';
import { CrmRepository } from '../src/modules/crm/crm.repository.js';
import { ReceivablesRepository } from '../src/modules/payments/receivables.repository.js';
import { reportQuerySchema } from '../src/modules/reports/reports.schema.js';

const guards = vi.hoisted(() => ({ actor: vi.fn(), feature: vi.fn(), payment: vi.fn() }));
vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: guards.actor }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: guards.feature, withFirmEntitlementTransaction: vi.fn() }));
vi.mock('../src/modules/companies/index.js', () => ({ createCompanyForSales: vi.fn() }));
vi.mock('../src/modules/invoices/index.js', () => ({ billingToday: () => '2026-11-09', readInvoiceSettlement: vi.fn() }));
vi.mock('../src/modules/payments/payments.repository.js', () => ({ authorizePayment: guards.payment }));

const window = dateWindow('2026-11-01', '2026-11-09');
beforeEach(() => { vi.resetAllMocks(); guards.actor.mockResolvedValue({ accountType: 'FIRM_ADMIN' }); });
describe('Wave 10 domain report definitions', () => {
  it('segments latest quotation conversion and preserves amounts above Number precision', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { currency: 'INR', status: 'ACCEPTED', _sum: { grandTotal: new Prisma.Decimal('9007199254740993.01') }, _count: { _all: 1 } },
      { currency: 'INR', status: 'REJECTED', _sum: { grandTotal: new Prisma.Decimal('0.02') }, _count: { _all: 2 } },
      { currency: 'USD', status: 'COMPLETED', _sum: { grandTotal: new Prisma.Decimal('1.05') }, _count: { _all: 1 } },
    ]);
    const rows = await readQuotationReport({ quotation: { groupBy } } as unknown as Prisma.TransactionClient, 10, 20, window);
    expect(rows).toEqual([
      { currency: 'INR', count: 3, acceptedCount: 1, value: '9007199254740993.03', acceptedValue: '9007199254740993.01', conversionRate: '33.33' },
      { currency: 'USD', count: 1, acceptedCount: 1, value: '1.05', acceptedValue: '1.05', conversionRate: '100.00' },
    ]);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 10, deletedAt: null, isLatestRevision: true, currency: undefined, quotationDate: { gte: new Date('2026-11-01'), lt: new Date('2026-11-10') } } }));
  });
  it('does not query quotation sources when source access is denied', async () => {
    guards.feature.mockRejectedValueOnce(new AppError('Denied', 403)); const groupBy = vi.fn();
    await expect(readQuotationReport({ quotation: { groupBy } } as unknown as Prisma.TransactionClient, 10, 20, window)).rejects.toMatchObject({ statusCode: 403 });
    expect(groupBy).not.toHaveBeenCalled();
  });
  it('uses tenant-owned signed movements and preserves six-place valuation', async () => {
    const raw = vi.fn().mockResolvedValue([{ currency: 'INR', value: new Prisma.Decimal('9007199254740993.123456'), positions: 3n }]);
    const until = new Date('2026-11-10');
    expect(await readStockValuation({ $queryRaw: raw } as unknown as Prisma.TransactionClient, 10, 20, until, 'INR')).toEqual([{ currency: 'INR', value: '9007199254740993.123456', positions: '3' }]);
    const sql = raw.mock.calls[0]![0] as Prisma.Sql;
    expect(sql.sql).toContain('p.firm_id = m.firm_id'); expect(sql.sql).toContain('SUM(m.value)');
    expect(sql.sql).toContain('m.firm_id = ? AND p.firm_id = ?'); expect(sql.values).toEqual([10, 10, until, 'INR']);
  });
  it('includes partially received commitments while keeping bills and expenses independent', async () => {
    const rows = [{ currency: 'KWD', _sum: { total: new Prisma.Decimal('1.001') }, _count: { _all: 1 } }];
    const order = vi.fn().mockResolvedValue(rows), bill = vi.fn().mockResolvedValue(rows), expense = vi.fn().mockResolvedValue(rows);
    const tx = { purchaseOrder: { groupBy: order }, supplierBill: { groupBy: bill }, expense: { groupBy: expense } } as unknown as Prisma.TransactionClient;
    expect(await readPurchasingReport(tx, 10, 20, 'purchaseOrders', window)).toEqual([{ currency: 'KWD', amount: '1.001', count: 1 }]);
    expect(order).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ firmId: 10, status: { in: ['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED'] }, createdAt: { gte: window.from, lt: window.until } }) }));
    await readPurchasingReport(tx, 10, 20, 'supplierBills', window, 'KWD'); await readPurchasingReport(tx, 10, 20, 'expenses', window);
    expect(bill).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 10, currency: 'KWD', status: 'POSTED', billDate: { gte: window.from, lt: window.until } } }));
    expect(expense).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 10, currency: undefined, status: 'POSTED', expenseDate: { gte: window.from, lt: window.until } } }));
  });
  it('retains CRM owner/creator scope instead of broadening reports to the entire firm', async () => {
    guards.actor.mockResolvedValue({ accountType: 'FIRM_USER', firmRole: { permissions: ['crm.view'] } });
    const groupBy = vi.fn().mockResolvedValue([]); const tx = { opportunity: { groupBy } } as unknown as Prisma.TransactionClient;
    const repository = new CrmRepository({} as never);
    expect((await repository.pipelineReport(tx, 10, 20, window)).scope).toBe('OWNED_OR_CREATED');
    expect(groupBy).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ firmId: 10, OR: [{ ownerId: 20 }, { createdById: 20 }] }) }));
    guards.actor.mockResolvedValue({ accountType: 'FIRM_USER', firmRole: { permissions: ['crm.view', 'crm.view-all'] } });
    expect((await repository.pipelineReport(tx, 10, 20, window)).scope).toBe('FIRM');
    expect(groupBy.mock.calls[1]![0].where.OR).toBeUndefined();
  });
  it('reuses full-ledger receivables aggregates without reading a page of customer details', async () => {
    const raw = vi.fn().mockResolvedValueOnce([{ count: 0n }])
      .mockResolvedValueOnce([{ currency: 'KWD', bucket: 'CURRENT', amount: new Prisma.Decimal('12.001'), count: 4n }])
      .mockResolvedValueOnce([{ currency: 'KWD', unapplied: new Prisma.Decimal('2.001') }]);
    const summary = await new ReceivablesRepository({} as never).summary({ $queryRaw: raw } as unknown as Prisma.TransactionClient, 10, 20, 'KWD');
    expect(summary).toEqual({ asOf: '2026-11-09', timezone: 'Asia/Kolkata', buckets: [{ currency: 'KWD', bucket: 'CURRENT', amount: '12.001', count: 4 }], customerCredits: [{ currency: 'KWD', unapplied: '2.001' }] });
    expect(raw).toHaveBeenCalledTimes(3);
    for (const [query] of raw.mock.calls) {
      const sql = query as Prisma.Sql; expect(sql.values).toContain(10);
      expect(sql.sql).not.toContain('LIMIT'); expect(sql.sql).toContain('r.id IS NULL');
    }
  });
  it('rejects unsupported receivables currencies before querying balances', async () => {
    const raw = vi.fn();
    await expect(new ReceivablesRepository({} as never).summary({ $queryRaw: raw } as unknown as Prisma.TransactionClient, 10, 20, 'AUD')).rejects.toMatchObject({
      name: 'ZodError', issues: [expect.objectContaining({ path: ['currency'] })],
    });
    expect(raw).not.toHaveBeenCalled();
  });
  it('rejects unreconciled balances instead of reporting a plausible zero', async () => {
    const raw = vi.fn().mockResolvedValue([{ count: 1n }]);
    await expect(new ReceivablesRepository({} as never).summary({ $queryRaw: raw } as unknown as Prisma.TransactionClient, 10, 20)).rejects.toMatchObject({ statusCode: 409 });
    expect(raw).toHaveBeenCalledTimes(1);
  });
});

describe('Wave 10 query boundaries', () => {
  it('uses exclusive next-day UTC boundaries across leap years and year changes', () => {
    expect(dateWindow('2024-02-29', '2024-02-29').until.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(dateWindow('2026-12-31', '2026-12-31').until.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
  it.each([
    { dateFrom: '2026-02-30', dateTo: '2026-03-01' },
    { dateFrom: '2026-11-10', dateTo: '2026-11-09' },
    { dateFrom: '2020-01-01', dateTo: '2026-11-09' },
    { dateFrom: '2026-11-01', dateTo: '2026-11-09', firmId: 2 },
    { dateFrom: '2026-11-01', dateTo: '2026-11-09', sections: 'sales,sales' },
    { dateFrom: '2026-11-01', dateTo: '2026-11-09', sections: [] },
  ])('rejects malformed or unbounded inputs %j', (input) => { expect(reportQuerySchema.safeParse(input).success).toBe(false); });
});
