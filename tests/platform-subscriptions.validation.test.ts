import { describe, expect, it } from 'vitest';
import { firmOverrideSchema, planVersionSchema, platformChargeSchema, platformPaymentSchema, subscriptionAssignmentSchema } from '../src/modules/platform/platform-subscriptions.schema.js';
import { LEGACY_POLICY } from '../src/modules/entitlements/entitlements.schema.js';

const reason = 'Reviewed regression fixture';
const draft = { features: ['firm.core'], quotas: { users: '4', documents: null, storageBytes: null, aiCredits: '0' }, policy: null, price: null, currency: null, reason };
describe('platform contracts', () => {
  it('permits unpublished policy drafts without silently supplying commercial defaults', () => {
    expect(planVersionSchema.parse(draft).policy).toBeNull();
    expect(planVersionSchema.safeParse({ ...draft, policy: { trialDays: 14 } }).success).toBe(false);
    expect(planVersionSchema.parse({ ...draft, policy: LEGACY_POLICY }).policy).toEqual(LEGACY_POLICY);
  });
  it('rejects incompatible, negative, imprecise and overflowing quotas/prices', () => {
    for (const users of ['0', '-1', '1.5', '2147483648', null]) expect(planVersionSchema.safeParse({ ...draft, quotas: { ...draft.quotas, users } }).success).toBe(false);
    expect(planVersionSchema.safeParse({ ...draft, quotas: { ...draft.quotas, storageBytes: '9223372036854775808' } }).success).toBe(false);
    expect(planVersionSchema.safeParse({ ...draft, price: '1.001', currency: 'USD' }).success).toBe(false);
    expect(planVersionSchema.safeParse({ ...draft, price: '1.00' }).success).toBe(false);
  });
  it('requires explicit target/effect, author-independent reason and expiry contracts', () => {
    const entry = { target: 'feature:dashboard', effect: 'ALLOW', limit: null, startsAt: '2026-10-26T00:00:00Z', expiresAt: null, reason };
    expect(firmOverrideSchema.safeParse(entry).success).toBe(true);
    for (const patch of [{ target: 'feature:unregistered' }, { effect: 'LIMIT' }, { limit: '4' }, { reason: '' }, { authorId: 1 }, { expiresAt: '2026-10-25T00:00:00Z' }]) expect(firmOverrideSchema.safeParse({ ...entry, ...patch }).success).toBe(false);
    expect(firmOverrideSchema.safeParse({ ...entry, target: 'quota:users', effect: 'LIMIT' }).success).toBe(false);
    expect(firmOverrideSchema.safeParse({ ...entry, target: 'quota:storageBytes', effect: 'LIMIT' }).success).toBe(true);
  });
  it('rejects malformed quotas and overrides without throwing conversion errors', () => {
    for (const value of ['', '1.5', 'NaN', 'Infinity', '1e3', ' 2', '+2', '0x10', '-1', '9223372036854775808']) {
      for (const resource of ['users', 'documents', 'storageBytes', 'aiCredits']) {
        expect(planVersionSchema.safeParse({ ...draft, quotas: { ...draft.quotas, [resource]: value } }).success).toBe(false);
        expect(firmOverrideSchema.safeParse({ target: `quota:${resource}`, effect: 'LIMIT', limit: value, startsAt: new Date(), expiresAt: null, reason }).success).toBe(false);
      }
    }
  });
  it('rejects spoofed ownership and reversed assignment dates', () => {
    const assignment = { planVersionId: 1, expectedSubscriptionId: null, status: 'ACTIVE', effectiveFrom: '2026-10-26T00:00:00Z', effectiveUntil: null, trialEndsAt: null, graceEndsAt: null, currentPeriodEndsAt: null, renewalAt: null, reason };
    expect(subscriptionAssignmentSchema.safeParse({ ...assignment, firmId: 2 }).success).toBe(false);
    expect(subscriptionAssignmentSchema.safeParse({ ...assignment, effectiveUntil: '2026-10-25T00:00:00Z' }).success).toBe(false);
  });
  it('keeps manual money decimal strings and currency attached to its charge', () => {
    const charge = { idempotencyKey: 'fixture-unique', amount: '9007199254740993.01', currency: 'USD', reason };
    expect(platformChargeSchema.parse(charge).amount).toBe(charge.amount);
    for (const amount of ['0', '0.00', '-1.00', '1.001', 1.01]) expect(platformChargeSchema.safeParse({ ...charge, amount }).success).toBe(false);
    const payment = { idempotencyKey: 'fixture-unique', kind: 'PAYMENT', amount: '1.01', reference: 'Receipt', reason };
    expect(platformPaymentSchema.safeParse({ ...payment, currency: 'INR' }).success).toBe(false);
  });
});
