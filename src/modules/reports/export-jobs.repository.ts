import { listOrderBy, type ListSort } from '../../core/validation/list-sort.js';
import { createHash, randomUUID } from 'node:crypto';
import { AuditAction, Prisma, type OutboxEvent, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { enqueueOutbox, type JobHandler } from '../../core/outbox/index.js';
import { jsonObject } from '../../core/serialization/json.js';
import { storageService } from '../../integrations/storage/index.js';
import { enqueueReportExported } from '../connections/events.js';
import { prepareStorageUsage, recordUsage, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { exportFormatSchema, type exportJobCreateSchema } from './export-jobs.schema.js';
import { reportSnapshotSchema } from './reports.contract.js';
import { reportCsv } from './reports.csv.js';
import { reportPdf, reportXlsx } from './reports.formats.js';
import { ReportsRepository } from './reports.repository.js';
import { reportQuerySchema } from './reports.schema.js';

const eventPayload = z.object({ jobId: z.string().uuid() }).strict();
const preparedSchema = z.object({ path: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().min(0).max(10_000_000), report: reportSnapshotSchema }).strict();
const summary = { id: true, format: true, filters: true, fileHash: true, fileSize: true, createdAt: true, completedAt: true, event: { select: { status: true, attempts: true, maxAttempts: true } } } as const;
function artifactPath(firmId: number, jobId: string, format: z.infer<typeof exportFormatSchema>, path: string | null): string {
  const prefix = `report-exports/${firmId}/${jobId}/`;
  if (!path?.startsWith(prefix) || !new RegExp(`^[a-f0-9-]{36}\\.${format}$`).test(path.slice(prefix.length))) throw new AppError('Export artifact path is invalid', 409);
  return path;
}

export class ExportJobsRepository {
  readonly reports: ReportsRepository;
  constructor(private readonly db: PrismaClient) { this.reports = new ReportsRepository(db); }
  private async owned(tx: Prisma.TransactionClient, firmId: number, actorId: number, id: string, includeDeleted = false) {
    const job = await tx.reportExportJob.findFirst({ where: { id, firmId, actorId, ...(includeDeleted ? {} : { deletedAt: null }) } });
    if (!job) throw new AppError('Export job not found', 404);
    await this.reports.assertExportAccess(tx, firmId, actorId, reportQuerySchema.parse(job.filters));
    return job;
  }
  async create(firmId: number, actorId: number, input: z.infer<typeof exportJobCreateSchema>, metadata: RequestMetadata) {
    if (!env.OUTBOX_WORKER_ENABLED) throw new AppError('Queued export worker is disabled', 409);
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.reports.assertExportAccess(tx, firmId, actorId, input.filters);
      const hash = requestHash(input);
      const previous = await tx.reportExportJob.findUnique({ where: { firmId_actorId_requestKey: { firmId, actorId, requestKey: input.requestKey } }, select: { ...summary, requestHash: true, deletedAt: true } });
      if (previous) {
        if (previous.requestHash !== hash || previous.deletedAt) throw new AppError('Export command key was already used; start a new export', 409);
        const { requestHash: _hash, deletedAt: _deleted, ...result } = previous;
        void _hash; void _deleted;
        return result;
      }
      if (await tx.reportExportJob.count({ where: { firmId, actorId, completedAt: null, deletedAt: null } }) >= 100) throw new AppError('Pending export capacity reached; remove unused jobs', 409);
      const id = randomUUID();
      const event = await enqueueOutbox(tx, { firmId, actorId, kind: 'reports.export.v1', sourceEventId: id, idempotencyKey: `report-export:${id}`, payload: { jobId: id } });
      const job = await tx.reportExportJob.create({ data: { id, firmId, actorId, eventId: event.id, requestKey: input.requestKey, requestHash: hash, format: input.format, filters: jsonObject(input.filters) }, select: summary });
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'ReportExportJob', entityId: id, action: AuditAction.CREATE, policy: 'REQUIRED', newValues: { decision: 'QUEUED', format: input.format } });
      return job;
    });
  }
  async list(firmId: number, actorId: number, page: number, limit: number, sort: ListSort = {}) {
    return this.db.$transaction(async (tx) => {
      await this.reports.assertExportAccess(tx, firmId, actorId);
      const where = { firmId, actorId, deletedAt: null };
      const [jobs, total] = await Promise.all([tx.reportExportJob.findMany({ where, select: summary, orderBy: listOrderBy(sort, ['id', 'createdAt', 'format', 'fileSize', 'completedAt'], 'createdAt'), skip: (page - 1) * limit, take: limit }), tx.reportExportJob.count({ where })]);
      return { jobs, workerEnabled: env.OUTBOX_WORKER_ENABLED, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }
  private async eventJob(tx: Prisma.TransactionClient, event: OutboxEvent) {
    const { jobId } = eventPayload.parse(event.payload);
    const job = await this.owned(tx, event.firmId, event.actorId, jobId);
    if (job.eventId !== event.id || job.id !== event.sourceEventId) throw new AppError('Export event ownership is invalid', 404);
    return job;
  }
  handler(): JobHandler {
    return {
      retry: 'TRANSACTIONAL',
      authorize: async (tx, event) => { await this.eventJob(tx, event); },
      prepare: async (event) => {
        const { job, report } = await this.db.$transaction(async (tx) => {
          const job = await this.eventJob(tx, event);
          const report = await this.reports.overviewInTransaction(tx, event.firmId, event.actorId, reportQuerySchema.parse(job.filters));
          return { job, report: reportSnapshotSchema.parse(report) };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
        const format = exportFormatSchema.parse(job.format);
        const content = format === 'csv' ? Buffer.from(reportCsv(report), 'utf8') : format === 'xlsx' ? reportXlsx(report) : await reportPdf(report);
        if (content.length > 10_000_000) throw new AppError('Report artifact exceeds 10 MB', 400);
        const path = `report-exports/${event.firmId}/${job.id}/${randomUUID()}.${format}`;
        try { await storageService.writeStorageFile(path, content); }
        catch (error) { await storageService.deleteStorageFile(path).catch(() => {}); throw error; }
        return { value: { path, hash: createHash('sha256').update(content).digest('hex'), size: content.length, report }, cleanup: async (committed) => {
          if (committed) return;
          // An uncertain commit must not delete a successfully referenced file.
          const current = await this.db.reportExportJob.findUnique({ where: { id: job.id }, select: { filePath: true } });
          if (current?.filePath !== path) await storageService.deleteStorageFile(path);
        } };
      },
      execute: async (tx, event, value) => {
        const job = await this.eventJob(tx, event);
        const prepared = preparedSchema.parse(value);
        const format = exportFormatSchema.parse(job.format);
        artifactPath(event.firmId, job.id, format, prepared.path);
        if (prepared.report.firmId !== event.firmId) throw new AppError('Invalid prepared report ownership', 400);
        await this.reports.assertExportAccess(tx, event.firmId, event.actorId, reportQuerySchema.parse(job.filters), prepared.report);
        await prepareStorageUsage(tx, event.firmId);
        await recordUsage(tx, event.firmId, 'storageBytes', BigInt(prepared.size), `report-export:${job.id}`);
        await tx.reportExportJob.update({ where: { id: job.id }, data: { filePath: prepared.path, fileHash: prepared.hash, fileSize: prepared.size, reportSnapshot: jsonObject(prepared.report), completedAt: new Date() } });
        await createAuditLog(tx, { metadata: { firmId: event.firmId, userId: event.actorId }, entityType: 'ReportExportJob', entityId: job.id, action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: { decision: 'GENERATED', format, sha256: prepared.hash, bytes: prepared.size } });
        await enqueueReportExported(tx, event.firmId, event.actorId, job.id, format, prepared.report.generatedAt);
      },
    };
  }
  async download(firmId: number, actorId: number, id: string, metadata: RequestMetadata) {
    const job = await this.db.$transaction(async (tx) => {
      const job = await this.owned(tx, firmId, actorId, id);
      if (!job.filePath || !job.fileHash || !job.completedAt || !job.reportSnapshot) throw new AppError('Export artifact is not ready', 409);
      await this.reports.assertExportAccess(tx, firmId, actorId, reportQuerySchema.parse(job.filters), reportSnapshotSchema.parse(job.reportSnapshot));
      return job;
    }, { timeout: 30_000 });
    const format = exportFormatSchema.parse(job.format);
    const buffer = await storageService.readStorageFile(artifactPath(firmId, id, format, job.filePath));
    if (buffer.length !== job.fileSize || createHash('sha256').update(buffer).digest('hex') !== job.fileHash) throw new AppError('Export artifact integrity check failed', 409);
    await this.db.$transaction(async (tx) => {
      const current = await this.owned(tx, firmId, actorId, id);
      await this.reports.assertExportAccess(tx, firmId, actorId, reportQuerySchema.parse(current.filters), reportSnapshotSchema.parse(current.reportSnapshot));
      if (current.fileHash !== job.fileHash) throw new AppError('Export artifact changed', 409);
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'ReportExportJob', entityId: id, action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: { decision: 'DOWNLOADED', sha256: job.fileHash } });
    }, { timeout: 30_000 });
    return { buffer, format };
  }
  async remove(firmId: number, actorId: number, id: string, metadata: RequestMetadata) {
    const path = await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const job = await this.owned(tx, firmId, actorId, id, true);
      if (job.filePath) artifactPath(firmId, id, exportFormatSchema.parse(job.format), job.filePath);
      // A failed filesystem removal can be retried after the tombstone commits.
      // Reauthorize the same owner, but never release quota or audit deletion twice.
      if (job.deletedAt) return job.filePath;
      if (job.fileSize !== null) await recordUsage(tx, firmId, 'storageBytes', -BigInt(job.fileSize), `report-export-delete:${id}`);
      await tx.reportExportJob.update({ where: { id }, data: { deletedAt: new Date() } });
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'ReportExportJob', entityId: id, action: AuditAction.DELETE, policy: 'REQUIRED', newValues: { decision: 'REMOVED' } });
      return job.filePath;
    });
    if (path) await storageService.deleteStorageFile(path);
  }
}
export const exportJobsRepository = new ExportJobsRepository(prisma);
export const reportExportHandler = exportJobsRepository.handler();
