import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PurchasingRepository } from '../src/modules/purchasing/purchasing.repository.js';
import { purchaseListSchema } from '../src/modules/purchasing/purchasing.schema.js';

vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: vi.fn() }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: vi.fn() }));

describe('goods receipt read projection', () => {
  it('preserves firm, supplier and paging boundaries while including immutable source identities', async () => {
    const receipt = { id: 21, order: { orderNumber: 'PO-1', currency: 'INR', supplierSnapshot: { name: 'Original supplier' } }, lines: [{ id: 1, orderLine: { snapshot: { itemName: 'Original component' } } }] };
    const tx = { goodsReceipt: { findMany: vi.fn().mockResolvedValue([receipt]), count: vi.fn().mockResolvedValue(21), findFirst: vi.fn().mockResolvedValue(receipt) } };
    const db = { $transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
    const repository = new PurchasingRepository(db);
    const query = purchaseListSchema.parse({ page: '2', supplierId: '7', sortBy: 'reference', sortOrder: 'asc' });
    const result = await repository.list(3, 8, 'receipts', query);
    const include = { order: { select: { orderNumber: true, supplierSnapshot: true, currency: true } }, warehouse: { select: { name: true, code: true } }, lines: { orderBy: { id: 'asc' }, include: { orderLine: { select: { lineNumber: true, snapshot: true, unitCost: true } } } } };
    expect(tx.goodsReceipt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 3, order: { firmId: 3, supplierId: 7 }, createdAt: { gte: undefined, lte: undefined } }, skip: 20, take: 20, orderBy: [{ reference: 'asc' }, { id: 'asc' }], include }));
    expect(result.records).toEqual([receipt]);
    await expect(repository.get(3, 8, 'receipts', 21)).resolves.toEqual(receipt);
    expect(tx.goodsReceipt.findFirst).toHaveBeenCalledWith({ where: { id: 21, firmId: 3 }, include });
  });
});
