import { listOrderBy, type ListSort } from '../../core/validation/list-sort.js';
import { AuditAction, Prisma, type OutboxEvent, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { enqueueOutbox, type JobHandler } from '../../core/outbox/index.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { billingToday, createRecurringDraft, previewRecurringDraft, readRecurringTemplate } from '../invoices/index.js';
import { addCalendarDays, nextBillingPeriod } from './billing-periods.js';
import { scheduleConfigSchema, type ScheduleConfig, type ScheduleCreateInput, type ScheduleUpdateInput } from './billing-schedules.schema.js';

const include = { versions: { orderBy: { version: 'desc' as const }, take: 1 } } satisfies Prisma.BillingScheduleInclude;
type Schedule = Prisma.BillingScheduleGetPayload<{ include: typeof include }>;
const payloadSchema = z.object({ runId: z.number().int().positive(), retryCount: z.number().int().nonnegative(), version: z.number().int().positive() }).strict();
const jobKind = 'billing.recurring-draft.v1';
const date = (value: Date) => value.toISOString().slice(0, 10);
function json(value: unknown): Prisma.InputJsonObject { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject; }
function runKey(id: number, retryCount: number) { return `billing-run:${id}:${retryCount}`; }
function draftInput(config: ScheduleConfig, period: string, key: string) { return { ...config.template, invoiceDate: period, dueDate: addCalendarDays(period, config.dueDays), idempotencyKey: key }; }
function serialise(row: Schedule) { return { ...row, nextPeriod: date(row.nextPeriod), versions: row.versions.map((version) => ({ ...version, config: scheduleConfigSchema.parse(version.config) })) }; }
async function authorize(tx: Prisma.TransactionClient, firmId: number, actorId: number) {
  await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.BILLING_RECURRING);
  await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.INVOICES_CREATE);
  await assertTransactionFeature(tx, firmId, 'billing.recurring');
  await assertTransactionFeature(tx, firmId, 'billing.invoices');
}
async function audit(tx: Prisma.TransactionClient, firmId: number, actorId: number, id: number, decision: string, metadata: RequestMetadata = {}, details: Prisma.InputJsonObject = {}) {
  await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'BillingSchedule', entityId: String(id), action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: { decision, ...details } });
}

