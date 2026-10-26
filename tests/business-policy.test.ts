import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BusinessPolicyRepository, DEFAULT_BUSINESS_POLICY, resolveBusinessPolicy } from '../src/modules/settings/business-policy/business-policy.repository.js';
import { businessPolicySchema } from '../src/modules/settings/business-policy/business-policy.schema.js';

const dependencies = vi.hoisted(() => ({ access: vi.fn(), actor: vi.fn(), notify: vi.fn() }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: dependencies.access,
  withFirmEntitlementTransaction: async (db: { $transaction: (callback: unknown) => unknown }, _firmId: number, work: unknown) => db.$transaction(work) }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: dependencies.actor }));
vi.mock('../src/modules/notifications/index.js', () => ({ enqueueInAppNotification: dependencies.notify }));

function database() {
  const tx = {
    firmBusinessPolicy: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 12 }) },
    notificationPreference: { upsert: vi.fn() }, user: { findFirst: vi.fn().mockResolvedValue({ id: 10, firmId: 1 }) },
    auditLog: { create: vi.fn() },
  };
  const db = { ...tx, $transaction: vi.fn(async (work) => work(tx)) };
  return { tx, db: db as unknown as PrismaClient };
}
beforeEach(() => vi.resetAllMocks());

describe('versioned firm business configuration', () => {
  it('uses explicit safe defaults and fails closed on unknown persisted versions', async () => {
    const { tx, db } = database();
    await expect(resolveBusinessPolicy(db, 1)).resolves.toEqual({ version: 0, policy: DEFAULT_BUSINESS_POLICY });
    tx.firmBusinessPolicy.findFirst.mockResolvedValue({ version: 9, policy: { schemaVersion: 2 } });
    await expect(resolveBusinessPolicy(db, 1)).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.firmBusinessPolicy.findFirst).toHaveBeenCalledWith({ where: { firmId: 1 }, orderBy: { version: 'desc' } });
  });
  it('requires an explicit supported jurisdiction/currency pairing', () => {
    expect(businessPolicySchema.safeParse({ ...DEFAULT_BUSINESS_POLICY, currency: 'USD', tax: { id: 'india-gst', version: 1, country: 'IN', mode: 'IGST', rate: '18' } }).success).toBe(false);
    expect(businessPolicySchema.safeParse({ ...DEFAULT_BUSINESS_POLICY, tax: { id: 'unapproved', version: 1 } }).success).toBe(false);
    expect(businessPolicySchema.safeParse({ ...DEFAULT_BUSINESS_POLICY, currency: 'KWD' }).success).toBe(true);
  });
  it('atomically appends a version with audit, preference and module-owned notification', async () => {
    const { tx, db } = database();
    const result = await new BusinessPolicyRepository(db).update(1, 10, 0, DEFAULT_BUSINESS_POLICY, {});
    expect(result.version).toBe(1);
    expect(dependencies.actor).toHaveBeenCalledWith(tx, 1, 10, 'firm.profile.manage');
    expect(dependencies.access).toHaveBeenCalledWith(tx, 1, 'firm.core');
    expect(tx.firmBusinessPolicy.create).toHaveBeenCalledWith({ data: { firmId: 1, actorId: 10, version: 1, policy: DEFAULT_BUSINESS_POLICY } });
    expect(dependencies.notify).toHaveBeenCalledWith(tx, { firmId: 1, actorId: 10, sourceEventId: 'business-policy:1:1' }, expect.objectContaining({ recipientId: 10, resource: { type: 'business-policy', version: 1 } }));
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
  it('rejects concurrent stale settings without writing a second version', async () => {
    const { tx, db } = database();
    tx.firmBusinessPolicy.findFirst.mockResolvedValue({ version: 2, policy: DEFAULT_BUSINESS_POLICY });
    await expect(new BusinessPolicyRepository(db).update(1, 10, 1, DEFAULT_BUSINESS_POLICY, {})).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.firmBusinessPolicy.create).not.toHaveBeenCalled();
  });
  it('denies the write before persistence on revoked permission or entitlement', async () => {
    for (const dependency of [dependencies.actor, dependencies.access]) {
      const { tx, db } = database(); dependency.mockRejectedValueOnce(new Error('denied'));
      await expect(new BusinessPolicyRepository(db).update(1, 10, 0, DEFAULT_BUSINESS_POLICY, {})).rejects.toThrow('denied');
      expect(tx.firmBusinessPolicy.create).not.toHaveBeenCalled();
    }
  });
  it('propagates audit failure and does not enqueue without its audit', async () => {
    const { tx, db } = database(); tx.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(new BusinessPolicyRepository(db).update(1, 10, 0, DEFAULT_BUSINESS_POLICY, {})).rejects.toThrow('audit unavailable');
    expect(dependencies.notify).not.toHaveBeenCalled();
  });
});
