import { AccountType, type OutboxEvent, type Prisma, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inAppNotificationHandler, listNotifications } from '../src/modules/notifications/notifications.repository.js';
import { authorizeFirmJobActor } from '../src/modules/auth/auth.worker.js';
import { AppError } from '../src/core/errors/AppError.js';
import { PERMISSIONS } from '../src/modules/auth/permissions.js';

const access = vi.hoisted(() => vi.fn());
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: access }));

function actor(overrides: Record<string, unknown> = {}) {
  return { id: 10, firmId: 1, accountType: AccountType.FIRM_ADMIN, status: 'ACTIVE', deletedAt: null, mustChangePassword: false,
    firm: { id: 1, status: 'ACTIVE', deletedAt: null }, firmRole: null, ...overrides };
}
function fixture() {
  const db = {
    user: { findFirst: vi.fn(async ({ where }: { where: { firmId?: number } }) => where.firmId === undefined ? actor() : { id: 20, firmId: 1 }) },
    firmBusinessPolicy: { findUnique: vi.fn().mockResolvedValue({ firmId: 1, version: 1 }) },
    notificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
    notificationDelivery: { upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  };
  return { db, tx: db as unknown as Prisma.TransactionClient };
}
const event = { id: 'event-1', firmId: 1, actorId: 10, payload: { recipientId: 20, resource: { type: 'business-policy', version: 1 }, title: 'Saved', body: 'Policy saved' } } as unknown as OutboxEvent;
beforeEach(() => vi.resetAllMocks());

describe('worker identity and notification ownership', () => {
  it('revalidates current actor, feature and both owned IDs before delivery', async () => {
    const { db, tx } = fixture();
    await inAppNotificationHandler.authorize(tx, event);
    await inAppNotificationHandler.execute(tx, event);
    expect(access).toHaveBeenCalledWith(tx, 1, 'firm.core');
    expect(db.firmBusinessPolicy.findUnique).toHaveBeenCalledWith({ where: { firmId_version: { firmId: 1, version: 1 } } });
    expect(db.user.findFirst).toHaveBeenLastCalledWith({ where: { id: 20, firmId: 1, status: 'ACTIVE', deletedAt: null } });
    expect(db.notificationDelivery.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId_recipientId: { eventId: event.id, recipientId: 20 } }, create: expect.objectContaining({ firmId: 1, recipientId: 20 }) }));
  });
  it.each([
    ['foreign tenant', { firmId: 2 }],
    ['suspended firm', { firm: { id: 1, status: 'SUSPENDED', deletedAt: null } }],
    ['inactive actor', { status: 'INACTIVE' }],
    ['password reset required', { mustChangePassword: true }],
    ['denied role', { accountType: AccountType.FIRM_USER, firmRole: { firmId: 1, deletedAt: null, permissions: ['quotations.view'] } }],
    ['deleted role', { accountType: AccountType.FIRM_USER, firmRole: { firmId: 1, deletedAt: new Date(), permissions: [] } }],
  ])('denies %s identities at execution time', async (_label, changes) => {
    const { db, tx } = fixture(); db.user.findFirst.mockResolvedValue(actor(changes));
    await expect(authorizeFirmJobActor(tx, 1, 10, PERMISSIONS.FIRM_PROFILE_MANAGE)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.notificationDelivery.upsert).not.toHaveBeenCalled();
  });
  it('denies foreign resource/recipient IDs and malformed poison payloads', async () => {
    const { db, tx } = fixture();
    db.firmBusinessPolicy.findUnique.mockResolvedValueOnce(null);
    await expect(inAppNotificationHandler.authorize(tx, event)).rejects.toMatchObject({ statusCode: 404 });
    db.user.findFirst.mockImplementation(async ({ where }) => where.firmId === undefined ? actor() : null);
    await expect(inAppNotificationHandler.authorize(tx, event)).rejects.toMatchObject({ statusCode: 404 });
    await expect(inAppNotificationHandler.authorize(tx, { ...event, payload: { filePath: 'firms/2/private.pdf' } })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('denies a disabled entitlement even when RBAC permits', async () => {
    const { tx } = fixture(); access.mockRejectedValueOnce(new AppError('Feature disabled', 403));
    await expect(inAppNotificationHandler.authorize(tx, event)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('honors current preferences on each dispatch and scopes list to firm and recipient', async () => {
    const { db, tx } = fixture(); db.notificationPreference.findUnique.mockResolvedValue({ enabled: false });
    await inAppNotificationHandler.execute(tx, event);
    expect(db.notificationDelivery.upsert).not.toHaveBeenCalled();
    await listNotifications(db as unknown as PrismaClient, 1, 20);
    expect(db.notificationDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 1, recipientId: 20 }, take: 100 }));
  });
});
