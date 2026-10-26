import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { FEATURE_KEYS, FEATURE_REGISTRY, LEGACY_POLICY, QUOTA_KEYS, getFirmEntitlements, loadEntitlements, reconcileFirmUsage, subscriptionPolicySchema, validateFeatureSelection, withFirmEntitlementTransaction, type EntitlementTransaction } from '../entitlements/index.js';
import type { FirmOverrideInput, PlanVersionInput, PlatformChargeInput, PlatformPaymentInput, SubscriptionAssignmentInput } from './platform-subscriptions.schema.js';

const versionInclude = { features: true, quotas: true } satisfies Prisma.PlanVersionInclude;
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item)) as Prisma.InputJsonValue; }
type Serialised<T> = T extends bigint | Prisma.Decimal | Date ? string : T extends Array<infer U> ? Array<Serialised<U>> : T extends object ? { [K in keyof T]: Serialised<T[K]> } : T;
function serialise<T>(value: T): Serialised<T> { return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item)) as Serialised<T>; }
function audit(tx: EntitlementTransaction, authorId: number, kind: string, payload: unknown, firmId?: number) {
  return tx.subscriptionEvent.create({ data: { authorId, kind, payload: json(payload), firmId } });
}
type VersionSnapshot = Prisma.PlanVersionGetPayload<{ include: typeof versionInclude }>;
function previewToken(version: VersionSnapshot) {
  const policy = version.policy !== null && typeof version.policy === 'object' && !Array.isArray(version.policy)
    ? Object.fromEntries(Object.entries(version.policy).sort(([a], [b]) => a.localeCompare(b))) : version.policy;
  return createHash('sha256').update(JSON.stringify({ id: version.id, revision: version.revision, policy,
    features: version.features.map((entry) => entry.featureKey).sort(),
    quotas: version.quotas.map((entry) => [entry.resource, entry.limit?.toString() ?? null]).sort(([a], [b]) => String(a).localeCompare(String(b))),
    price: version.price?.toString() ?? null, currency: version.currency,
  })).digest('hex');
}

export class PlatformSubscriptionsRepository {
  constructor(private readonly db: PrismaClient) {}

  effectiveAccess(firmId: number, permissions: readonly string[]) {
    return getFirmEntitlements(this.db, firmId, permissions);
  }

  async features() {
    const switches = await this.db.platformFeatureSwitch.findMany();
    return FEATURE_KEYS.map((key) => ({ key, ...FEATURE_REGISTRY[key], switch: switches.find((entry) => entry.key === key) ?? null }));
  }

  async switchFeature(key: string, input: { hardDisabled: boolean; reason: string }, authorId: number) {
    return this.transaction(async (tx) => {
      const entry = await tx.platformFeatureSwitch.upsert({ where: { key }, create: { key, ...input, authorId }, update: { ...input, authorId } });
      await audit(tx, authorId, 'FEATURE_SWITCH', entry);
      return entry;
    });
  }

  async plans(page: number, limit: number) {
    const plans = await this.db.plan.findMany({ orderBy: { id: 'asc' }, skip: (page - 1) * limit, take: limit });
    return { plans, total: await this.db.plan.count() };
  }

  async plan(id: number) {
    const plan = await this.db.plan.findUnique({ where: { id }, include: { versions: { orderBy: { revision: 'desc' }, include: versionInclude } } });
    if (plan === null) throw new AppError('Plan not found', 404);
    return serialise(plan);
  }

  async createPlan(input: { name: string; slug: string; reason: string }, authorId: number) {
    if (input.slug === 'legacy-compatible') throw new AppError('The legacy plan slug is reserved', 409);
    return this.transaction(async (tx) => {
      const plan = await tx.plan.create({ data: { name: input.name, slug: input.slug } });
      await audit(tx, authorId, 'PLAN_CREATED', { plan, reason: input.reason });
      return plan;
    });
  }

  async updatePlan(id: number, input: { name: string; archived: boolean; reason: string }, authorId: number) {
    return this.transaction(async (tx) => {
      await this.lockPlan(tx, id);
      const plan = await tx.plan.update({ where: { id }, data: { name: input.name, archivedAt: input.archived ? new Date() : null } });
      await audit(tx, authorId, 'PLAN_UPDATED', { plan, reason: input.reason });
      return plan;
    });
  }

