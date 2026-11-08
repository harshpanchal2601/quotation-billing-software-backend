import { describe, expect, it } from 'vitest';
import { decimal } from '../src/core/money/index.js';
import { expandAssignablePermissions, PERMISSIONS } from '../src/modules/auth/permissions.js';
import { FEATURE_KEYS, PERMISSION_FEATURES, validateFeatureSelection } from '../src/modules/entitlements/feature-registry.js';
import { evaluateFeature, type EntitlementContext } from '../src/modules/entitlements/entitlement-evaluator.js';
import { LEGACY_POLICY } from '../src/modules/entitlements/entitlements.schema.js';
import { companyCreateSchema, companyListQuerySchema } from '../src/modules/companies/companies.schema.js';
import { createItemSchema, itemInventorySchema } from '../src/modules/items/items.schema.js';
import { stockAdjustmentSchema, stockQuantitySchema, stockTransferSchema } from '../src/modules/inventory/inventory.schema.js';
import { assertStockQuantity, projectStock, trackedItem } from '../src/modules/inventory/stock-ledger.js';
import { calculatePurchase, purchasePolicyFromSnapshot } from '../src/modules/purchasing/purchase-calculations.js';
import { goodsReceiptSchema, supplierBillSchema } from '../src/modules/purchasing/purchasing.schema.js';
import { fulfillmentSchema } from '../src/modules/sales-orders/sales-orders.schema.js';

