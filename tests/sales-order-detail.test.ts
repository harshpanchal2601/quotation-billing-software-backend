import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { SalesOrdersRepository } from '../src/modules/sales-orders/sales-orders.repository.js';
import { salesDetailSchema } from '../src/modules/sales-orders/sales-orders.schema.js';

vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: vi.fn() }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: vi.fn() }));
vi.mock('../src/modules/settings/index.js', () => ({ assertSalesCapability: vi.fn() }));

function fixture() {
  const row = { id: 9, status: 'CANCELLED', lines: [], history: [], fulfillments: [], _count: { history: 61, fulfillments: 45, invoices: 23 } };
  const tx = { salesOrder: { findFirst: vi.fn().mockResolvedValue(row) }, invoice: { findMany: vi.fn().mockResolvedValue([]) } };
  const db = { $transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
  return { tx, repository: new SalesOrdersRepository(db) };
}

describe('sales order detail read windows', () => {
  it('sorts and pages each history in the database with stable ties and the firm boundary', async () => {
    const { tx, repository } = fixture();
    const result = await repository.get(3, 8, 9, salesDetailSchema.parse({ historyPage: '2', historySortBy: 'status', historySortOrder: 'asc', completionPage: '3', completionSortBy: 'reference', completionSortOrder: 'asc', invoicePage: '1', invoiceSortBy: 'documentNumber', invoiceSortOrder: 'desc' }));
    expect(tx.salesOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9, firmId: 3 }, include: expect.objectContaining({
      history: { orderBy: [{ status: 'asc' }, { id: 'asc' }], skip: 20, take: 20 },
      fulfillments: { orderBy: [{ reference: 'asc' }, { id: 'asc' }], skip: 40, take: 20, include: { lines: { orderBy: { id: 'asc' } } } },
    }) }));
    expect(tx.invoice.findMany).toHaveBeenCalledWith({ where: { firmId: 3, sourceSalesOrderId: 9 }, select: { id: true, documentNumber: true, status: true }, orderBy: [{ documentNumber: 'desc' }, { id: 'desc' }], skip: 0, take: 20 });
    expect(result.pagination).toEqual({ history: { page: 2, limit: 20, total: 61 }, completions: { page: 3, limit: 20, total: 45 }, invoices: { page: 1, limit: 20, total: 23 } });
  });
  it('preserves legacy shared history paging and rejects unsupported sorts or pages', async () => {
    const { tx, repository } = fixture();
    await repository.get(3, 8, 9, 2);
    expect(tx.salesOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({ history: expect.objectContaining({ skip: 20 }), fulfillments: expect.objectContaining({ skip: 20 }) }) }));
    expect(tx.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20 }));
    expect(salesDetailSchema.safeParse({ completionSortBy: 'requestHash' }).success).toBe(false);
    expect(salesDetailSchema.safeParse({ invoicePage: '1.5' }).success).toBe(false);
    expect(salesDetailSchema.safeParse({ historyPage: '100001' }).success).toBe(false);
  });
});
