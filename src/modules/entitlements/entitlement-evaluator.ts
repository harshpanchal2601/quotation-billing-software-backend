import { FEATURE_REGISTRY, isFeatureKey, type FeatureKey } from './feature-registry.js';

export type SubscriptionPolicy = {
  trialDays: number;
  graceDays: number;
  billingCycle: 'MANUAL' | 'MONTHLY' | 'ANNUAL';
  cancellationAccess: 'IMMEDIATE' | 'END_OF_TERM';
  downgradeTiming: 'IMMEDIATE' | 'AT_RENEWAL';
  retention: 'RETAIN';
  overridePrecedence: 'LATEST_EFFECTIVE_REPLACEMENT';
};

export type SubscriptionAccess = {
  status: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  policy: SubscriptionPolicy;
};

export type AccessOverride = {
  id: number;
  target: string;
  effect: string;
  limit: bigint | null;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type EntitlementContext = {
  firmActive: boolean;
  legacy: boolean;
  subscription: SubscriptionAccess | null;
  features: ReadonlySet<string>;
  hardDisabled: ReadonlySet<string>;
  overrides: readonly AccessOverride[];
  now: Date;
};

export function subscriptionAllowsAccess(subscription: SubscriptionAccess, now: Date) {
  if (subscription.effectiveFrom > now || (subscription.effectiveUntil !== null && subscription.effectiveUntil <= now)) return false;
  switch (subscription.status) {
    case 'ACTIVE': return true;
    case 'TRIAL': return subscription.trialEndsAt !== null && subscription.trialEndsAt > now;
    case 'PAST_DUE': return subscription.graceEndsAt !== null && subscription.graceEndsAt > now;
    case 'CANCELLED': return subscription.policy.cancellationAccess === 'END_OF_TERM' &&
      subscription.currentPeriodEndsAt !== null && subscription.currentPeriodEndsAt > now;
    default: return false;
  }
}

// Latest effective replacement wins. Expiry/revocation never revives an older grant.
export function activeOverride(overrides: readonly AccessOverride[], target: string, now: Date) {
  const latest = overrides.filter((entry) => entry.target === target && entry.startsAt <= now)
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || b.id - a.id)[0];
  return latest !== undefined && latest.revokedAt === null &&
    (latest.expiresAt === null || latest.expiresAt > now) ? latest : undefined;
}

export type AccessDecision = { allowed: boolean; reason: string; overrideId?: number };

export function evaluateFeature(context: EntitlementContext, key: string, userAuthorized = true): AccessDecision {
  const evaluate = (candidate: string, ancestors: Set<string>): AccessDecision => {
    if (!isFeatureKey(candidate)) return { allowed: false, reason: 'UNKNOWN_FEATURE' };
    if (!context.firmActive) return { allowed: false, reason: 'FIRM_UNAVAILABLE' };
    if (!context.legacy && (context.subscription === null || !subscriptionAllowsAccess(context.subscription, context.now))) {
      return { allowed: false, reason: 'SUBSCRIPTION_UNAVAILABLE' };
    }
    if (context.hardDisabled.has(candidate)) return { allowed: false, reason: 'GLOBAL_HARD_DISABLED' };
    if (ancestors.has(candidate)) return { allowed: false, reason: 'DEPENDENCY_CYCLE' };
    const override = activeOverride(context.overrides, `feature:${candidate}`, context.now);
    if (override?.effect === 'DENY') return { allowed: false, reason: 'PLATFORM_DENY', overrideId: override.id };
    const definition = FEATURE_REGISTRY[candidate];
    const included = definition.required || context.features.has(candidate) || (context.legacy && definition.legacy);
    if (!included && override?.effect !== 'ALLOW') return { allowed: false, reason: 'PLAN_EXCLUDES_FEATURE' };
    const nextAncestors = new Set(ancestors).add(candidate);
    for (const dependency of definition.dependencies) {
      const result = evaluate(dependency, nextAncestors);
      if (!result.allowed) return { allowed: false, reason: `DEPENDENCY:${dependency}:${result.reason}` };
    }
    return { allowed: true, reason: override?.effect === 'ALLOW' ? 'PLATFORM_ALLOW' : 'PLAN_INCLUDED', ...(override ? { overrideId: override.id } : {}) };
  };
  const result = evaluate(key, new Set());
  return result.allowed && !userAuthorized ? { allowed: false, reason: 'RBAC_DENIED' } : result;
}

export function effectiveQuota(context: EntitlementContext, key: string, planLimit: bigint | null) {
  const override = activeOverride(context.overrides, `quota:${key}`, context.now);
  return override?.effect === 'LIMIT' ? override.limit : planLimit;
}

export function quotaAllows(used: bigint, delta: bigint, limit: bigint | null) {
  return used + delta >= 0n && (delta <= 0n || limit === null || used + delta <= limit);
}

export function featureForQuota(key: string): FeatureKey {
  return key === 'documents' ? 'quotations.documents' : key === 'aiCredits' ? 'ai.credits' : 'firm.core';
}