const policy = { version: 0, policy: { currency: 'INR', rounding: 'HALF_UP' as const, grandTotal: 'MINOR_UNIT' as const, tax: { id: 'none' as const, version: 1 as const } } };
const position = (onHand: string, value: string, reserved = '0') => ({ onHand: decimal(onHand), value: decimal(value), reserved: decimal(reserved) });
describe('Wave 07 stock and purchase invariants', () => {
  it('preserves legacy item requests, excludes service/legacy snapshots, and owns stock enablement separately', () => {
    expect(createItemSchema.parse({ name: 'Consulting', measurementUnitId: 1, kind: 'SERVICE', stockTracking: true })).not.toHaveProperty('stockTracking');
    expect(createItemSchema.parse({ name: 'Consulting', measurementUnitId: 1, kind: 'SERVICE', categoryId: null, shortDescription: null, detailedDescription: null, hsnCode: null })).toMatchObject({ kind: 'SERVICE', categoryId: undefined, shortDescription: null, detailedDescription: null, hsnCode: null });
    expect(trackedItem({ itemId: 1 })).toBeNull();
    expect(trackedItem({ itemId: 1, kind: 'SERVICE', stockTracking: false })).toBeNull();
    expect(trackedItem({ itemId: 1, kind: 'GOODS', stockTracking: true })).toBe(1);
    expect(() => trackedItem({ itemId: 1, kind: 'SERVICE', stockTracking: true })).toThrow();
    expect(() => itemInventorySchema.parse({ stockTracking: true, firmId: 2 })).toThrow();
    expect(companyCreateSchema.parse({ name: 'Supplier', isSupplier: true })).toMatchObject({ isSupplier: true });
    expect(companyListQuerySchema.parse({ isSupplier: 'false' }).isSupplier).toBe(false);
  });
  it('requires exact positive quantities and respects whole-item units', () => {
    for (const value of ['0', '0.000', '-1', '1.0001', '1e2', '1000000000', 'NaN']) expect(stockQuantitySchema.safeParse(value).success).toBe(false);
    expect(stockQuantitySchema.parse('0.003')).toBe('0.003');
    expect(() => assertStockQuantity(decimal('0.003'), false)).toThrow();
    expect(() => assertStockQuantity(decimal('3'), false)).not.toThrow();
  });
  it('values incoming lots and consumption with moving average, draining the exact residual', () => {
    const first = projectStock(position('0', '0'), decimal('10'), decimal('20'));
    const second = projectStock({ ...position('0', '0'), ...first }, decimal('10'), decimal('40'));
    expect(second.onHand.toString()).toBe('20'); expect(second.value.toString()).toBe('60');
    const dispatch = projectStock({ ...position('0', '0'), ...second }, decimal('-7'));
    expect(dispatch.onHand.toString()).toBe('13'); expect(dispatch.value.toString()).toBe('39');
    const fractional = projectStock(position('3', '1'), decimal('-1'));
    expect(fractional.movementValue.toFixed(6)).toBe('-0.333333');
    const final = projectStock({ ...position('0', '0'), ...fractional }, decimal('-2'));
    expect(final.onHand.isZero()).toBe(true); expect(final.value.isZero()).toBe(true); expect(final.movementValue.toFixed(6)).toBe('-0.666667');
  });
  it('blocks negative available stock and invalid inverse valuations', () => {
    expect(() => projectStock(position('10', '20', '7'), decimal('-4'))).toThrow('Insufficient available stock');
    expect(() => projectStock(position('10', '20'), decimal('-11'))).toThrow();
    expect(() => projectStock(position('1', '1'), decimal('-1'), undefined, decimal('-0.5'))).toThrow();
    expect(projectStock(position('0', '0'), decimal('0.125'), decimal('0.0125')).value.toFixed(6)).toBe('0.012500');
  });
  it('requires reasoned adjustments, distinct transfer locations and unique receipt lines', () => {
    const idempotencyKey = 'test-wave07-1234';
    expect(stockAdjustmentSchema.safeParse({ warehouseId: 1, itemId: 1, direction: 'IN', quantity: '1', reason: 'Opening stock', idempotencyKey }).success).toBe(false);
    expect(stockTransferSchema.safeParse({ fromWarehouseId: 1, toWarehouseId: 1, itemId: 1, quantity: '1', reason: 'Move stock', idempotencyKey }).success).toBe(false);
    expect(goodsReceiptSchema.safeParse({ purchaseOrderId: 1, expectedVersion: 1, reference: 'GR1', idempotencyKey, lines: [{ purchaseOrderLineId: 1, quantity: '1' }, { purchaseOrderLineId: 1, quantity: '1' }] }).success).toBe(false);
    expect(fulfillmentSchema.parse({ salesOrderId: 1, expectedVersion: 1, reference: 'Service completion', occurredAt: new Date().toISOString(), idempotencyKey, lines: [{ salesOrderLineId: 1, quantity: '1' }] }).lines[0]).not.toHaveProperty('warehouseId');
  });
  it('uses currency scales, selected tax and business rounding without posting sales invoices', () => {
    const line = { description: 'Consulting cost', quantity: '0.333', unitCost: '1.23', taxRate: '0' };
    expect(calculatePurchase([line], policy, 'NONE').total).toBe('0.41');
    const frozen = calculatePurchase([line], policy, 'NONE');
    expect(calculatePurchase([line], purchasePolicyFromSnapshot(frozen), 'NONE')).toEqual(frozen);
    expect(() => purchasePolicyFromSnapshot({ ...frozen, schemaVersion: 2 })).toThrow('snapshot version');
    expect(() => calculatePurchase([{ ...line, unitCost: '1.234' }], policy, 'NONE')).toThrow('currency precision');
    expect(() => calculatePurchase([{ ...line, taxRate: '18' }], policy, 'NONE')).toThrow();
    expect(() => calculatePurchase([line], policy, 'IGST')).toThrow();
    const gst = { ...policy, policy: { ...policy.policy, tax: { id: 'india-gst' as const, version: 1 as const, country: 'IN' as const, mode: 'CGST_SGST' as const, rate: '18' } } };
    expect(calculatePurchase([{ ...line, quantity: '2', unitCost: '100', taxRate: '18' }], gst, 'CGST_SGST')).toMatchObject({ subtotal: '200.00', taxAmount: '36.00', total: '236.00', taxTreatment: 'SUPPLIER_DECLARED_NO_ITC_CLAIM' });
    expect(calculatePurchase([{ ...line, quantity: '1', unitCost: '0.50' }], { ...policy, policy: { ...policy.policy, rounding: 'HALF_EVEN', grandTotal: 'WHOLE_UNIT' } }, 'NONE').total).toBe('0.00');
    expect(supplierBillSchema.safeParse({ supplierId: 1, supplierReference: 'S1', billDate: '2026-02-30', idempotencyKey: 'wave07-bill-1234', lines: [line] }).success).toBe(false);
  });
  it('keeps features opt-in and permission families independent under every entitlement denial', () => {
    expect(() => validateFeatureSelection(FEATURE_KEYS)).not.toThrow();
    const now = new Date();
    const base: EntitlementContext = { now, firmActive: true, legacy: false, subscription: { status: 'ACTIVE', effectiveFrom: new Date(0), effectiveUntil: null, currentPeriodEndsAt: null, trialEndsAt: null, graceEndsAt: null, policy: LEGACY_POLICY }, features: new Set(FEATURE_KEYS), hardDisabled: new Set(), overrides: [] };
    for (const key of ['inventory', 'purchasing', 'purchasing.bills', 'expenses'] as const) {
      expect(evaluateFeature(base, key).allowed).toBe(true);
      expect(evaluateFeature(base, key, false).allowed).toBe(false);
      expect(evaluateFeature({ ...base, firmActive: false }, key).allowed).toBe(false);
      expect(evaluateFeature({ ...base, hardDisabled: new Set([key]) }, key).allowed).toBe(false);
      expect(evaluateFeature({ ...base, features: new Set() }, key).allowed).toBe(false);
      expect(evaluateFeature({ ...base, legacy: true, subscription: null, features: new Set() }, key).allowed).toBe(false);
      expect(evaluateFeature({ ...base, features: new Set(), overrides: [{ id: 1, target: `feature:${key}`, effect: 'ALLOW', limit: null, startsAt: new Date(0), expiresAt: now, revokedAt: null }] }, key).allowed).toBe(false);
    }
    const purchaser = expandAssignablePermissions([PERMISSIONS.PURCHASING_MANAGE]);
    expect(purchaser).toContain(PERMISSIONS.PURCHASING_VIEW); expect(purchaser).not.toContain(PERMISSIONS.PURCHASING_APPROVE); expect(purchaser).not.toContain(PERMISSIONS.STOCK_ADJUST);
    expect(PERMISSION_FEATURES[PERMISSIONS.SUPPLIER_BILLS_MANAGE]).toBe('purchasing.bills');
  });
});