  async saveVersion(planId: number, input: PlanVersionInput, authorId: number, versionId?: number) {
    return this.transaction(async (tx) => {
      await this.lockPlan(tx, planId);
      const existing = versionId === undefined ? null : await tx.planVersion.findFirst({ where: { id: versionId, planId } });
      if (versionId !== undefined && existing === null) throw new AppError('Plan revision not found', 404);
      if (existing !== null && existing.publishedAt !== null) throw new AppError('Published revisions are immutable; create a new draft', 409);
      const latest = await tx.planVersion.findFirst({ where: { planId }, orderBy: { revision: 'desc' } });
      const data = { policy: input.policy === null ? Prisma.DbNull : json(input.policy), price: input.price, currency: input.currency };
      const version = existing === null
        ? await tx.planVersion.create({ data: { planId, revision: (latest?.revision ?? 0) + 1, createdById: authorId, ...data } })
        : await tx.planVersion.update({ where: { id: existing.id }, data });
      await tx.planFeatureEntitlement.deleteMany({ where: { planVersionId: version.id } });
      await tx.planQuota.deleteMany({ where: { planVersionId: version.id } });
      if (input.features.length > 0) await tx.planFeatureEntitlement.createMany({ data: [...new Set(input.features)].map((featureKey) => ({ planVersionId: version.id, featureKey })) });
      await tx.planQuota.createMany({ data: QUOTA_KEYS.map((resource) => {
        const limit = input.quotas[resource];
        return { planVersionId: version.id, resource, limit: limit === null ? null : BigInt(limit) };
      }) });
      await audit(tx, authorId, 'PLAN_DRAFT_SAVED', { versionId: version.id, input });
      return version.id;
    });
  }

  async preview(planId: number, versionId: number) {
    const version = await this.db.planVersion.findFirst({ where: { id: versionId, planId }, include: versionInclude });
    if (version === null) throw new AppError('Plan revision not found', 404);
    return { version: serialise(version), errors: this.publishErrors(version), previewToken: previewToken(version) };
  }

  async deleteDraft(planId: number, versionId: number, reason: string, authorId: number) {
    return this.transaction(async (tx) => {
      await this.lockPlan(tx, planId);
      const version = await tx.planVersion.findFirst({ where: { id: versionId, planId }, include: versionInclude });
      if (version === null) throw new AppError('Plan revision not found', 404);
      if (version.publishedAt !== null) throw new AppError('Published revisions cannot be deleted', 409);
      await tx.planVersion.delete({ where: { id: versionId } });
      await audit(tx, authorId, 'PLAN_DRAFT_DELETED', { version, reason });
    });
  }

  async publish(planId: number, versionId: number, reason: string, expectedPreviewToken: string, authorId: number) {
    return this.transaction(async (tx) => {
      await this.lockPlan(tx, planId);
      const version = await tx.planVersion.findFirst({ where: { id: versionId, planId }, include: versionInclude });
      if (version === null) throw new AppError('Plan revision not found', 404);
      if (version.publishedAt !== null) throw new AppError('Revision is already published', 409);
      if (previewToken(version) !== expectedPreviewToken) throw new AppError('The draft changed after preview; review it again before publishing', 409);
      const errors = this.publishErrors(version);
      if (errors.length > 0) throw new AppError('Plan cannot be published', 422, errors);
      const published = await tx.planVersion.update({ where: { id: versionId }, data: { publishedAt: new Date() } });
      await audit(tx, authorId, 'PLAN_PUBLISHED', { version: { ...version, publishedAt: published.publishedAt }, reason });
      return serialise(published);
    });
  }

  async archivePlan(id: number, reason: string, authorId: number) {
    return this.transaction(async (tx) => {
      await this.lockPlan(tx, id);
      const plan = await tx.plan.update({ where: { id }, data: { archivedAt: new Date() } });
      await audit(tx, authorId, 'PLAN_ARCHIVED', { plan, reason });
      return plan;
    });
  }

  async firmDetails(firmId: number, permissions: readonly string[], pages = { subscriptions: 1, overrides: 1, charges: 1 }) {
    const access = await getFirmEntitlements(this.db, firmId, permissions);
    const [subscriptions, overrides, charges, subscriptionCount, overrideCount, chargeCount] = await Promise.all([
      this.db.firmSubscription.findMany({ where: { firmId }, orderBy: { effectiveFrom: 'desc' }, skip: (pages.subscriptions - 1) * 20, take: 20 }),
      this.db.firmFeatureOverride.findMany({ where: { firmId }, orderBy: [{ startsAt: 'desc' }, { id: 'desc' }], skip: (pages.overrides - 1) * 20, take: 20 }),
      this.db.platformCharge.findMany({ where: { firmId }, orderBy: { id: 'desc' }, skip: (pages.charges - 1) * 20, take: 20, include: { payments: true } }),
      this.db.firmSubscription.count({ where: { firmId } }), this.db.firmFeatureOverride.count({ where: { firmId } }), this.db.platformCharge.count({ where: { firmId } }),
    ]);
    const pagination = {
      subscriptions: { page: pages.subscriptions, totalPages: Math.max(1, Math.ceil(subscriptionCount / 20)) },
      overrides: { page: pages.overrides, totalPages: Math.max(1, Math.ceil(overrideCount / 20)) },
      charges: { page: pages.charges, totalPages: Math.max(1, Math.ceil(chargeCount / 20)) },
    };
    return serialise({ access, subscriptions, overrides, charges, pagination, paymentMode: 'MANUAL' });
  }

