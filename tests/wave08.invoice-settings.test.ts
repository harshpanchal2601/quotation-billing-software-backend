import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors/AppError.js';
import { DEFAULT_INVOICE_SETTINGS, readInvoiceSettings } from '../src/modules/invoices/invoice-settings.repository.js';

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
