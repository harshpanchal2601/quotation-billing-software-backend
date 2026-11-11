import { listOrderBy, type ListSort } from '../../core/validation/list-sort.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { AuditAction, type OutboxEvent, type Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { enqueueOutbox, type JobHandler } from '../../core/outbox/index.js';
import { encryptWebhookSecret, decryptWebhookSecret, sendWebhook, signWebhook, webhookUrl } from '../../integrations/webhooks/index.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';

const endpointSummary = { id: true, name: true, url: true, enabled: true, secretVersion: true, createdAt: true } as const;
const identity = (firmId: number, id: string, version: number) => `${firmId}:${id}:${version}`;
const payloadSchema = z.object({ deliveryId: z.string().uuid() }).strict();

async function access(tx: Prisma.TransactionClient, firmId: number, actorId: number) {
  await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.WEBHOOKS_MANAGE);
  await assertTransactionFeature(tx, firmId, 'integrations.webhooks');
}

export class WebhooksRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(firmId: number, actorId: number, input: { name: string; url: string }, metadata: RequestMetadata) {
    const destination = webhookUrl(input.url).toString();
    const id = randomUUID(); const secret = randomBytes(32).toString('hex');
    const encryptedSecret = encryptWebhookSecret(secret, identity(firmId, id, 1));
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await access(tx, firmId, actorId);
      if (await tx.webhookEndpoint.count({ where: { firmId } }) >= 20) throw new AppError('Webhook endpoint capacity reached', 409);
      const endpoint = await tx.webhookEndpoint.create({ data: { id, firmId, actorId, name: input.name, url: destination, encryptedSecret }, select: endpointSummary });
      await this.audit(tx, firmId, actorId, id, 'CREATED_DISABLED', metadata);
      return { endpoint, secret };
    });
  }
  async list(firmId: number, actorId: number) {
    return this.db.$transaction(async (tx) => {
      await access(tx, firmId, actorId);
      return { endpoints: await tx.webhookEndpoint.findMany({ where: { firmId, actorId }, select: endpointSummary, orderBy: { createdAt: 'desc' }, take: 20 }), configuration: { encryptionConfigured: Boolean(env.WEBHOOK_ENCRYPTION_KEY), destinationsConfigured: env.WEBHOOK_ALLOWED_HOSTS.length > 0, workerEnabled: env.OUTBOX_WORKER_ENABLED, eventTypes: ['report.exported.v1'] } };
    });
  }
  async change(firmId: number, actorId: number, id: string, metadata: RequestMetadata, enabled?: boolean) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await access(tx, firmId, actorId);
      const existing = await tx.webhookEndpoint.findFirst({ where: { id, firmId, actorId } });
      if (!existing) throw new AppError('Webhook endpoint not found', 404);
      if (enabled === true) {
        if (!env.OUTBOX_WORKER_ENABLED) throw new AppError('Webhook worker is disabled', 409);
        webhookUrl(existing.url);
        decryptWebhookSecret(existing.encryptedSecret, identity(firmId, id, existing.secretVersion));
      }
      const secret = enabled === undefined ? randomBytes(32).toString('hex') : undefined;
      const version = existing.secretVersion + (secret ? 1 : 0);
      const endpoint = await tx.webhookEndpoint.update({ where: { id }, data: secret ? { secretVersion: version, encryptedSecret: encryptWebhookSecret(secret, identity(firmId, id, version)) } : { enabled }, select: endpointSummary });
      await this.audit(tx, firmId, actorId, id, secret ? 'SECRET_ROTATED' : enabled ? 'ENABLED' : 'DISABLED', metadata);
      return { endpoint, ...(secret ? { secret } : {}) };
    });
  }
  async deliveries(firmId: number, actorId: number, id: string, page: number, limit: number, sort: ListSort = {}) {
    return this.db.$transaction(async (tx) => {
      await access(tx, firmId, actorId);
      if (!await tx.webhookEndpoint.findFirst({ where: { id, firmId, actorId }, select: { id: true } })) throw new AppError('Webhook endpoint not found', 404);
      const where = { firmId, endpointId: id };
      const [deliveries, total] = await Promise.all([
        tx.webhookDelivery.findMany({ where, select: { id: true, sourceEventId: true, secretVersion: true, createdAt: true, event: { select: { status: true, attempts: true, maxAttempts: true, availableAt: true, completedAt: true, jobAttempts: { select: { attempt: true, startedAt: true, finishedAt: true, outcome: true, errorCode: true }, orderBy: { attempt: 'desc' }, take: 20 } } } }, orderBy: listOrderBy(sort, ['id', 'createdAt', 'secretVersion'], 'createdAt'), skip: (page - 1) * limit, take: limit }),
        tx.webhookDelivery.count({ where }),
      ]);
      return { deliveries, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }
  private audit(tx: Prisma.TransactionClient, firmId: number, actorId: number, id: string, decision: string, metadata: RequestMetadata) {
    return createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'WebhookEndpoint', entityId: id, action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: { decision } });
  }
}

