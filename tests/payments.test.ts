import { describe, expect, it } from 'vitest';
import { paymentBalance, receiptAmount } from '../src/modules/payments/payment-balances.js';
import { invoiceSettlement } from '../src/modules/invoices/invoice-settlement.js';
import { indiaToday } from '../src/modules/invoices/india-gst.js';
import { allocatePaymentSchema, recordPaymentSchema } from '../src/modules/payments/payments.schema.js';
import { nextBillingPeriod } from '../src/modules/billing-schedules/billing-periods.js';
import { expandAssignablePermissions, PERMISSIONS } from '../src/modules/auth/permissions.js';
import { requestHash } from '../src/core/idempotency/request-hash.js';

describe('customer receipt reconciliation', () => {
  it('preserves exact partial, advance and multi-invoice balances', () => {
    expect(paymentBalance({ amount: '0.303', currency: 'KWD', allocations: [{ amount: '0.101' }, { amount: '0.101' }], refunds: [], reversal: null })).toMatchObject({ allocated: '0.202', unapplied: '0.101' });
    expect(paymentBalance({ amount: '100.10', currency: 'INR', allocations: [], refunds: [], reversal: null })).toMatchObject({ allocated: '0.00', unapplied: '100.10' });
  });
  it('preserves refund cash outflows when reversing the remaining receipt', () => {
    const receipt = { amount: '100.10', currency: 'INR', allocations: [{ amount: '60.00' }], refunds: [{ amount: '20.10' }], reversal: null };
    expect(paymentBalance(receipt)).toMatchObject({ netAmount: '80.00', unapplied: '20.00' });
    expect(paymentBalance({ ...receipt, reversal: { amount: '80.00' } })).toEqual({ netAmount: '0.00', allocated: '0.00', unapplied: '0.00', refunded: '20.10', reversed: '80.00' });
    expect(() => paymentBalance({ ...receipt, reversal: { amount: '100.10' } })).toThrow('reconcile');
  });
  it('rejects over-allocation and currency precision loss without rounding input', () => {
    expect(() => paymentBalance({ amount: '10', currency: 'USD', allocations: [{ amount: '10.01' }], refunds: [], reversal: null })).toThrow();
    expect(() => receiptAmount('1.001', 'INR')).toThrow('precision');
    expect(() => receiptAmount('1.1', 'JPY')).toThrow('precision');
    expect(receiptAmount('1.001', 'BHD')).toBe('1.001');
    expect(() => receiptAmount('0', 'INR')).toThrow();
  });
});
describe('invoice receivable projection', () => {
  const invoice = { currency: 'INR', total: '100.00', credits: '10.00', debits: '5.00', allocated: '50.00', dueDate: '2026-11-02' };
  it('derives settlement from adjustments and valid allocations', () => {
    expect(invoiceSettlement(invoice, '2026-11-03')).toMatchObject({ adjustedTotal: '95.00', outstanding: '45.00', settlementStatus: 'PARTIAL', overdue: true });
    expect(invoiceSettlement({ ...invoice, allocated: '95' }, '2026-11-03')).toMatchObject({ settlementStatus: 'PAID', overdue: false });
    expect(invoiceSettlement({ ...invoice, allocated: '0' }, '2026-11-03').outstanding).toBe('95.00');
    expect(() => invoiceSettlement({ ...invoice, credits: '60' }, '2026-11-03')).toThrow('reconcile');
  });
  it('changes ageing only at the existing Indian billing-day boundary', () => {
    const before = indiaToday(new Date('2026-11-02T18:29:59.999Z')); const after = indiaToday(new Date('2026-11-02T18:30:00Z'));
    expect(invoiceSettlement(invoice, before)).toMatchObject({ overdue: false, ageingBucket: 'CURRENT' });
    expect(invoiceSettlement(invoice, after)).toMatchObject({ overdue: true, overdueDays: 1, ageingBucket: 'DAYS_1_30' });
  });
  it.each([['2026-10-04', 'DAYS_1_30'], ['2026-10-03', 'DAYS_31_60'], ['2026-09-03', 'DAYS_61_90'], ['2026-08-04', 'DAYS_91_PLUS']])('ages due date %s into %s', (dueDate, bucket) => {
    expect(invoiceSettlement({ ...invoice, dueDate }, '2026-11-03').ageingBucket).toBe(bucket);
  });
});
describe('recurring periods and input authority', () => {
  it('keeps month-end and leap-year anchors stable without period drift', () => {
    expect(nextBillingPeriod('2026-01-31', '2026-01-31', 1)).toBe('2026-02-28');
    expect(nextBillingPeriod('2026-01-31', '2026-02-28', 1)).toBe('2026-03-31');
    expect(nextBillingPeriod('2024-02-29', '2025-02-28', 12)).toBe('2026-02-28');
    expect(nextBillingPeriod('2024-02-29', '2027-02-28', 12)).toBe('2028-02-29');
  });
  it('does not accept gateway status, tenant IDs, or duplicate invoice rows', () => {
    const receipt = { companyId: 1, currency: 'INR', amount: '10', method: 'CASH', receivedDate: '2026-11-03', idempotencyKey: 'receipt_001', confirmed: true };
    expect(recordPaymentSchema.safeParse({ ...receipt, status: 'PAID', firmId: 2 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...receipt, method: 'GATEWAY' }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...receipt, confirmed: false }).success).toBe(false);
    expect(allocatePaymentSchema.safeParse({ idempotencyKey: 'allocate_001', allocations: [{ invoiceId: 1, amount: '5' }, { invoiceId: 1, amount: '5' }] }).success).toBe(false);
  });
  it('expands grants while preserving independent manage and recurring authority', () => {
    expect(expandAssignablePermissions([PERMISSIONS.PAYMENTS_RECORD])).toEqual(expect.arrayContaining([PERMISSIONS.PAYMENTS_VIEW]));
    expect(expandAssignablePermissions([PERMISSIONS.PAYMENTS_RECORD])).not.toContain(PERMISSIONS.PAYMENTS_MANAGE);
    expect(expandAssignablePermissions([PERMISSIONS.BILLING_RECURRING])).toEqual(expect.arrayContaining([PERMISSIONS.INVOICES_CREATE, PERMISSIONS.INVOICES_VIEW]));
  });
  it('keeps request hashes stable across JSON object key order', () => {
    expect(requestHash({ amount: '10', rows: [{ invoiceId: 1, amount: '5' }] })).toBe(requestHash({ rows: [{ amount: '5', invoiceId: 1 }], amount: '10' }));
  });
});
