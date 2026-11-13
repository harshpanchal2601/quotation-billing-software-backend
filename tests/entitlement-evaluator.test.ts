import { describe, expect, it } from 'vitest';
import { activeOverride, effectiveQuota, evaluateFeature, quotaAllows, subscriptionAllowsAccess, type AccessOverride, type EntitlementContext, type SubscriptionAccess } from '../src/modules/entitlements/entitlement-evaluator.js';
import { FEATURE_KEYS, FEATURE_REGISTRY, validateFeatureSelection } from '../src/modules/entitlements/feature-registry.js';
import { LEGACY_POLICY } from '../src/modules/entitlements/entitlements.schema.js';

const now = new Date('2026-10-26T12:00:00.000Z');
const before = new Date(now.getTime() - 1_000);
const after = new Date(now.getTime() + 1_000);
const subscription: SubscriptionAccess = { status: 'ACTIVE', effectiveFrom: before, effectiveUntil: null, trialEndsAt: null, graceEndsAt: null, currentPeriodEndsAt: null, policy: LEGACY_POLICY };
function context(input: Partial<EntitlementContext> = {}): EntitlementContext {
  return { firmActive: true, legacy: false, subscription, features: new Set(['firm.core', 'dashboard']), hardDisabled: new Set(), overrides: [], now, ...input };
}
function override(input: Partial<AccessOverride> = {}): AccessOverride {
  return { id: 1, target: 'feature:dashboard', effect: 'ALLOW', limit: null, startsAt: before, expiresAt: null, revokedAt: null, ...input };
}

describe('entitlement contract', () => {
  it('covers plan × override × kill × RBAC × firm × subscription × quota', () => {
    const overrides = [
      { name: 'none', entries: [], grant: false, deny: false },
      { name: 'allow', entries: [override()], grant: true, deny: false },
      { name: 'deny', entries: [override({ effect: 'DENY' })], grant: false, deny: true },
      { name: 'expired', entries: [override({ expiresAt: now })], grant: false, deny: false },
      { name: 'future', entries: [override({ startsAt: after })], grant: false, deny: false },
      { name: 'revoked', entries: [override({ revokedAt: before })], grant: false, deny: false },
    ];
    const states = [
      { name: 'active', value: subscription, available: true },
      { name: 'trial', value: { ...subscription, status: 'TRIAL', trialEndsAt: after }, available: true },
      { name: 'expired trial', value: { ...subscription, status: 'TRIAL', trialEndsAt: now }, available: false },
      { name: 'past due grace', value: { ...subscription, status: 'PAST_DUE', graceEndsAt: after }, available: true },
      { name: 'past due expired', value: { ...subscription, status: 'PAST_DUE', graceEndsAt: now }, available: false },
      { name: 'cancelled immediate', value: { ...subscription, status: 'CANCELLED' }, available: false },
      { name: 'suspended', value: { ...subscription, status: 'SUSPENDED' }, available: false },
      { name: 'assignment expired', value: { ...subscription, effectiveUntil: now }, available: false },
    ];
    for (const included of [false, true]) for (const exception of overrides) for (const killed of [false, true])
      for (const authorized of [false, true]) for (const firmActive of [false, true]) for (const state of states)
        for (const capacity of [{ limit: null, available: true }, { limit: 11n, available: true }, { limit: 10n, available: false }]) {
          const result = evaluateFeature(context({ firmActive, subscription: state.value, features: new Set(included ? ['dashboard'] : []), hardDisabled: new Set(killed ? ['dashboard'] : []), overrides: exception.entries }), 'dashboard', authorized);
          const actual = result.allowed && quotaAllows(10n, 1n, capacity.limit);
          const expected = firmActive && state.available && !killed && authorized && !exception.deny && (included || exception.grant) && capacity.available;
          expect(actual, JSON.stringify({ included, override: exception.name, killed, authorized, firmActive, state: state.name, quota: String(capacity.limit) })).toBe(expected);
        }
  });

  it('never resurrects older grants after replacement expiry or revocation', () => {
    const entries = [override({ id: 1, startsAt: new Date(0) }), override({ id: 2, expiresAt: now })];
    expect(activeOverride(entries, 'feature:dashboard', now)).toBeUndefined();
    expect(evaluateFeature(context({ features: new Set(), overrides: entries }), 'dashboard').allowed).toBe(false);
    expect(activeOverride([entries[0]!, override({ id: 2, revokedAt: now })], 'feature:dashboard', now)).toBeUndefined();
  });

  it('retains approved end-of-term access only until its explicit boundary', () => {
    const cancelled = { ...subscription, status: 'CANCELLED', currentPeriodEndsAt: after, policy: { ...LEGACY_POLICY, cancellationAccess: 'END_OF_TERM' as const } };
    expect(subscriptionAllowsAccess(cancelled, now)).toBe(true);
    expect(subscriptionAllowsAccess(cancelled, after)).toBe(false);
    expect(subscriptionAllowsAccess({ ...subscription, effectiveFrom: after }, now)).toBe(false);
  });

  it('applies dependency hard kills even to explicit ALLOW grants', () => {
    const input = context({ features: new Set(FEATURE_KEYS), hardDisabled: new Set(['quotations']), overrides: [override({ target: 'feature:quotations.email' })] });
    expect(evaluateFeature(input, 'quotations.email')).toMatchObject({ allowed: false, reason: expect.stringContaining('GLOBAL_HARD_DISABLED') });
  });

  it('preserves only enumerated legacy features and denies future/unknown keys', () => {
    const input = context({ legacy: true, subscription: null, features: new Set() });
    for (const key of FEATURE_KEYS) expect(evaluateFeature(input, key).allowed).toBe(FEATURE_REGISTRY[key].legacy);
    expect(evaluateFeature(input, 'new.unregistered.feature').allowed).toBe(false);
    expect(evaluateFeature(context({ subscription: null }), 'dashboard').allowed).toBe(false);
  });

  it('checks large integer quotas, underflow, releases, zero and expiring limit overrides', () => {
    const used = 9_007_199_254_740_993n;
    expect(quotaAllows(used, 1n, used)).toBe(false);
    expect(quotaAllows(used, 1n, used + 1n)).toBe(true);
    expect(quotaAllows(used, -1n, 0n)).toBe(true);
    expect(quotaAllows(0n, -1n, null)).toBe(false);
    expect(quotaAllows(0n, 1n, 0n)).toBe(false);
    const input = context({ overrides: [override({ target: 'quota:users', effect: 'LIMIT', limit: 8n })] });
    expect(effectiveQuota(input, 'users', 4n)).toBe(8n);
    expect(effectiveQuota({ ...input, now: after, overrides: [override({ target: 'quota:users', effect: 'LIMIT', limit: 8n, expiresAt: after })] }, 'users', 4n)).toBe(4n);
  });

  it('rejects unknown keys, missing dependencies, missing core and cyclic registries', () => {
    expect(() => validateFeatureSelection(['firm.core', 'unknown'])).toThrow('Unknown feature');
    expect(() => validateFeatureSelection(['firm.core', 'items'])).toThrow('requires catalog');
    expect(() => validateFeatureSelection(['dashboard'])).toThrow('system required');
    expect(() => validateFeatureSelection(['a', 'b'], { a: { dependencies: ['b'], required: false }, b: { dependencies: ['a'], required: false } })).toThrow('Cyclic');
    expect(() => validateFeatureSelection(FEATURE_KEYS)).not.toThrow();
  });
});
