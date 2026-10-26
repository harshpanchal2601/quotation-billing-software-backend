import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { storageService } from '../../integrations/storage/index.js';
import { activeOverride, effectiveQuota, evaluateFeature, featureForQuota, quotaAllows, type AccessOverride, type EntitlementContext } from './entitlement-evaluator.js';
import { FEATURE_KEYS, FEATURE_REGISTRY, PERMISSION_FEATURES, QUOTA_KEYS, type FeatureKey, type QuotaKey } from './feature-registry.js';
import { LEGACY_POLICY, subscriptionPolicySchema } from './entitlements.schema.js';

export type EntitlementTransaction = Prisma.TransactionClient;

export async function lockEntitlementFirm(tx: EntitlementTransaction, firmId: number) {
  const rows = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM firms WHERE id = ${firmId} AND deleted_at IS NULL FOR UPDATE`;
  if (rows.length !== 1) throw new AppError('Firm not found', 404);
}

export async function withFirmEntitlementTransaction<T>(db: PrismaClient, firmId: number, work: (tx: EntitlementTransaction) => Promise<T>) {
  try {
    return await db.$transaction(async (tx) => {
      await lockEntitlementFirm(tx, firmId);
      return work(tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new AppError('The operation conflicts with an existing or concurrent change; reload and retry', 409);
    throw error;
  }
}

export async function loadEntitlements(db: PrismaClient | EntitlementTransaction, firmId: number, now = new Date()) {
  const [firm, subscription, switches, overrides] = await Promise.all([
    db.firm.findFirst({ where: { id: firmId, deletedAt: null } }),
    db.firmSubscription.findFirst({
      where: { firmId, effectiveFrom: { lte: now } }, orderBy: { effectiveFrom: 'desc' },
      include: { planVersion: { include: { features: true, quotas: true, plan: true } } },
    }),
    db.platformFeatureSwitch.findMany({ where: { hardDisabled: true } }),
    db.$queryRaw<AccessOverride[]>`
      SELECT o.id, o.target, o.effect, o.\`limit\`, o.starts_at AS startsAt,
        o.expires_at AS expiresAt, o.revoked_at AS revokedAt
      FROM firm_feature_overrides o
      JOIN (SELECT target, MAX(starts_at) AS starts_at FROM firm_feature_overrides
        WHERE firm_id = ${firmId} AND starts_at <= ${now} GROUP BY target) latest
        ON latest.target = o.target AND latest.starts_at = o.starts_at
      WHERE o.firm_id = ${firmId}`,
  ]);
  if (firm === null) throw new AppError('Firm not found', 404);
  const policy = subscriptionPolicySchema.safeParse(subscription?.planVersion.policy);
  // Legacy snapshots carry no approved commercial policy. Only existing
  // active/suspended behavior is adapted; trial/grace/cancellation require a
  // separately published plan with explicitly approved lifecycle terms.
  const compatibilityPolicy = subscription?.planVersion.plan.isLegacy === true && ['ACTIVE', 'SUSPENDED'].includes(subscription.status) ? LEGACY_POLICY : null;
  const effectivePolicy = policy.success ? policy.data : compatibilityPolicy;
  const context: EntitlementContext = {
    firmActive: firm.status === 'ACTIVE', legacy: subscription === null,
    subscription: subscription === null || effectivePolicy === null || subscription.planVersion.publishedAt === null
      ? null : { ...subscription, policy: effectivePolicy },
    features: new Set(subscription?.planVersion.features.map((feature) => feature.featureKey) ?? []),
    hardDisabled: new Set(switches.map((entry) => entry.key)), overrides, now,
  };
  const limits = Object.fromEntries(QUOTA_KEYS.map((key) => {
    const baseline = subscription === null ? (key === 'users' ? BigInt(firm.userLimit) : key === 'aiCredits' ? 0n : null)
      : subscription.planVersion.quotas.find((entry) => entry.resource === key)?.limit ?? null;
    return [key, effectiveQuota(context, key, baseline)];
  })) as Record<QuotaKey, bigint | null>;
  return { context, limits, subscription, firm };
}

export async function assertFeatureEntitlements(firmId: number, permissions: readonly string[]) {
  const { context } = await loadEntitlements(prisma, firmId);
  if (!permissions.some((permission) => {
    const key = PERMISSION_FEATURES[permission];
    return key !== undefined && evaluateFeature(context, key).allowed;
  })) throw new AppError('Your subscription does not allow this action', 403, { code: 'ENTITLEMENT_DENIED' });
}

