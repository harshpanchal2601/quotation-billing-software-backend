import { listOrderBy, type ListSort } from '../../core/validation/list-sort.js';
import { randomUUID } from 'node:crypto';
import type { OutboxEvent, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { enqueueOutbox, type JobHandler } from '../../core/outbox/index.js';
import { DeferredOutboxJob } from '../../core/outbox/deferred-job.js';
import { renderTextTemplate } from '../../core/templates/placeholders.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { deliverInAppNotification } from '../notifications/index.js';
import { auditAutomation, automationAccess, automationAvailable, eventAccess, latestDefinition, ownedAutomationEntity, publishedHeads, type AutomationTx } from './automation.persistence.js';
import { automationEventSchema, documentTemplateSchema, preferenceSchema, workflowSchema, type AutomationEvent } from './automation.schema.js';
import { evaluateWorkflow, nextDeliveryTime } from './workflow-evaluator.js';

export async function emitAutomationEvent(tx: AutomationTx, firmId: number, actorId: number, sourceEventId: string, input: Omit<AutomationEvent, 'businessName'>) {
  const heads = [...await publishedHeads(tx, firmId, 'WORKFLOW'), ...await publishedHeads(tx, firmId, 'NOTIFICATION')];
  if (!heads.length || !await automationAvailable(tx, firmId)) return;
  if (!await tx.user.findFirst({ where: { id: actorId, firmId, status: 'ACTIVE', deletedAt: null } })) return;
  const profile = await tx.businessProfile.findUnique({ where: { firmId }, select: { displayName: true } });
  const noticeHead = await latestDefinition(tx, firmId, 'TEMPLATE', 'NOTICE');
  const notice = noticeHead ? documentTemplateSchema.parse(noticeHead.definition) : null;
  const event = automationEventSchema.parse({ ...input, businessName: profile?.displayName ?? '', ...(notice?.enabled ? { notice: { versionId: noticeHead!.id, heading: notice.heading, footer: notice.footer } } : {}) });
  for (const head of heads) {
    const definition = workflowSchema.parse(head.definition);
    if (!definition.enabled || definition.trigger !== event.trigger) continue;
    const identity = { firmId, definitionId: head.id, sourceEventId };
    if (await tx.workflowRun.findUnique({ where: { firmId_definitionId_sourceEventId: identity } })) continue;
    const id = randomUUID();
    const job = await enqueueOutbox(tx, { firmId, actorId, kind: 'automation.workflow.v1', sourceEventId,
      idempotencyKey: `workflow:${head.id}:${sourceEventId}`, correlationId: id, payload: { runId: id }, availableAt: new Date(Date.now() + definition.delayMinutes * 60000) });
    await tx.workflowRun.create({ data: { ...identity, id, actorId, event, outboxId: job.id, expiresAt: new Date(Date.now() + definition.expiresAfterMinutes * 60000) } });
    await auditAutomation(tx, firmId, actorId, 'WorkflowRun', id, { status: 'PENDING', definitionId: head.id, ruleVersion: head.version, sourceEventId });
  }
}
const runPayload = z.object({ runId: z.string().uuid() }).strict();
const deliveryPayload = z.object({ runId: z.string().uuid(), step: z.string().max(32), recipientId: z.number().int().positive() }).strict();
async function loadRun(tx: AutomationTx, event: OutboxEvent, delivery = false) {
  const payload = delivery ? deliveryPayload.parse(event.payload) : runPayload.parse(event.payload);
  const run = await tx.workflowRun.findFirst({ where: { id: payload.runId, firmId: event.firmId }, include: { definition: true } });
  if (!run || run.actorId !== event.actorId || event.correlationId !== run.id || !delivery && run.outboxId !== event.id) throw new AppError('Workflow run not found', 404);
  return run;
}
async function authorizeRun(tx: AutomationTx, event: OutboxEvent, delivery = false) {
  const run = await loadRun(tx, event, delivery);
  if (run.status === 'CANCELLED' || run.expiresAt <= new Date()) return;
  await assertTransactionFeature(tx, event.firmId, 'automation');
  const resource = automationEventSchema.parse(run.event);
  await eventAccess(tx, event.firmId, event.actorId, resource.trigger);
  await ownedAutomationEntity(tx, event.firmId, resource.entity, resource.entityId);
  await automationAccess(tx, event.firmId, run.definition.publishedById, true);
}
export const workflowHandler: JobHandler = {
  retry: 'TRANSACTIONAL', authorize: (tx, event) => authorizeRun(tx, event),
  async execute(tx, event) {
    const run = await loadRun(tx, event);
    if (run.status === 'CANCELLED' || run.status === 'SUCCEEDED') return;
    if (run.expiresAt <= new Date()) {
      await tx.workflowRun.update({ where: { id: run.id }, data: { status: 'EXPIRED', reason: 'EXECUTION_EXPIRED', completedAt: new Date() } }); return;
    }
    const resource = automationEventSchema.parse(run.event);
    for (const step of evaluateWorkflow(workflowSchema.parse(run.definition.definition), resource)) {
      if (step.type === 'NOTIFY') for (const recipientId of step.recipientIds) {
        await enqueueOutbox(tx, { firmId: run.firmId, actorId: run.actorId, kind: 'automation.notification.v1', sourceEventId: run.sourceEventId,
          idempotencyKey: `workflow-notice:${run.id}:${step.id}:${recipientId}`, correlationId: run.id, payload: { runId: run.id, step: step.id, recipientId } });
      }
      await tx.workflowActionResult.upsert({ where: { runId_step: { runId: run.id, step: step.id } }, create: { firmId: run.firmId, runId: run.id, step: step.id, outcome: step.type === 'NOTIFY' ? 'DELIVERY_QUEUED' : 'SUCCEEDED' }, update: {} });
    }
    await tx.workflowRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', completedAt: new Date(), reason: 'RULE_COMPLETED' } });
    await auditAutomation(tx, run.firmId, run.actorId, 'WorkflowRun', run.id, { status: 'SUCCEEDED', ruleVersion: run.definition.version });
  },
};
export const workflowNotificationHandler: JobHandler = {
  retry: 'TRANSACTIONAL', authorize: (tx, event) => authorizeRun(tx, event, true),
  async execute(tx, event) {
    const payload = deliveryPayload.parse(event.payload);
    const run = await loadRun(tx, event, true);
    if (run.status === 'CANCELLED' || run.expiresAt <= new Date()) {
      await auditAutomation(tx, run.firmId, run.actorId, 'WorkflowRun', run.id, { step: payload.step, recipientId: payload.recipientId, reason: run.status === 'CANCELLED' ? 'RUN_CANCELLED' : 'DELIVERY_EXPIRED' }); return;
    }
    const resource = automationEventSchema.parse(run.event);
    const step = evaluateWorkflow(workflowSchema.parse(run.definition.definition), resource).find((candidate) => candidate.id === payload.step);
    if (!step || step.type !== 'NOTIFY' || !step.recipientIds.includes(payload.recipientId)) throw new AppError('Notification step not found', 404);
    await eventAccess(tx, run.firmId, payload.recipientId, resource.trigger);
    await automationAccess(tx, run.firmId, payload.recipientId);
    const preference = await tx.automationRecipientPreference.findUnique({ where: { firmId_userId: { firmId: run.firmId, userId: payload.recipientId } } });
    if (!preference?.enabled) { await auditAutomation(tx, run.firmId, run.actorId, 'WorkflowRun', run.id, { step: step.id, recipientId: payload.recipientId, reason: 'RECIPIENT_NOT_OPTED_IN' }); return; }
    const { enabled, utcOffsetMinutes, quietStartMinute, quietEndMinute } = preference;
    const deliveryAt = nextDeliveryTime(new Date(), preferenceSchema.parse({ enabled, utcOffsetMinutes, quietStartMinute, quietEndMinute }));
    if (deliveryAt.getTime() > Date.now()) throw new DeferredOutboxJob(deliveryAt);
    const variables = { businessName: resource.businessName, documentNumber: resource.documentNumber, entityType: resource.entity, status: resource.status, currency: resource.currency, total: resource.total };
    const title = renderTextTemplate(step.title, variables).slice(0, 191);
    const body = [resource.notice ? renderTextTemplate(resource.notice.heading, variables) : '', renderTextTemplate(step.body, variables), resource.notice ? renderTextTemplate(resource.notice.footer, variables) : ''].filter(Boolean).join('\n').slice(0, 5000);
    const delivered = await deliverInAppNotification(tx, event, { recipientId: payload.recipientId, title, body });
    await auditAutomation(tx, run.firmId, run.actorId, 'WorkflowRun', run.id, { step: step.id, recipientId: payload.recipientId, reason: delivered ? 'DELIVERED' : 'FIRM_CHANNEL_DISABLED' });
  },
};

export class WorkflowsRepository {
  constructor(readonly db: PrismaClient) {}
  async runs(firmId: number, actorId: number, page = 1, sorting: ListSort = {}) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await automationAccess(tx, firmId, actorId, true);
      const rows = await tx.workflowRun.findMany({ where: { firmId }, include: { definition: true, actions: true }, orderBy: listOrderBy(sorting, ['id', 'createdAt', 'expiresAt', 'status', 'actorId'], 'createdAt'), take: 50, skip: (page - 1) * 50 });
      const ids = rows.map((run) => run.id);
      const [jobs, logs] = await Promise.all([
        tx.outboxEvent.findMany({ where: { firmId, correlationId: { in: ids } }, include: { jobAttempts: { orderBy: { attempt: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
        tx.auditLog.findMany({ where: { firmId, entityType: 'WorkflowRun', entityId: { in: ids } }, select: { id: true, entityId: true, userId: true, newValues: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      ]);
      return rows.map((run) => ({ ...run, jobs: jobs.filter((job) => job.correlationId === run.id), logs: logs.filter((entry) => entry.entityId === run.id) }));
    });
  }
  async control(firmId: number, actorId: number, id: string, command: 'CANCEL' | 'RETRY') {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await automationAccess(tx, firmId, actorId, true);
      const run = await tx.workflowRun.findFirst({ where: { id, firmId } });
      if (!run) throw new AppError('Workflow run not found', 404);
      if (command === 'CANCEL') {
        await tx.workflowRun.update({ where: { id }, data: { status: 'CANCELLED', reason: 'CANCELLED_BY_ADMIN', completedAt: new Date() } });
      } else {
        if (run.status === 'CANCELLED' || run.expiresAt <= new Date()) throw new AppError('Cancelled or expired runs cannot be retried', 409);
        const jobs = await tx.outboxEvent.findMany({ where: { firmId, status: 'DEAD', correlationId: id } });
        if (!jobs.length) throw new AppError('No dead workflow actions to retry', 409);
        for (const job of jobs) {
          await authorizeRun(tx, job, job.kind === 'automation.notification.v1');
          await tx.outboxEvent.update({ where: { id: job.id }, data: { status: 'PENDING', maxAttempts: job.attempts + 5, availableAt: new Date(), lockedUntil: null, lockToken: null } });
        }
      }
      await auditAutomation(tx, firmId, actorId, 'WorkflowRun', id, { command });
      return { id, command };
    });
  }
}
export const workflowsRepository = new WorkflowsRepository(prisma);