export class BillingSchedulesRepository {
  constructor(private readonly db: PrismaClient) {}
  private async find(tx: Prisma.TransactionClient, firmId: number, id: number) {
    const row = await tx.billingSchedule.findFirst({ where: { id, firmId }, include });
    if (!row) throw new AppError('Billing schedule not found', 404);
    return row;
  }
  async list(firmId: number, actorId: number, page: number, limit: number, sort: ListSort = {}) {
    return this.db.$transaction(async (tx) => {
      await authorize(tx, firmId, actorId);
      const rows = await tx.billingSchedule.findMany({ where: { firmId }, select: { id: true, name: true, status: true, version: true, nextPeriod: true }, orderBy: listOrderBy(sort, ['id', 'name', 'status', 'version', 'nextPeriod'], 'id'), skip: (page - 1) * limit, take: limit });
      const total = await tx.billingSchedule.count({ where: { firmId } });
      return { schedules: rows.map((row) => ({ ...row, nextPeriod: date(row.nextPeriod) })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async get(firmId: number, actorId: number, id: number) {
    return this.db.$transaction(async (tx) => {
      await authorize(tx, firmId, actorId);
      const row = await this.find(tx, firmId, id);
      const versions = await tx.billingScheduleVersion.findMany({ where: { scheduleId: id, firmId }, orderBy: { version: 'desc' }, take: 100 });
      const runs = await tx.billingScheduleRun.findMany({ where: { scheduleId: id, firmId }, orderBy: { period: 'desc' }, take: 100 });
      const events = await tx.outboxEvent.findMany({ where: { firmId, kind: jobKind, idempotencyKey: { in: runs.map((run) => runKey(run.id, run.retryCount)) } }, include: { jobAttempts: { orderBy: { attempt: 'asc' } } } });
      return { ...serialise({ ...row, versions }), runs: runs.map((run) => ({ ...run, period: date(run.period), event: events.find((event) => event.idempotencyKey === runKey(run.id, run.retryCount)) ?? null })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async create(firmId: number, actorId: number, input: ScheduleCreateInput, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorize(tx, firmId, actorId);
      const hash = requestHash(input);
      const previous = await tx.billingSchedule.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } }, include });
      if (previous) {
        if (previous.requestHash !== hash) throw new AppError('Schedule idempotency conflict', 409);
        return serialise(previous);
      }
      if (input.startDate < billingToday()) throw new AppError('New schedules must start today or later', 400);
      const template = await readRecurringTemplate(tx, firmId, actorId, input.sourceDraftId);
      const config: ScheduleConfig = { template, sourceDraftId: input.sourceDraftId, startDate: input.startDate, endDate: input.endDate, intervalMonths: input.intervalMonths, dueDays: input.dueDays };
      const preview = await previewRecurringDraft(tx, firmId, actorId, draftInput(config, input.startDate, 'schedule_preview'));
      const row = await tx.billingSchedule.create({ data: { firmId, companyId: template.companyId, name: input.name, nextPeriod: new Date(input.startDate), idempotencyKey: input.idempotencyKey, requestHash: hash, createdById: actorId } });
      await tx.billingScheduleVersion.create({ data: { firmId, scheduleId: row.id, version: 1, config: json(config), preview: json(preview), createdById: actorId } });
      await audit(tx, firmId, actorId, row.id, 'CREATED_PAUSED', metadata, { config: json(config), preview: json(preview) });
      return serialise(await this.find(tx, firmId, row.id));
    });
  }
  async update(firmId: number, actorId: number, id: number, input: ScheduleUpdateInput, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorize(tx, firmId, actorId);
      const row = await this.find(tx, firmId, id);
      if (row.version !== input.expectedVersion || row.status !== 'PAUSED') throw new AppError('Pause the current schedule version before revising its template', 409);
      const current = row.versions.find((version) => version.version === row.version)!;
      const old = scheduleConfigSchema.parse(current.config);
      if (input.endDate && input.endDate < date(row.nextPeriod)) throw new AppError('End date precedes the next billing period; cancel the schedule instead', 400);
      const template = await readRecurringTemplate(tx, firmId, actorId, input.sourceDraftId);
      if (template.companyId !== row.companyId) throw new AppError('A schedule cannot change customer', 409);
      const config = { ...old, template, sourceDraftId: input.sourceDraftId, endDate: input.endDate, dueDays: input.dueDays };
      const preview = await previewRecurringDraft(tx, firmId, actorId, draftInput(config, date(row.nextPeriod), 'schedule_preview'));
      await tx.billingScheduleVersion.create({ data: { firmId, scheduleId: id, version: row.version + 1, config: json(config), preview: json(preview), createdById: actorId } });
      await tx.billingSchedule.update({ where: { id }, data: { version: { increment: 1 } } });
      await audit(tx, firmId, actorId, id, 'VERSION_CREATED', metadata, { version: row.version + 1, config: json(config), preview: json(preview) });
      return serialise(await this.find(tx, firmId, id));
    });
  }
  private async previewRow(tx: Prisma.TransactionClient, firmId: number, actorId: number, row: Schedule) {
    const revision = row.versions.find((version) => version.version === row.version)!;
    const config = scheduleConfigSchema.parse(revision.config);
    const preview = await previewRecurringDraft(tx, firmId, actorId, draftInput(config, date(row.nextPeriod), 'schedule_preview'));
    return { config, preview, previewToken: requestHash({ config, preview, version: row.version, nextPeriod: date(row.nextPeriod) }) };
  }
  async preview(firmId: number, actorId: number, id: number) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => { await authorize(tx, firmId, actorId); return this.previewRow(tx, firmId, actorId, await this.find(tx, firmId, id)); });
  }
  async approve(firmId: number, actorId: number, id: number, version: number, token: string, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorize(tx, firmId, actorId);
      const row = await this.find(tx, firmId, id);
      if (row.version !== version || row.status !== 'PAUSED') throw new AppError('Only the current paused schedule can be approved', 409);
      const review = await this.previewRow(tx, firmId, actorId, row);
      if (review.previewToken !== token) throw new AppError('Schedule preview changed; review it again', 409);
      const revision = row.versions.find((entry) => entry.version === version)!;
      if (requestHash(review.preview) !== requestHash(revision.preview)) throw new AppError('Financial policy changed; create a schedule revision before approval', 409);
      if (review.config.endDate && review.config.endDate < date(row.nextPeriod)) throw new AppError('Schedule period has ended', 409);
      await tx.billingScheduleVersion.update({ where: { scheduleId_firmId_version: { scheduleId: id, firmId, version } }, data: { approvedAt: new Date(), approvedById: actorId } });
      await tx.billingSchedule.update({ where: { id }, data: { status: 'ACTIVE' } });
      await audit(tx, firmId, actorId, id, 'APPROVED', metadata, { version, previewToken: token, preview: json(review.preview) });
      return serialise(await this.find(tx, firmId, id));
    });
  }
  async stop(firmId: number, actorId: number, id: number, version: number, status: 'PAUSED' | 'CANCELLED', metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorize(tx, firmId, actorId);
      const row = await this.find(tx, firmId, id);
      if (row.version !== version || row.status === 'CANCELLED' || row.status === 'COMPLETED') throw new AppError('Schedule changed, ended or was cancelled', 409);
      await tx.billingSchedule.update({ where: { id }, data: { status } });
      await tx.billingScheduleRun.updateMany({ where: { scheduleId: id, firmId, invoiceId: null, status: 'QUEUED' }, data: { status: 'CANCELLED' } });
      await audit(tx, firmId, actorId, id, status, metadata, { version });
      return serialise(await this.find(tx, firmId, id));
    });
  }
  private async enqueue(tx: Prisma.TransactionClient, firmId: number, actorId: number, run: { id: number; retryCount: number; version: number }) {
    await enqueueOutbox(tx, { firmId, actorId, kind: jobKind, sourceEventId: `billing-run:${run.id}`, idempotencyKey: runKey(run.id, run.retryCount), payload: { runId: run.id, retryCount: run.retryCount, version: run.version } });
  }
  async dispatchDue() {
    const today = billingToday();
    const due = await this.db.billingSchedule.findMany({ where: { status: 'ACTIVE', firm: { deletedAt: null }, nextPeriod: { lte: new Date(today) } }, select: { id: true, firmId: true }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: 20 });
    for (const candidate of due) {
      try { await this.dispatchSchedule(candidate.firmId, candidate.id, today); }
      catch { console.error('Recurring schedule dispatch failed; durable period retained.', { scheduleId: candidate.id }); }
    }
  }
  private async dispatchSchedule(firmId: number, id: number, today: string) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const row = await this.find(tx, firmId, id);
      if (row.status !== 'ACTIVE' || date(row.nextPeriod) > today) return;
      const revision = row.versions.find((entry) => entry.version === row.version)!;
      if (!revision.approvedById) throw new AppError('Schedule lacks an approving actor', 409);
      try { await authorize(tx, row.firmId, revision.approvedById); }
      catch (error) {
        if (!(error instanceof AppError) || error.statusCode !== 403) throw error;
        await tx.billingSchedule.update({ where: { id: row.id }, data: { status: 'PAUSED' } });
        await audit(tx, row.firmId, revision.approvedById, row.id, 'PAUSED_ACCESS_UNAVAILABLE');
        return;
      }
      const config = scheduleConfigSchema.parse(revision.config);
      if (config.endDate && date(row.nextPeriod) > config.endDate) return;
      let run = await tx.billingScheduleRun.findUnique({ where: { scheduleId_period: { scheduleId: row.id, period: row.nextPeriod } } });
      if (run && run.status !== 'CANCELLED') {
        // Fairness: a failed or queued run must not monopolize discovery.
        await tx.billingSchedule.update({ where: { id: row.id }, data: { updatedAt: new Date() } });
        return;
      }
      if (run?.invoiceId) return;
      run = run ? await tx.billingScheduleRun.update({ where: { id: run.id }, data: { status: 'QUEUED', version: row.version, retryCount: { increment: 1 } } }) : await tx.billingScheduleRun.create({ data: { firmId: row.firmId, scheduleId: row.id, version: row.version, period: row.nextPeriod } });
      await this.enqueue(tx, row.firmId, revision.approvedById, run);
      await tx.billingSchedule.update({ where: { id: row.id }, data: { updatedAt: new Date() } });
      await audit(tx, row.firmId, revision.approvedById, row.id, 'PERIOD_QUEUED', {}, { runId: run.id, period: date(run.period), version: row.version });
    });
  }
  async retry(firmId: number, actorId: number, id: number, runId: number, expectedRetryCount: number, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorize(tx, firmId, actorId);
      const row = await this.find(tx, firmId, id);
      const run = await tx.billingScheduleRun.findFirst({ where: { id: runId, scheduleId: id, firmId } });
      if (!run) throw new AppError('Billing run not found', 404);
      if (row.status !== 'ACTIVE' || run.version !== row.version || run.status !== 'QUEUED' || run.invoiceId || run.retryCount !== expectedRetryCount) throw new AppError('Only the current failed active period can be retried', 409);
      const event = await tx.outboxEvent.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: runKey(run.id, run.retryCount) } } });
      if (!event || event.status !== 'DEAD') throw new AppError('Run is still queued or processing', 409);
      const revision = row.versions.find((entry) => entry.version === run.version)!;
      const retried = await tx.billingScheduleRun.update({ where: { id: run.id }, data: { retryCount: { increment: 1 } } });
      await this.enqueue(tx, firmId, revision.approvedById!, retried);
      await audit(tx, firmId, actorId, id, 'PERIOD_RETRIED', metadata, { runId, retryCount: retried.retryCount });
      return { runId, retryCount: retried.retryCount };
    });
  }
}

