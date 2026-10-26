import { AuditAction, type Prisma, type PrismaClient } from '@prisma/client';
import { createAuditLog, type RequestMetadata } from '../../../core/audit/audit-log.service.js';
import { prisma } from '../../../core/database/prisma.js';
import { AppError } from '../../../core/errors/AppError.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../../entitlements/index.js';
import { authorizeFirmJobActor } from '../../auth/index.js';
import { PERMISSIONS } from '../../auth/permissions.js';
import { enqueueInAppNotification } from '../../notifications/index.js';
import { businessPolicySchema, type BusinessPolicy } from './business-policy.schema.js';

// No inferred tax regime: each domain must explicitly select a tax policy.
export const DEFAULT_BUSINESS_POLICY: Readonly<BusinessPolicy> = Object.freeze({ schemaVersion: 1, currency: 'INR', rounding: 'HALF_UP', grandTotal: 'WHOLE_UNIT', tax: Object.freeze({ id: 'none', version: 1 }), inAppNotifications: true });

export async function resolveBusinessPolicy(db: PrismaClient | Prisma.TransactionClient, firmId: number) {
  const record = await db.firmBusinessPolicy.findFirst({ where: { firmId }, orderBy: { version: 'desc' } });
  if (record === null) return { version: 0, policy: businessPolicySchema.parse(DEFAULT_BUSINESS_POLICY) };
  const parsed = businessPolicySchema.safeParse(record.policy);
  if (!parsed.success) throw new AppError('Business policy version is unsupported', 409);
  return { version: record.version, policy: parsed.data };
}

export class BusinessPolicyRepository {
  constructor(private readonly db: PrismaClient) {}
  async get(firmId: number) {
    await assertTransactionFeature(this.db, firmId, 'firm.core');
    return resolveBusinessPolicy(this.db, firmId);
  }
  async update(firmId: number, actorId: number, expectedVersion: number, input: BusinessPolicy, metadata: RequestMetadata) {
    const policy = businessPolicySchema.parse(input);
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.FIRM_PROFILE_MANAGE);
      await assertTransactionFeature(tx, firmId, 'firm.core');
      const previous = await resolveBusinessPolicy(tx, firmId);
      if (previous.version !== expectedVersion) throw new AppError('Business policy changed; reload before saving', 409);
      const version = previous.version + 1;
      const record = await tx.firmBusinessPolicy.create({ data: { firmId, actorId, version, policy } });
      await tx.notificationPreference.upsert({ where: { firmId_channel: { firmId, channel: 'IN_APP' } }, create: { firmId, channel: 'IN_APP', enabled: policy.inAppNotifications }, update: { enabled: policy.inAppNotifications } });
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'FirmBusinessPolicy', entityId: String(record.id), action: AuditAction.UPDATE, policy: 'REQUIRED', oldValues: { version: previous.version, policy: previous.policy }, newValues: { version, policy } });
      // Business trigger stays in Settings; delivery mechanics are shared.
      // Platform actors have no firm inbox, so do not create a foreign recipient.
      const recipient = await tx.user.findFirst({ where: { id: actorId, firmId, deletedAt: null, status: 'ACTIVE' } });
      if (policy.inAppNotifications && recipient !== null) await enqueueInAppNotification(tx, { firmId, actorId, sourceEventId: `business-policy:${firmId}:${version}` }, { resource: { type: 'business-policy', version }, recipientId: actorId, title: 'Business policy saved', body: `Business policy version ${version} is available for new financial workflows.` });
      return { version, policy };
    });
  }
}

export const businessPolicyRepository = new BusinessPolicyRepository(prisma);
