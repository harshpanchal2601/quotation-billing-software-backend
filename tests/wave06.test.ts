import { describe, expect, it } from 'vitest';
import { decimal } from '../src/core/money/index.js';
import { availableOrderQuantity, fulfillmentStatus } from '../src/modules/sales-orders/order-quantities.js';
import { fulfillmentSchema } from '../src/modules/sales-orders/sales-orders.schema.js';
import { leadConversionSchema, leadCreateSchema, opportunityCreateSchema, OPPORTUNITY_STAGES, taskCreateSchema } from '../src/modules/crm/crm.schema.js';
import { PORTAL_CONSENT, portalDecisionSchema, portalGrantSchema } from '../src/modules/customer-portal/portal.schema.js';
import { matchesPortalToken, newPortalToken, portalCsrfToken, portalTokenHash } from '../src/modules/customer-portal/portal-tokens.js';
import { partialQuotationLine } from '../src/modules/invoices/quotation-billing-lines.js';
import type { InvoiceLineSnapshot } from '../src/modules/invoices/invoice-calculations.js';
import { businessPolicySchema } from '../src/modules/settings/business-policy/business-policy.schema.js';
import { isCustomerQuotationDecisionOpen } from '../src/modules/quotations/quotation-customer.js';

describe('Wave 06 domain invariants', () => {
  it('uses Decimal for completed quantity caps and status projection', () => {
    expect(availableOrderQuantity('1.003', '0.303', '0.300').toFixed(3)).toBe('0.003');
    expect(() => availableOrderQuantity('1', '1.001', '0')).toThrow();
    expect(() => availableOrderQuantity('1', '0.3', '0.301')).toThrow();
    expect(fulfillmentStatus([{ quantity: '1', fulfilled: '0' }])).toBe('OPEN');
    expect(fulfillmentStatus([{ quantity: '1', fulfilled: '.5' }])).toBe('PARTIALLY_FULFILLED');
    expect(fulfillmentStatus([{ quantity: '1', fulfilled: '1' }])).toBe('FULFILLED');
  });
  it('requires deliberate company creation and rejects tenant/actor authority in inputs', () => {
    expect(leadCreateSchema.safeParse({ name: 'Prospect', ownerId: 1, firmId: 2 }).success).toBe(false);
    expect(leadConversionSchema.safeParse({ expectedVersion: 1, idempotencyKey: 'conversion-key', newCompany: { name: 'Example' } }).success).toBe(false);
    expect(leadConversionSchema.safeParse({ expectedVersion: 1, idempotencyKey: 'conversion-key', companyId: 1, newCompany: { name: 'Example' }, confirmNewCompany: true }).success).toBe(false);
    expect(leadConversionSchema.parse({ expectedVersion: 1, idempotencyKey: 'conversion-key', newCompany: { name: 'Example' }, confirmNewCompany: true }).newCompany?.isActive).toBe(true);
  });
  it('validates pipeline stages, exact values and follow-up reminders', () => {
    expect(OPPORTUNITY_STAGES).toMatchObject({ NEW: 10, WON: 100, LOST: 0 });
    expect(opportunityCreateSchema.parse({ title: 'Project', ownerId: 1, value: '999999999999.003', currency: 'KWD' }).stage).toBe('NEW');
    expect(taskCreateSchema.safeParse({ title: 'Follow up', assignedToId: 1, dueAt: '2026-11-08T10:00:00.000Z', reminderAt: '2026-11-08T11:00:00.000Z' }).success).toBe(false);
    expect(fulfillmentSchema.safeParse({ salesOrderId: 1, expectedVersion: 1, idempotencyKey: 'dispatch-key', reference: 'Delivery', occurredAt: '2026-11-08T10:00:00.000Z', lines: [{ salesOrderLineId: 1, quantity: '1' }, { salesOrderLineId: 1, quantity: '1' }] }).success).toBe(false);
  });
  it('limits each portal grant to one document and records explicit consent', () => {
    const base = { identityId: 1, expiresAt: '2026-11-09T10:00:00.000Z' };
    expect(portalGrantSchema.safeParse({ ...base, quotationId: 1, invoiceId: 2 }).success).toBe(false);
    expect(portalGrantSchema.safeParse({ ...base, invoiceId: 2, allowDecision: true }).success).toBe(false);
    expect(portalDecisionSchema.safeParse({ grantId: 1, snapshotHash: 'a'.repeat(64), decision: 'ACCEPTED', consent: PORTAL_CONSENT, idempotencyKey: 'decision-key', actorId: 1 }).success).toBe(false);
  });
  it('uses independent opaque invitation/session tokens and a stable session-specific CSRF proof', () => {
    const first = newPortalToken(); const second = newPortalToken();
    expect(first).toHaveLength(43); expect(second).not.toBe(first);
    expect(matchesPortalToken(first, portalTokenHash(first))).toBe(true);
    expect(matchesPortalToken(second, portalTokenHash(first))).toBe(false);
    expect(matchesPortalToken('', portalTokenHash(first))).toBe(false);
    expect(portalCsrfToken(first)).toHaveLength(43); expect(portalCsrfToken(first)).not.toBe(portalCsrfToken(second));
    expect(portalTokenHash(first)).not.toContain(first);
  });
  it('preserves pennies and supports cancellation/reallocation without reusing consumed money', () => {
    const line: InvoiceLineSnapshot = { lineNumber: 1, itemId: null, itemCode: null, itemName: 'Service', description: null, hsnCode: null, supplyType: 'SERVICE', measurementUnit: 'HOUR', quantity: '3', unitRate: '0.01', discountType: 'NONE', discountValue: '0', taxRate: '0', baseAmount: '0.02', discountAmount: '0.00', taxableAmount: '0.02', cgstAmount: '0.00', sgstAmount: '0.00', igstAmount: '0.00', taxAmount: '0.00', lineTotal: '0.02' };
    const a = partialQuotationLine(line, '0', '1', 'INR');
    const b = partialQuotationLine(line, '1', '1', 'INR', a);
    const consumed = { baseAmount: decimal(a.baseAmount).add(b.baseAmount).toString(), discountAmount: '0', cgstAmount: '0', sgstAmount: '0', igstAmount: '0' };
    const c = partialQuotationLine(line, '2', '1', 'INR', consumed);
    expect(decimal(a.lineTotal).add(b.lineTotal).add(c.lineTotal).toFixed(2)).toBe('0.02');
    const replacement = partialQuotationLine(line, '1', '2', 'INR', b);
    expect(decimal(b.lineTotal).add(replacement.lineTotal).toFixed(2)).toBe('0.02');
  });
  it('preserves old policy shape and validates firm-level sales presets', () => {
    const old = { schemaVersion: 1, currency: 'INR', rounding: 'HALF_UP', grandTotal: 'WHOLE_UNIT', tax: { id: 'none', version: 1 }, inAppNotifications: true };
    expect(businessPolicySchema.parse(old)).toEqual(old);
    expect(businessPolicySchema.parse({ ...old, sales: { preset: 'SERVICE', ordersEnabled: false, portalEnabled: true } }).sales?.ordersEnabled).toBe(false);
  });
  it('ends portal decisions on the existing Indian business-day boundary', () => {
    const source = { isLatestRevision: true, status: 'SENT', validUntil: new Date('2026-11-08T00:00:00Z') };
    expect(isCustomerQuotationDecisionOpen(source, new Date('2026-11-08T18:29:59Z'))).toBe(true);
    expect(isCustomerQuotationDecisionOpen(source, new Date('2026-11-08T18:30:00Z'))).toBe(false);
    expect(isCustomerQuotationDecisionOpen({ ...source, isLatestRevision: false }, new Date('2026-11-08T12:00:00Z'))).toBe(false);
  });
});