// Export metadata only: never deliver report values, query text, names, raw
// documents or API credentials. The body is immutable across delivery retries.
export async function enqueueReportExported(tx: Prisma.TransactionClient, firmId: number, actorId: number, sourceEventId: string, format: string, generatedAt: string) {
  if (!env.OUTBOX_WORKER_ENABLED || !env.WEBHOOK_ENCRYPTION_KEY || !env.WEBHOOK_ALLOWED_HOSTS.length) return;
  try { await assertTransactionFeature(tx, firmId, 'integrations.webhooks'); }
  catch (error) { if (error instanceof AppError && error.statusCode === 403) return; throw error; }
  const endpoints = await tx.webhookEndpoint.findMany({ where: { firmId, enabled: true }, take: 20 });
  for (const endpoint of endpoints) {
    const deliveryId = randomUUID();
    const event = await enqueueOutbox(tx, { firmId, actorId, kind: 'integrations.webhook.v1', sourceEventId, idempotencyKey: `webhook:${endpoint.id}:${sourceEventId}`, payload: { deliveryId }, maxAttempts: 5 });
    await tx.webhookDelivery.create({ data: { id: deliveryId, firmId, endpointId: endpoint.id, outboxEventId: event.id, sourceEventId, secretVersion: endpoint.secretVersion, encryptedSecret: endpoint.encryptedSecret, body: JSON.stringify({ schemaVersion: 1, eventId: sourceEventId, type: 'report.exported.v1', firmId, generatedAt, format }) } });
  }
}

async function delivery(tx: Prisma.TransactionClient, event: OutboxEvent) {
  const payload = payloadSchema.parse(event.payload);
  const row = await tx.webhookDelivery.findFirst({ where: { id: payload.deliveryId, firmId: event.firmId, outboxEventId: event.id, sourceEventId: event.sourceEventId }, include: { endpoint: true } });
  if (!row || !row.endpoint.enabled || row.endpoint.firmId !== event.firmId) throw new AppError('Webhook delivery is unavailable', 404);
  return row;
}
export const webhookHandler: JobHandler = {
  // At-least-once delivery. Receivers must durably deduplicate delivery ID.
  retry: 'IDEMPOTENT',
  async authorize(tx, event) {
    const row = await delivery(tx, event);
    await access(tx, event.firmId, row.endpoint.actorId);
    await authorizeFirmJobActor(tx, event.firmId, event.actorId, PERMISSIONS.REPORTS_EXPORT);
    await assertTransactionFeature(tx, event.firmId, 'reports.exports');
  },
  async execute(tx, event) {
    const row = await delivery(tx, event);
    const secret = decryptWebhookSecret(row.encryptedSecret, identity(event.firmId, row.endpointId, row.secretVersion));
    const timestamp = Math.floor(Date.now() / 1000);
    await sendWebhook(row.endpoint.url, row.body, { 'x-bhuminex-delivery': row.id, 'x-bhuminex-timestamp': String(timestamp), 'x-bhuminex-secret-version': String(row.secretVersion), 'x-bhuminex-signature': `v1=${signWebhook(secret, timestamp, row.id, row.body)}` });
  },
};
export const webhooksRepository = new WebhooksRepository(prisma);