async function ensureCounter(tx: EntitlementTransaction, firmId: number, resource: QuotaKey) {
  const existing = await tx.usageCounter.findUnique({ where: { firmId_resource: { firmId, resource } } });
  if (existing !== null) return existing;
  const used = resource === 'users' ? BigInt(await tx.user.count({ where: { firmId, deletedAt: null } }))
    : resource === 'documents' ? BigInt(await tx.generatedDocument.count({ where: { quotation: { firmId } } })) : 0n;
  const counter = await tx.usageCounter.create({ data: { firmId, resource, used, ready: resource !== 'storageBytes' } });
  if (counter.ready) await tx.usageEvent.create({ data: { firmId, resource, eventId: 'system:counter-baseline', delta: used } });
  return counter;
}

// Caller holds the firm's row lock and performs the resource write in this SAME transaction.
// Event uniqueness, counter change and resource write either all commit or all roll back.
export async function recordUsage(tx: EntitlementTransaction, firmId: number, resource: QuotaKey, delta: bigint, eventId: string) {
  const existing = await tx.usageEvent.findUnique({ where: { firmId_resource_eventId: { firmId, resource, eventId } } });
  if (existing !== null) {
    if (existing.delta !== delta) throw new AppError('Usage event ID was reused with a different amount', 409);
    return false;
  }
  const counter = await ensureCounter(tx, firmId, resource);
  const snapshot = await loadEntitlements(tx, firmId);
  const limit = snapshot.limits[resource];
  if (delta > 0n) {
    const decision = evaluateFeature(snapshot.context, featureForQuota(resource));
    if (!decision.allowed) throw new AppError('Subscription access is unavailable', 403, { code: decision.reason });
  }
  if (!counter.ready && limit !== null) throw new AppError('Reconcile storage usage before enforcing a storage limit', 409);
  const balance = counter.ready ? counter.used : counter.pendingDelta;
  if ((counter.ready && !quotaAllows(counter.used, delta, limit)) || balance + delta > 9223372036854775807n || balance + delta < -9223372036854775808n) throw new AppError(`${resource} quota exceeded or invalid release`, 409, { code: 'QUOTA_EXCEEDED', resource });
  // Until a legacy baseline is measured, preserve ordinary unlimited writes
  // and account their signed deltas separately. Never report a partial total.
  await tx.usageCounter.update({ where: { firmId_resource: { firmId, resource } }, data: counter.ready ? { used: { increment: delta } } : { pendingDelta: { increment: delta } } });
  await tx.usageEvent.create({ data: { firmId, resource, eventId, delta } });
  return true;
}

