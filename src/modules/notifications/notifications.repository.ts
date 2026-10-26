import { type OutboxEvent, type Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { enqueueOutbox, type JobHandler } from '../../core/outbox/index.js';
import { AppError } from '../../core/errors/AppError.js';
import { prisma } from '../../core/database/prisma.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature } from '../entitlements/index.js';

const payloadSchema = z.object({
  resource: z.object({ type: z.literal('business-policy'), version: z.number().int().positive() }).strict(),
  recipientId: z.number().int().positive(), title: z.string().trim().min(1).max(191), body: z.string().trim().min(1).max(5000),
}).strict();
export type InAppNotification = z.infer<typeof payloadSchema>;
function parsePayload(value: unknown) {
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) throw new AppError('Invalid notification payload', 400);
  return parsed.data;
}

export async function enqueueInAppNotification(tx: Prisma.TransactionClient, identity: {
  firmId: number; actorId: number; sourceEventId: string;
}, notification: InAppNotification) {
  const payload = parsePayload(notification);
  return enqueueOutbox(tx, { ...identity, kind: 'notifications.in-app.v1', idempotencyKey: `notification:${identity.sourceEventId}:${payload.recipientId}`, payload });
}

async function authorize(tx: Prisma.TransactionClient, event: OutboxEvent) {
  const payload = parsePayload(event.payload);
  await authorizeFirmJobActor(tx, event.firmId, event.actorId, PERMISSIONS.FIRM_PROFILE_MANAGE);
  await assertTransactionFeature(tx, event.firmId, 'firm.core');
  const [policy, recipient] = await Promise.all([
    tx.firmBusinessPolicy.findUnique({ where: { firmId_version: { firmId: event.firmId, version: payload.resource.version } } }),
    tx.user.findFirst({ where: { id: payload.recipientId, firmId: event.firmId, status: 'ACTIVE', deletedAt: null } }),
  ]);
  if (policy === null || recipient === null) throw new AppError('Notification resource unavailable', 404);
}

export const inAppNotificationHandler: JobHandler = {
  retry: 'TRANSACTIONAL', authorize,
  async execute(tx, event) {
    const payload = parsePayload(event.payload);
    const preference = await tx.notificationPreference.findUnique({ where: { firmId_channel: { firmId: event.firmId, channel: 'IN_APP' } } });
    if (preference?.enabled === false) return;
    await tx.notificationDelivery.upsert({
      where: { eventId_recipientId: { eventId: event.id, recipientId: payload.recipientId } },
      create: { eventId: event.id, firmId: event.firmId, recipientId: payload.recipientId, title: payload.title, body: payload.body },
      update: {},
    });
  },
};

export async function listNotifications(db: PrismaClient, firmId: number, recipientId: number) {
  // Reads revalidate firm access through middleware and plan entitlement here.
  await assertTransactionFeature(db, firmId, 'firm.core');
  return db.notificationDelivery.findMany({ where: { firmId, recipientId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
    select: { id: true, title: true, body: true, createdAt: true } });
}

export const notificationRepository = { list: (firmId: number, actorId: number) => listNotifications(prisma, firmId, actorId) };
