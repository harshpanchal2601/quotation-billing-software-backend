import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from '../core/database/prisma.js';
import { OutboxRepository, startOutboxWorker } from '../core/outbox/index.js';
import { inAppNotificationHandler } from '../modules/notifications/index.js';

export function startConfiguredOutboxWorker() {
  if (!env.OUTBOX_WORKER_ENABLED) return { stop: async () => undefined };
  const repository = new OutboxRepository(prisma, { 'notifications.in-app.v1': inAppNotificationHandler });
  return startOutboxWorker(repository, `local:${randomUUID()}`, env.OUTBOX_POLL_INTERVAL_MS);
}