export async function storageFileBytes(filePath: string | null) {
  if (filePath === null) return 0n;
  return BigInt(await storageService.storageFileSize(filePath.replace(/^\/?storage\//, '')));
}

export async function prepareStorageUsage(tx: EntitlementTransaction, firmId: number) {
  await ensureCounter(tx, firmId, 'storageBytes');
}

// Call after changing the reference, within the locked transaction. Shared
// legacy paths are released only when this firm's last reference is removed.
export async function recordStorageReplacement(tx: EntitlementTransaction, firmId: number, newBytes: bigint, previousPath: string | null, eventId: string) {
  let released = 0n;
  let unreferenced = false;
  if (previousPath !== null) {
    const [item, profile, document, attachment] = await Promise.all([
      tx.item.findFirst({ where: { firmId, imagePath: previousPath }, select: { id: true } }),
      tx.businessProfile.findFirst({ where: { firmId, OR: [{ logoPath: previousPath }, { signaturePath: previousPath }, { stampPath: previousPath }] }, select: { id: true } }),
      tx.generatedDocument.findFirst({ where: { quotation: { firmId }, filePath: previousPath }, select: { id: true } }),
      tx.quotationAttachment.findFirst({ where: { quotation: { firmId }, filePath: previousPath, deletedAt: null }, select: { id: true } }),
    ]);
    unreferenced = item === null && profile === null && document === null && attachment === null;
    if (unreferenced) released = await storageFileBytes(previousPath);
  }
  await recordUsage(tx, firmId, 'storageBytes', newBytes - released, eventId);
  return unreferenced;
}

export async function reconcileFirmUsage(tx: EntitlementTransaction, firmId: number) {
  const [users, documents, attachments, images, profile] = await Promise.all([
    tx.user.count({ where: { firmId, deletedAt: null } }),
    tx.generatedDocument.findMany({ where: { quotation: { firmId } }, select: { filePath: true } }),
    tx.quotationAttachment.findMany({ where: { quotation: { firmId }, deletedAt: null }, select: { filePath: true } }),
    tx.item.findMany({ where: { firmId, imagePath: { not: null } }, select: { imagePath: true } }),
    tx.businessProfile.findUnique({ where: { firmId }, select: { logoPath: true, signaturePath: true, stampPath: true } }),
  ]);
  const paths = new Set([
    ...documents.map((entry) => entry.filePath), ...attachments.map((entry) => entry.filePath),
    ...images.map((entry) => entry.imagePath), profile?.logoPath, profile?.signaturePath, profile?.stampPath,
  ].filter((value): value is string => typeof value === 'string').map((value) => value.replace(/^\/?storage\//, '')));
  let bytes = 0n;
  for (const filePath of paths) bytes += await storageFileBytes(filePath);
  for (const [resource, used] of [['users', BigInt(users)], ['documents', BigInt(documents.length)], ['storageBytes', bytes]] as const) {
    const previous = await ensureCounter(tx, firmId, resource);
    const previousBalance = previous.ready ? previous.used : previous.pendingDelta;
    await tx.usageCounter.update({ where: { firmId_resource: { firmId, resource } }, data: { used, pendingDelta: 0n, ready: true } });
    await tx.usageEvent.create({ data: { firmId, resource, eventId: `reconcile:${randomUUID()}`, delta: used - previousBalance } });
  }
  return { users: String(users), documents: String(documents.length), storageBytes: bytes.toString() };
}

export async function getFirmEntitlements(db: PrismaClient, firmId: number, permissions: readonly string[]) {
  return withFirmEntitlementTransaction(db, firmId, async (tx) => {
    const snapshot = await loadEntitlements(tx, firmId);
    const { context, limits, subscription } = snapshot;
    const features = FEATURE_KEYS.map((key) => {
      const available = evaluateFeature(context, key);
      const authorized = Object.entries(PERMISSION_FEATURES).some(([permission, feature]) => feature === key && permissions.includes(permission));
      return { key, ...FEATURE_REGISTRY[key], available: available.allowed, ...evaluateFeature(context, key, authorized) };
    });
    const quotaEntries = [];
    for (const resource of QUOTA_KEYS) {
      const counter = await ensureCounter(tx, firmId, resource);
      const limit = limits[resource];
      quotaEntries.push({ resource, used: counter.used.toString(), limit: limit?.toString() ?? null,
        remaining: limit === null ? null : (limit > counter.used ? limit - counter.used : 0n).toString(), ready: counter.ready,
        overrideId: activeOverride(context.overrides, `quota:${resource}`, context.now)?.id ?? null });
    }
    return {
      firmId, legacy: context.legacy, evaluatedAt: context.now.toISOString(), features, quotas: quotaEntries,
      permissions: Object.fromEntries(Object.entries(PERMISSION_FEATURES).map(([permission, key]) => [permission, evaluateFeature(context, key, permissions.includes(permission)).allowed])),
      subscription: subscription === null ? null : {
        id: subscription.id, status: subscription.status, planVersionId: subscription.planVersionId,
        planName: subscription.planVersion.plan.name, revision: subscription.planVersion.revision,
        effectiveFrom: subscription.effectiveFrom, effectiveUntil: subscription.effectiveUntil,
        trialEndsAt: subscription.trialEndsAt, graceEndsAt: subscription.graceEndsAt,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt, renewalAt: subscription.renewalAt,
      },
    };
  });
}

export async function assertTransactionFeature(tx: EntitlementTransaction, firmId: number, key: FeatureKey) {
  const { context } = await loadEntitlements(tx, firmId);
  const decision = evaluateFeature(context, key);
  if (!decision.allowed) throw new AppError('Feature access is unavailable', 403, { code: decision.reason });
}

export async function initializeLegacySubscription(tx: EntitlementTransaction, firmId: number, authorId: number) {
  const version = await tx.planVersion.findFirst({ where: { plan: { slug: 'legacy-compatible', isLegacy: true }, revision: 4, publishedAt: { not: null } } });
  if (version === null) throw new AppError('Apply the platform plan migration before creating firms', 503);
  const subscription = await tx.firmSubscription.create({ data: { firmId, planVersionId: version.id, status: 'ACTIVE', effectiveFrom: new Date(), authorId, reason: 'Preserve existing firm provisioning policy' } });
  await tx.subscriptionEvent.create({ data: { firmId, authorId, kind: 'LEGACY_SUBSCRIPTION_CREATED', payload: { subscriptionId: subscription.id, planVersionId: version.id } } });
}
