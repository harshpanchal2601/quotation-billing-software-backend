import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewStockAdjustment } from '../src/modules/inventory/stock-ledger.js';

const access = vi.hoisted(() => ({ feature: vi.fn(), policy: vi.fn() }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: access.feature }));
vi.mock('../src/modules/settings/index.js', () => ({ resolveBusinessPolicy: access.policy }));
function fixture() {
  const tx = {
    warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 2, code: 'MAIN' }) },
    item: { findFirst: vi.fn().mockResolvedValue({ id: 3, updatedAt: new Date('2026-11-09'), measurementUnit: { firmId: 1, deletedAt: null, isActive: true, allowDecimal: true, symbol: 'PCS' } }) },
    stockPosition: { findUnique: vi.fn().mockResolvedValue({ currency: 'INR', onHand: new Prisma.Decimal('10'), reserved: new Prisma.Decimal('2'), value: new Prisma.Decimal('20') }), upsert: vi.fn(), update: vi.fn() },
    stockMovement: { findFirst: vi.fn().mockResolvedValue({ id: 17 }), create: vi.fn() },
  };
  return tx;
}
beforeEach(() => { vi.resetAllMocks(); access.policy.mockResolvedValue({ version: 4, policy: { currency: 'INR' } }); });
describe('Wave 09 stock action effects use the existing ledger projection', () => {
  it('previews quantities and valuation without creating a position or movement', async () => {
    const tx = fixture();
    const preview = await previewStockAdjustment(tx as never, 1, { warehouseId: 2, itemId: 3, direction: 'OUT', quantity: '3' });
    expect(preview.before).toMatchObject({ onHand: '10', inventoryValue: '20', policyVersion: 4, lastMovementId: 17, currency: 'INR' });
    expect(preview.after).toEqual({ onHand: '7', inventoryValue: '14', currency: 'INR' });
    expect(tx.stockPosition.upsert).not.toHaveBeenCalled(); expect(tx.stockPosition.update).not.toHaveBeenCalled(); expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });
  it('preserves fractional inbound cost and rejects unavailable reserved stock', async () => {
    const tx = fixture();
    expect((await previewStockAdjustment(tx as never, 1, { warehouseId: 2, itemId: 3, direction: 'IN', quantity: '1.125', unitCost: '2.001' })).after).toMatchObject({ onHand: '11.125', inventoryValue: '22.251125' });
    await expect(previewStockAdjustment(tx as never, 1, { warehouseId: 2, itemId: 3, direction: 'OUT', quantity: '9' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('checks tenant resources and unit availability before estimating an effect', async () => {
    const tx = fixture(); tx.item.findFirst.mockResolvedValue(null);
    await expect(previewStockAdjustment(tx as never, 1, { warehouseId: 2, itemId: 3, direction: 'OUT', quantity: '1' })).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.item.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 3, firmId: 1 }) }));
    expect(tx.stockPosition.findUnique).not.toHaveBeenCalled();
  });
});