  async assign(firmId: number, input: SubscriptionAssignmentInput, authorId: number) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const now = new Date();
      if (input.effectiveFrom.getTime() < now.getTime() - 60_000) throw new AppError('Subscription assignments cannot be backdated', 422);
      const snapshot = await loadEntitlements(tx, firmId, now);
      if ((snapshot.subscription?.id ?? null) !== input.expectedSubscriptionId) throw new AppError('Subscription changed; reload before assigning', 409);
      if (snapshot.subscription !== null && input.effectiveFrom <= snapshot.subscription.effectiveFrom) throw new AppError('Assignment must follow the current subscription start', 422);
      const future = await tx.firmSubscription.findFirst({ where: { firmId, effectiveFrom: { gt: now } } });
      if (future !== null) throw new AppError('A future assignment already exists; cancel it before scheduling another', 409);
      const version = await tx.planVersion.findUnique({ where: { id: input.planVersionId }, include: { ...versionInclude, plan: true } });
      const continuingRevision = version?.id === snapshot.subscription?.planVersionId;
      if (version === null || version.publishedAt === null || (!continuingRevision && (version.plan.archivedAt !== null || version.plan.isLegacy))) throw new AppError('Select a published, available plan revision', 422);
      const policyResult = subscriptionPolicySchema.safeParse(version.policy);
      if (version.plan.isLegacy && !['ACTIVE', 'SUSPENDED'].includes(input.status)) throw new AppError('Assign a plan with approved lifecycle terms before trial, grace or cancellation changes', 422);
      if (!policyResult.success && !version.plan.isLegacy) throw new AppError('Plan lifecycle policy is invalid', 422);
      const policy = policyResult.success ? policyResult.data : LEGACY_POLICY;
      if (input.status === 'TRIAL' && (policy.trialDays === 0 || input.trialEndsAt === null || input.trialEndsAt <= input.effectiveFrom || input.trialEndsAt.getTime() > input.effectiveFrom.getTime() + policy.trialDays * 86_400_000)) throw new AppError('Trial dates exceed the published trial policy', 422);
      if (input.status === 'PAST_DUE' && (policy.graceDays === 0 || input.graceEndsAt === null || input.graceEndsAt <= input.effectiveFrom || input.graceEndsAt.getTime() > input.effectiveFrom.getTime() + policy.graceDays * 86_400_000)) throw new AppError('Grace dates exceed the published grace policy', 422);
      if (input.status === 'CANCELLED' && policy.cancellationAccess === 'END_OF_TERM' && (input.currentPeriodEndsAt === null || input.currentPeriodEndsAt <= input.effectiveFrom)) throw new AppError('Cancellation requires an explicit term end', 422);
      const oldFeatures = snapshot.subscription?.planVersion.features.map((entry) => entry.featureKey) ?? FEATURE_KEYS.filter((key) => FEATURE_REGISTRY[key].legacy);
      const downgrade = oldFeatures.some((key) => !version.features.some((entry) => entry.featureKey === key)) || version.quotas.some((quota) => {
        const oldLimit = snapshot.limits[quota.resource as keyof typeof snapshot.limits];
        return quota.limit !== null && (oldLimit === null || (oldLimit !== undefined && quota.limit < oldLimit));
      });
      if (downgrade && policy.downgradeTiming === 'AT_RENEWAL' && (snapshot.subscription?.currentPeriodEndsAt === null || snapshot.subscription?.currentPeriodEndsAt === undefined || input.effectiveFrom < snapshot.subscription.currentPeriodEndsAt)) throw new AppError('This downgrade must take effect at or after the current term end', 422);
      const storageLimit = version.quotas.find((quota) => quota.resource === 'storageBytes')?.limit;
      if (storageLimit !== null && storageLimit !== undefined) {
        const counter = await tx.usageCounter.findUnique({ where: { firmId_resource: { firmId, resource: 'storageBytes' } } });
        if (counter?.ready !== true) throw new AppError('Reconcile storage usage before assigning a finite storage quota', 409);
      }
      // Bound the preceding revision explicitly; never rewrite its entitlement snapshot.
      if (snapshot.subscription !== null) {
        const currentEnd = snapshot.subscription.effectiveUntil;
        const effectiveUntil = currentEnd !== null && currentEnd < input.effectiveFrom ? currentEnd : input.effectiveFrom;
        await tx.firmSubscription.update({ where: { id: snapshot.subscription.id }, data: { effectiveUntil } });
      }
      const assigned = await tx.firmSubscription.create({ data: {
        firmId, authorId, planVersionId: input.planVersionId, status: input.status,
        effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil,
        trialEndsAt: input.trialEndsAt, graceEndsAt: input.graceEndsAt,
        currentPeriodEndsAt: input.currentPeriodEndsAt, renewalAt: input.renewalAt, reason: input.reason,
      } });
      await audit(tx, authorId, 'SUBSCRIPTION_ASSIGNED', { previousSubscriptionId: snapshot.subscription?.id ?? null, previousEffectiveUntil: snapshot.subscription?.effectiveUntil ?? null, assigned }, firmId);
      return assigned;
    });
  }

  async cancelScheduled(firmId: number, subscriptionId: number, reason: string, authorId: number) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const scheduled = await tx.firmSubscription.findFirst({ where: { id: subscriptionId, firmId, effectiveFrom: { gt: new Date() } } });
      if (scheduled === null) throw new AppError('Scheduled subscription not found', 404);
      // Restore the prior end exactly from the assignment event, not an invented renewal.
      const event = await tx.subscriptionEvent.findFirst({ where: { firmId, kind: 'SUBSCRIPTION_ASSIGNED', payload: { path: '$.assigned.id', equals: scheduled.id } }, orderBy: { id: 'desc' } });
      const payload = event?.payload as { previousSubscriptionId?: number | null; previousEffectiveUntil?: string | null } | undefined;
      if (payload === undefined || !Object.hasOwn(payload, 'previousEffectiveUntil') || !Object.hasOwn(payload, 'previousSubscriptionId')) throw new AppError('Assignment provenance is missing; reconcile the schedule before cancelling', 409);
      await tx.firmSubscription.delete({ where: { id: scheduled.id } });
      if (payload.previousSubscriptionId !== null && payload.previousSubscriptionId !== undefined) {
        const previous = await tx.firmSubscription.findFirst({ where: { id: payload.previousSubscriptionId, firmId } });
        if (previous === null) throw new AppError('Previous subscription is unavailable', 409);
        await tx.firmSubscription.update({ where: { id: previous.id }, data: { effectiveUntil: payload.previousEffectiveUntil ? new Date(payload.previousEffectiveUntil) : null } });
      }
      await audit(tx, authorId, 'SCHEDULED_SUBSCRIPTION_CANCELLED', { scheduled, reason }, firmId);
    });
  }

  async override(firmId: number, input: FirmOverrideInput, authorId: number) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      if (input.expiresAt !== null && input.expiresAt <= new Date()) throw new AppError('Override is already expired', 422);
      if (input.target === 'quota:storageBytes' && input.limit !== null) {
        const counter = await tx.usageCounter.findUnique({ where: { firmId_resource: { firmId, resource: 'storageBytes' } } });
        if (counter?.ready !== true) throw new AppError('Reconcile storage usage before adding a storage limit', 409);
      }
      const override = await tx.firmFeatureOverride.create({ data: { ...input, limit: input.limit === null ? null : BigInt(input.limit), firmId, authorId } });
      await audit(tx, authorId, 'OVERRIDE_CREATED', override, firmId);
      return serialise(override);
    });
  }

  async revokeOverride(firmId: number, overrideId: number, reason: string, authorId: number) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const override = await tx.firmFeatureOverride.findFirst({ where: { id: overrideId, firmId, revokedAt: null } });
      if (override === null) throw new AppError('Override not found', 404);
      await tx.firmFeatureOverride.update({ where: { id: overrideId }, data: { revokedAt: new Date() } });
      await audit(tx, authorId, 'OVERRIDE_REVOKED', { override, reason }, firmId);
    });
  }

  async reconcile(firmId: number, reason: string, authorId: number) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const usage = await reconcileFirmUsage(tx, firmId);
      await audit(tx, authorId, 'USAGE_RECONCILED', { usage, reason }, firmId);
      return usage;
    });
  }

  async events(firmId: number | undefined, page: number, limit: number) {
    const where = firmId === undefined ? {} : { firmId };
    const [events, total] = await Promise.all([
      this.db.subscriptionEvent.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.db.subscriptionEvent.count({ where }),
    ]);
    return { events, total };
  }

  async usageEvents(firmId: number, page: number, limit: number) {
    const [events, total] = await Promise.all([
      this.db.usageEvent.findMany({ where: { firmId }, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.db.usageEvent.count({ where: { firmId } }),
    ]);
    return serialise({ events, total });
  }

  async createCharge(firmId: number, input: PlatformChargeInput, authorId: number) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const existing = await tx.platformCharge.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing !== null) {
        if (existing.firmId !== firmId || !existing.amount.equals(input.amount) || existing.currency !== input.currency || existing.reason !== input.reason) throw new AppError('Charge key conflicts with an existing event', 409);
        return existing;
      }
      const charge = await tx.platformCharge.create({ data: { ...input, firmId, authorId } });
      await audit(tx, authorId, 'MANUAL_CHARGE_CREATED', charge, firmId);
      return charge;
    });
  }

  async recordPayment(firmId: number, chargeId: number, input: PlatformPaymentInput, authorId: number) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const charge = await tx.platformCharge.findFirst({ where: { id: chargeId, firmId }, include: { payments: true } });
      if (charge === null) throw new AppError('Platform charge not found', 404);
      const existing = await tx.paymentEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing !== null) {
        if (existing.chargeId !== chargeId || existing.kind !== input.kind || !existing.amount.equals(input.amount) || existing.reference !== input.reference || existing.reason !== input.reason) throw new AppError('Payment key conflicts with an existing event', 409);
        return existing;
      }
      const paid = charge.payments.reduce((sum, entry) => entry.kind === 'PAYMENT' ? sum.plus(entry.amount) : sum.minus(entry.amount), new Prisma.Decimal(0));
      const amount = new Prisma.Decimal(input.amount);
      if ((input.kind === 'PAYMENT' && paid.plus(amount).greaterThan(charge.amount)) || (input.kind === 'REFUND' && amount.greaterThan(paid))) throw new AppError('Payment or refund exceeds the outstanding balance', 409);
      const payment = await tx.paymentEvent.create({ data: { ...input, chargeId, authorId } });
      await audit(tx, authorId, 'MANUAL_PAYMENT_RECORDED', { chargeId, currency: charge.currency, payment }, firmId);
      return payment;
    });
  }

  private async lockPlan(tx: EntitlementTransaction, id: number) {
    const plans = await tx.$queryRaw<Array<{ id: number; is_legacy: number; archived_at: Date | null }>>`SELECT id, is_legacy, archived_at FROM platform_plans WHERE id = ${id} FOR UPDATE`;
    const plan = plans[0];
    if (plan === undefined) throw new AppError('Plan not found', 404);
    if (plan.is_legacy) throw new AppError('The legacy compatibility plan is immutable', 409);
    return plan;
  }

  private async transaction<T>(work: (tx: EntitlementTransaction) => Promise<T>) {
    try { return await this.db.$transaction(work); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new AppError('The plan or feature change conflicts with an existing or concurrent change', 409);
      throw error;
    }
  }

  private publishErrors(version: { features: Array<{ featureKey: string }>; quotas: Array<{ resource: string; limit: bigint | null }>; policy: Prisma.JsonValue }) {
    const errors: string[] = [];
    try { validateFeatureSelection(version.features.map((entry) => entry.featureKey)); } catch (error) { errors.push(error instanceof Error ? error.message : 'Invalid features'); }
    if (!subscriptionPolicySchema.safeParse(version.policy).success) errors.push('Explicitly approve every lifecycle policy before publishing');
    for (const resource of QUOTA_KEYS) if (!version.quotas.some((quota) => quota.resource === resource)) errors.push(`Missing quota: ${resource}`);
    const users = version.quotas.find((quota) => quota.resource === 'users')?.limit;
    if (users === undefined || users === null || users < 1n || users > 2147483647n) errors.push('A finite positive user quota is required');
    if (version.quotas.some((quota) => !(QUOTA_KEYS as readonly string[]).includes(quota.resource) || (quota.limit !== null && quota.limit < 0n))) errors.push('Unknown or invalid quota');
    const ai = version.quotas.find((quota) => quota.resource === 'aiCredits')?.limit;
    if (!version.features.some((feature) => feature.featureKey === 'ai.credits') && (ai === null || (ai !== undefined && ai > 0n))) errors.push('AI quota requires the AI entitlement');
    return errors;
  }
}

export const platformSubscriptionsRepository = new PlatformSubscriptionsRepository(prisma);
