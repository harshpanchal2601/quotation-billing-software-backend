import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { readBillingJournalSources } from '../src/modules/invoices/journal-sources.repository.js';

vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: vi.fn(async () => undefined) }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: vi.fn(async () => undefined) }));
import { billingJournal } from '../src/modules/reports/accounting.journal.js';
import { accountingMappingSchema } from '../src/modules/reports/accounting.schema.js';
import { dateWindow } from '../src/core/validation/date-window.js';
import { decimal } from '../src/core/money/index.js';

const mapping = accountingMappingSchema.parse({ receivables: 'AR', sales: 'SALES', outputTax: 'GST', rounding: 'ROUNDING' });
const window = dateWindow('2026-11-01', '2026-11-09');
const source = (extra: Partial<Parameters<typeof billingJournal>[0][number]> = {}): Parameters<typeof billingJournal>[0][number] => ({ id: 1, kind: 'INVOICE', currency: 'INR', documentNumber: 'INV-1', issuedAt: new Date('2026-11-05T00:00:00Z'), voidedAt: null, issueSnapshot: { status: 'ISSUED', currency: 'INR', documentNumber: 'INV-1', taxableAmount: '100.00', taxAmount: '18.00', roundOffAmount: '-0.01', grandTotal: '117.99' }, statusHistory: [{ version: 2, toStatus: 'ISSUED' }], ...extra });
describe('Wave 10 billing journal export projection', () => {
  it('reads only previously issued documents, including cancellations of earlier-period issues', async () => {
    const findMany = vi.fn().mockResolvedValue([source()]);
    const tx = { invoice: { findMany } } as unknown as Prisma.TransactionClient;
    const rows = await readBillingJournalSources(tx, 7, 11, window);
    expect(rows).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { firmId: 7, issuedAt: { not: null }, kind: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] }, OR: [{ issuedAt: { gte: window.from, lt: window.until } }, { voidedAt: { gte: window.from, lt: window.until } }] },
      take: 1001,
    }));
  });
  it('balances source snapshots with signed rounding and stable deduplication keys', () => {
    const rows = billingJournal([source()], mapping, window);
    expect(rows).toContainEqual(expect.objectContaining({ sourceEvent: 'billing:1:2:ISSUE', account: 'AR', debit: '117.99', credit: '0.00' }));
    expect(rows).toContainEqual(expect.objectContaining({ account: 'ROUNDING', debit: '0.01', credit: '0.00' }));
    expect(rows.reduce((sum, row) => sum.add(row.debit).sub(row.credit), decimal('0')).toString()).toBe('0');
  });
  it('reverses credit-note signs and emits a distinct compensating void event', () => {
    const rows = billingJournal([source({ kind: 'CREDIT_NOTE', voidedAt: new Date('2026-11-06T01:00:00Z'), statusHistory: [{ version: 2, toStatus: 'ISSUED' }, { version: 3, toStatus: 'VOID' }] })], mapping, window);
    expect(rows).toContainEqual(expect.objectContaining({ event: 'ISSUE', account: 'AR', credit: '117.99' }));
    expect(rows).toContainEqual(expect.objectContaining({ sourceEvent: 'billing:1:3:VOID', event: 'VOID', account: 'AR', debit: '117.99' }));
    expect(rows.reduce((sum, row) => sum.add(row.debit).sub(row.credit), decimal('0')).toString()).toBe('0');
  });
  it('does not re-emit an issue outside the period when its void is in the period', () => {
    const rows = billingJournal([source({ issuedAt: new Date('2026-10-30'), voidedAt: new Date('2026-11-02'), statusHistory: [{ version: 2, toStatus: 'ISSUED' }, { version: 3, toStatus: 'VOID' }] })], mapping, window);
    expect(rows.every((row) => row.event === 'VOID')).toBe(true);
    expect(rows.length).toBe(4);
  });
  it('fails closed on missing snapshots, history, currency mismatch and unbalanced sources', () => {
    for (const changed of [{ issueSnapshot: null }, { statusHistory: [] }, { currency: 'USD' }, { issueSnapshot: { ...(source().issueSnapshot as object), grandTotal: '999' } }]) expect(() => billingJournal([source(changed)], mapping, window)).toThrow();
    expect(() => accountingMappingSchema.parse({ ...mapping, sales: '=SUM(A1)' })).toThrow();
  });
});