async function jobContext(tx: Prisma.TransactionClient, event: OutboxEvent) {
  const parsed = payloadSchema.safeParse(event.payload);
  if (!parsed.success) throw new AppError('Invalid recurring job payload', 400);
  const payload = parsed.data;
  const run = await tx.billingScheduleRun.findFirst({ where: { id: payload.runId, firmId: event.firmId }, include: { schedule: true, revision: true } });
  if (!run || run.retryCount !== payload.retryCount || run.version !== payload.version || run.revision.approvedById !== event.actorId || run.schedule.status !== 'ACTIVE' || run.schedule.version !== run.version || run.status === 'CANCELLED') throw new AppError('Recurring job is no longer authorized', 400);
  await authorize(tx, event.firmId, event.actorId);
  return run;
}
export const recurringDraftHandler: JobHandler = {
  retry: 'TRANSACTIONAL',
  async authorize(tx, event) { await jobContext(tx, event); },
  async execute(tx, event) {
    const run = await jobContext(tx, event);
    if (run.invoiceId) return;
    const config = scheduleConfigSchema.parse(run.revision.config);
    if (date(run.period) !== date(run.schedule.nextPeriod) || date(run.period) > billingToday() || (config.endDate && date(run.period) > config.endDate)) throw new AppError('Billing period is not eligible', 400);
    const input = draftInput(config, date(run.period), `recurring_run_${run.id}`);
    const preview = await previewRecurringDraft(tx, event.firmId, event.actorId, input);
    if (requestHash(preview) !== requestHash(run.revision.preview)) throw new AppError('Approved financial preview changed; pause, revise and approve the schedule', 409);
    const invoice = await createRecurringDraft(tx, event.firmId, event.actorId, input);
    await tx.billingScheduleRun.update({ where: { id: run.id }, data: { status: 'DRAFT_CREATED', invoiceId: invoice.id, completedAt: new Date() } });
    const next = nextBillingPeriod(config.startDate, date(run.period), config.intervalMonths);
    await tx.billingSchedule.update({ where: { id: run.scheduleId }, data: { nextPeriod: new Date(next), ...(config.endDate && next > config.endDate ? { status: 'COMPLETED' } : {}) } });
    await audit(tx, event.firmId, event.actorId, run.scheduleId, 'DRAFT_CREATED', {}, { runId: run.id, invoiceId: invoice.id, period: date(run.period), version: run.version });
  },
};
export const billingSchedulesRepository = new BillingSchedulesRepository(prisma);
