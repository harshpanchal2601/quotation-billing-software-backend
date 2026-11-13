import type { Prisma, PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors/AppError.js';
import { DEFAULT_INVOICE_SETTINGS, readInvoiceSettings } from '../src/modules/invoices/invoice-settings.repository.js';
import { InvoicesRepository } from '../src/modules/invoices/invoices.repository.js';
import { withFirmEntitlementTransaction } from '../src/modules/entitlements/index.js';

const access = vi.hoisted(() => ({ feature: vi.fn() }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: vi.fn() }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: access.feature, withFirmEntitlementTransaction: vi.fn() }));

function fixture(managed: boolean) {
  const config = { ...DEFAULT_INVOICE_SETTINGS, customFields: [{ key: 'cf_project', label: 'Project', type: 'TEXT', required: false, showOnPdf: true, width: 'FULL', options: [] }] };
  const db = {
    invoiceSetting: { findUnique: vi.fn().mockResolvedValue({ version: 7, config }) },
    automationDefinitionVersion: { findFirst: vi.fn().mockResolvedValue(managed ? { id: 1 } : null) },
  };
  return { db: db as unknown as Prisma.TransactionClient, config };
}
beforeEach(() => vi.resetAllMocks());
describe('Wave 08 invoice field entitlement and historical settings', () => {
  it.each([50, 51])('checks a lookahead entry before advertising more history for %i rows', async (count) => {
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: count }, (_, index) => ({ id: index + 1 })));
    const tx = { invoice: { findFirst: vi.fn().mockResolvedValue({ id: 11 }) }, customFieldValueVersion: { findMany } };
    vi.mocked(withFirmEntitlementTransaction).mockImplementation(async (_db, _firmId, work) => work(tx as unknown as Prisma.TransactionClient));
    const result = await new InvoicesRepository({} as PrismaClient).fieldHistory(1, 10, 11, 'INVOICE', 2, { sortBy: 'createdAt', sortOrder: 'asc' });
    expect(result.history).toHaveLength(50);
    expect(result.pagination).toEqual({ page: 2, limit: 50, hasMore: count > 50 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51, skip: 50, where: { firmId: 1, entity: 'INVOICE', entityId: 11 }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }));
  });
  it('rejects a changed reviewed configuration before writing values or history', async () => {
    const { db } = fixture(false);
    const write = vi.fn(); const history = vi.fn();
    const tx = { ...db, invoice: { findFirst: vi.fn().mockResolvedValue({ id: 11, status: 'DRAFT', version: 2, customFieldSchema: [] }), updateMany: write }, invoiceStatusHistory: { create: history } };
    vi.mocked(withFirmEntitlementTransaction).mockImplementation(async (_db, _firmId, work) => work(tx as unknown as Prisma.TransactionClient));
    const repository = new InvoicesRepository({} as PrismaClient);
    await expect(repository.updateCustomValues(1, 10, 11, 'INVOICE', 2, {}, true, {}, 6)).rejects.toMatchObject({ statusCode: 409 });
    expect(write).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled();
  });
  it('does not record history when the conditional draft update loses a concurrent change', async () => {
    const write = vi.fn().mockResolvedValue({ count: 0 }); const history = vi.fn();
    const tx = { invoice: { findFirst: vi.fn().mockResolvedValue({ id: 11, status: 'DRAFT', version: 2, customFieldSchema: [] }), updateMany: write }, invoiceStatusHistory: { create: history } };
    vi.mocked(withFirmEntitlementTransaction).mockImplementation(async (_db, _firmId, work) => work(tx as unknown as Prisma.TransactionClient));
    const repository = new InvoicesRepository({} as PrismaClient);
    await expect(repository.updateCustomValues(1, 10, 11, 'INVOICE', 2, {}, false, {})).rejects.toMatchObject({ statusCode: 409 });
    expect(write).toHaveBeenCalledOnce(); expect(history).not.toHaveBeenCalled();
  });
  it('rejects changed effective field access even when the saved settings version is unchanged', async () => {
    const { db } = fixture(true);
    const write = vi.fn();
    const tx = { ...db, invoice: { findFirst: vi.fn().mockResolvedValue({ id: 11, status: 'DRAFT', version: 2, customFieldSchema: [] }), updateMany: write } };
    access.feature.mockImplementation(async (_db, _firmId, feature) => { if (feature === 'automation') throw new AppError('Feature unavailable', 403); });
    vi.mocked(withFirmEntitlementTransaction).mockImplementation(async (_db, _firmId, work) => work(tx as unknown as Prisma.TransactionClient));
    const repository = new InvoicesRepository({} as PrismaClient);
    await expect(repository.updateCustomValues(1, 10, 11, 'INVOICE', 2, { cf_project: 'Reviewed project' }, true, {}, 7)).rejects.toMatchObject({ statusCode: 409 });
    expect(write).not.toHaveBeenCalled();
  });
  it('omits managed fields only from new work when automation is denied', async () => {
    const { db, config } = fixture(true);
    access.feature.mockRejectedValue(new AppError('Feature unavailable', 403));
    expect(await readInvoiceSettings(db, 1, true)).toEqual({ version: 7, config: { ...config, customFields: [] } });
    expect(await readInvoiceSettings(db, 1)).toEqual({ version: 7, config });
    expect(access.feature).toHaveBeenCalledTimes(1);
  });
  it('retains existing invoice fields for legacy settings and entitled new drafts', async () => {
    const legacy = fixture(false);
    expect(await readInvoiceSettings(legacy.db, 1, true)).toEqual({ version: 7, config: legacy.config });
    expect(access.feature).not.toHaveBeenCalled();
    const managed = fixture(true);
    expect(await readInvoiceSettings(managed.db, 1, true)).toEqual({ version: 7, config: managed.config });
    expect(access.feature).toHaveBeenCalledWith(managed.db, 1, 'automation');
  });
  it('propagates operational errors instead of silently stripping configured fields', async () => {
    const { db } = fixture(true);
    access.feature.mockRejectedValue(new Error('Database unavailable'));
    await expect(readInvoiceSettings(db, 1, true)).rejects.toThrow('Database unavailable');
  });
});
