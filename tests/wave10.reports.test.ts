import { Prisma, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors/AppError.js';
import { reportCsv } from '../src/modules/reports/reports.csv.js';
import { ReportsRepository } from '../src/modules/reports/reports.repository.js';
import { reportQuerySchema } from '../src/modules/reports/reports.schema.js';

const mocks = vi.hoisted(() => ({ actor: vi.fn(), feature: vi.fn(), quotations: vi.fn(), sales: vi.fn(), receivables: vi.fn(), stock: vi.fn(), pipeline: vi.fn(), purchasing: vi.fn() }));
vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/modules/connections/events.js', () => ({ enqueueReportExported: vi.fn() }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: mocks.actor }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: mocks.feature, withFirmEntitlementTransaction: (db: PrismaClient, _firm: number, work: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(work) }));
vi.mock('../src/modules/quotations/index.js', () => ({ readQuotationReport: mocks.quotations }));
vi.mock('../src/modules/invoices/index.js', () => ({ readSalesReport: mocks.sales }));
vi.mock('../src/modules/payments/index.js', () => ({ readReceivablesSummary: mocks.receivables }));
vi.mock('../src/modules/inventory/index.js', () => ({ readStockValuation: mocks.stock }));
vi.mock('../src/modules/crm/index.js', () => ({ readPipelineReport: mocks.pipeline }));
vi.mock('../src/modules/purchasing/index.js', () => ({ readPurchasingReport: mocks.purchasing }));

const filters = () => reportQuerySchema.parse({ dateFrom: '2026-11-01', dateTo: '2026-11-09', sections: 'sales' });
function fixture() {
  const tx = { auditLog: { create: vi.fn() }, savedReportView: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() } };
  const transaction = vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => work(tx));
  return { tx, transaction, repository: new ReportsRepository({ $transaction: transaction } as unknown as PrismaClient) };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.sales.mockResolvedValue({ currencies: [{ currency: 'INR', netSales: '9007199254740993.01', documents: 1 }, { currency: 'KWD', netSales: '-0.001', documents: 1 }] });
});
describe('Wave 10 reporting authorization and export integrity', () => {
  it('keeps the complete response on a repeatable DB snapshot and retains currency strings', async () => {
    const { repository, transaction, tx } = fixture();
    const report = await repository.overview(1, 10, filters());
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
    expect(mocks.sales).toHaveBeenCalledWith(tx, 1, 10, filters());
    expect(report.currencyPolicy).toBe('SEGMENTED_NO_CONVERSION');
    expect(report.sections[0]).toMatchObject({ status: 'AVAILABLE', data: { metrics: expect.arrayContaining([{ key: 'netSales', label: 'Net document sales', currency: 'INR', dimension: null, unit: 'MONEY', value: '9007199254740993.01' }, { key: 'netSales', label: 'Net document sales', currency: 'KWD', dimension: null, unit: 'MONEY', value: '-0.001' }]) } });
  });
  it('does not touch domain sources after root role or plan denial', async () => {
    const { repository } = fixture(); mocks.actor.mockRejectedValueOnce(new AppError('Denied', 403));
    await expect(repository.overview(1, 10, filters())).rejects.toMatchObject({ statusCode: 403 }); expect(mocks.sales).not.toHaveBeenCalled();
    mocks.feature.mockRejectedValueOnce(new AppError('Denied', 403));
    await expect(repository.overview(1, 10, filters())).rejects.toMatchObject({ statusCode: 403 }); expect(mocks.sales).not.toHaveBeenCalled();
  });
  it('returns denied sections without data and propagates reconciliation or infrastructure failures', async () => {
    const { repository } = fixture(); mocks.sales.mockRejectedValueOnce(new AppError('Denied', 403));
    expect((await repository.overview(1, 10, filters())).sections).toEqual([{ key: 'sales', status: 'UNAVAILABLE' }]);
    mocks.sales.mockRejectedValueOnce(new AppError('Unreconciled', 409));
    await expect(repository.overview(1, 10, filters())).rejects.toMatchObject({ statusCode: 409 });
    mocks.sales.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(repository.overview(1, 10, filters())).rejects.toThrow('Database unavailable');
  });
  it('blocks export independently of view permission and fails closed when audit fails', async () => {
    const { repository, tx } = fixture();
    mocks.actor.mockImplementation(async (_tx, _firm, _actor, permission) => { if (permission === 'reports.export') throw new AppError('Denied', 403); });
    await expect(repository.exportCsv(1, 10, filters(), {})).rejects.toMatchObject({ statusCode: 403 }); expect(mocks.sales).not.toHaveBeenCalled();
    mocks.actor.mockResolvedValue(undefined); tx.auditLog.create.mockRejectedValueOnce(new Error('Audit unavailable'));
    await expect(repository.exportCsv(1, 10, filters(), {})).rejects.toThrow('Audit unavailable');
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ firmId: 1, userId: 10, entityType: 'ReportExport' }) }));
  });
  it('caps closing stock at generation time and labels receivables as current', async () => {
    const { repository } = fixture(); mocks.stock.mockResolvedValue([]); mocks.receivables.mockResolvedValue({ asOf: '2026-11-09', timezone: 'Asia/Kolkata', buckets: [], customerCredits: [] });
    const query = reportQuerySchema.parse({ dateFrom: '2090-01-01', dateTo: '2090-01-31', sections: 'stock,receivables' });
    const report = await repository.overview(1, 10, query);
    expect(mocks.stock.mock.calls[0]![3]).toEqual(new Date(report.generatedAt));
    expect(mocks.receivables.mock.calls[0]![4]).toEqual(new Date(report.generatedAt));
    expect(report.sections[1]).toMatchObject({ data: { dateBasis: 'CURRENT', asOf: '2026-11-09', timezone: 'Asia/Kolkata' } });
  });
  it('scopes saved views by both actor and firm and refuses foreign IDs or stale writes', async () => {
    const { repository, tx } = fixture(); tx.savedReportView.findMany.mockResolvedValue([]); tx.savedReportView.count.mockResolvedValue(0);
    await repository.listViews(1, 10, { page: 1, limit: 20 });
    expect(tx.savedReportView.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 1, actorId: 10 } }));
    const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    await expect(repository.saveView(1, 10, { name: 'Private', filters: filters(), expectedVersion: 1 }, {}, id)).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.savedReportView.findFirst).toHaveBeenCalledWith({ where: { id, firmId: 1, actorId: 10 } });
    tx.savedReportView.findFirst.mockResolvedValue({ id, version: 2 });
    await expect(repository.saveView(1, 10, { name: 'Private', filters: filters(), expectedVersion: 1 }, {}, id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(repository.deleteView(1, 10, id, 1, {})).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.savedReportView.update).not.toHaveBeenCalled(); expect(tx.savedReportView.delete).not.toHaveBeenCalled();
  });
  it('quotes CSV text, neutralizes formulas and preserves negative numeric amounts', async () => {
    const { repository } = fixture(); const report = await repository.overview(1, 10, filters());
    const section = report.sections[0]!; if (section.status !== 'AVAILABLE') throw new Error('Expected source report');
    section.data.metrics[0]!.dimension = ' \t=HYPERLINK("example.invalid")';
    const csv = reportCsv(report);
    expect(csv).toContain('"\' \t=HYPERLINK(""example.invalid"")"');
    expect(csv).toContain('"-0.001"'); expect(csv).toContain('"9007199254740993.01"');
    expect(csv.endsWith('\r\n')).toBe(true); expect(csv).toContain('"SEGMENTED_NO_CONVERSION"');
  });
});
