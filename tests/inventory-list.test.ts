import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { InventoryRepository } from '../src/modules/inventory/inventory.repository.js';
import { inventoryListSchema } from '../src/modules/inventory/inventory.schema.js';

vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: vi.fn() }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: vi.fn() }));

describe('inventory movement listing', () => {
  it('retains tenant and location filters, stable ordering and readable record identities on later pages', async () => {
    const movement = { id: 21, position: { warehouseId: 3, itemId: 9, currency: 'INR', warehouse: { code: 'MAIN', name: 'Main warehouse' }, item: { itemCode: 'ITEM-9', name: 'Component' } } };
    const tx = { stockMovement: { findMany: vi.fn().mockResolvedValue([movement]), count: vi.fn().mockResolvedValue(21) } };
    const db = { $transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
    const query = inventoryListSchema.parse({ page: '2', warehouseId: '3', itemId: '9', sortBy: 'quantity', sortOrder: 'asc' });
    const result = await new InventoryRepository(db).movements(7, 11, query);
    const where = { firmId: 7, position: { firmId: 7, warehouseId: 3, itemId: 9 }, postedAt: { gte: undefined, lte: undefined } };
    expect(tx.stockMovement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 20, take: 20, orderBy: [{ quantity: 'asc' }, { id: 'asc' }], include: { position: { select: expect.objectContaining({ warehouse: { select: { code: true, name: true } }, item: { select: { itemCode: true, name: true } } }) } } }));
    expect(tx.stockMovement.count).toHaveBeenCalledWith({ where });
    expect(result.movements).toEqual([movement]);
    expect(result.pagination).toEqual({ page: 2, limit: 20, total: 21 });
  });
});
