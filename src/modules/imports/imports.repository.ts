import { createHash } from 'node:crypto';
import { AuditAction, Prisma, type ImportBatch, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { jsonObject } from '../../core/serialization/json.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { companyImportSchema, compensateImportedCompany, createCompanyForImport } from '../companies/index.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { compensateImportedItem, createItemForImport, itemImportSchema } from '../items/index.js';
import { importRecords, normalizeImport } from './imports.normalization.js';
import { importTargetSchema, type ImportTarget } from './imports.schema.js';

export class ImportsRepository {
  constructor(private readonly db: PrismaClient) {}

  private async access(tx: Prisma.TransactionClient, firmId: number, actorId: number, target?: ImportTarget) {
    await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.IMPORTS_MANAGE);
    await assertTransactionFeature(tx, firmId, 'imports');
    if (target) {
      await authorizeFirmJobActor(tx, firmId, actorId, target === 'ITEMS' ? PERMISSIONS.ITEMS_MANAGE : PERMISSIONS.COMPANIES_MANAGE);
      await assertTransactionFeature(tx, firmId, target === 'ITEMS' ? 'items' : 'companies');
    }
  }

  private async owned(tx: Prisma.TransactionClient, firmId: number, actorId: number, id: number) {
    const batch = await tx.importBatch.findFirst({ where: { id, firmId, startedById: actorId, target: { in: ['CUSTOMERS', 'ITEMS'] }, contentHash: { not: null } } });
    if (!batch) throw new AppError('Import not found', 404);
    await this.access(tx, firmId, actorId, importTargetSchema.parse(batch.target));
    return batch;
  }

  private async references(tx: Prisma.TransactionClient, firmId: number, target: ImportTarget, data: Record<string, unknown>) {
    if (target !== 'ITEMS') return;
    const unit = await tx.measurementUnit.findFirst({ where: { id: Number(data.measurementUnitId), firmId, deletedAt: null, isActive: true }, select: { id: true } });
    const category = await tx.itemCategory.findFirst({ where: { firmId, deletedAt: null, isActive: true, ...(data.categoryId === undefined ? { slug: 'uncategorised' } : { id: Number(data.categoryId) }) }, select: { id: true } });
    if (!unit || !category) throw new AppError('Item references are unavailable in this firm', 409);
  }

  private duplicate(tx: Prisma.TransactionClient, firmId: number, target: ImportTarget, identifier: string) {
    return tx.importRow.findFirst({ where: { sourceIdentifier: identifier, status: 'IMPORTED', importBatch: { firmId, target } }, select: { id: true } });
  }

  async preview(firmId: number, actorId: number, target: ImportTarget, csv: string, metadata: RequestMetadata) {
    const records = importRecords(target, csv);
    const contentHash = createHash('sha256').update(JSON.stringify(records)).digest('hex');
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, target);
      const previous = await tx.importBatch.findFirst({ where: { firmId, startedById: actorId, target, contentHash } });
      if (previous) return { id: previous.id };
      const batch = await tx.importBatch.create({ data: { firmId, startedById: actorId, target, contentHash, sourceType: 'CSV_IMPORT', totalRecords: records.length } });
      const keys = new Set<string>();
      let rejected = 0;
      for (const raw of records) {
        let errorMessage: string | null = null;
        let processedData: Prisma.InputJsonObject | undefined;
        let identifier: string | null = null;
        try {
          const normalized = normalizeImport(target, raw);
          identifier = normalized.identifier;
          // MySQL uses a case-insensitive collation for durable deduplication.
          const key = identifier.toLowerCase();
          if (keys.has(key) || await this.duplicate(tx, firmId, target, identifier)) throw new AppError('Duplicate external identifier', 409);
          keys.add(key);
          await this.references(tx, firmId, target, normalized.data);
          processedData = jsonObject(normalized.data);
        } catch (error) {
          if (!(error instanceof z.ZodError) && !(error instanceof AppError) && !(error instanceof Error && /Default rate|GST rate|HSN code/.test(error.message))) throw error;
          errorMessage = error instanceof AppError ? error.message : 'Invalid row; check the template fields and value formats';
          rejected++;
        }
        await tx.importRow.create({ data: { importBatchId: batch.id, sourceIdentifier: identifier, rawData: jsonObject(raw), processedData, status: errorMessage ? 'REJECTED' : 'APPROVED', errorMessage } });
      }
      await tx.importBatch.update({ where: { id: batch.id }, data: { failedRecords: rejected } });
      await this.audit(tx, batch, actorId, 'PREVIEWED', metadata);
      return { id: batch.id };
    });
  }

  async list(firmId: number, actorId: number, page: number, limit: number) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId);
      const where = { firmId, startedById: actorId, target: { in: ['CUSTOMERS', 'ITEMS'] }, contentHash: { not: null } };
      const [batches, total] = await Promise.all([tx.importBatch.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * limit, take: limit }), tx.importBatch.count({ where })]);
      return { batches, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }

  async detail(firmId: number, actorId: number, id: number) {
    return this.db.$transaction(async (tx) => {
      const batch = await this.owned(tx, firmId, actorId, id);
      const rows = await tx.importRow.findMany({ where: { importBatchId: batch.id }, orderBy: { id: 'asc' }, take: 500 });
      return { batch, rows };
    });
  }

  async commit(firmId: number, actorId: number, id: number, expectedVersion: number, metadata: RequestMetadata) {
    const target = await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const batch = await this.owned(tx, firmId, actorId, id);
      if (batch.version !== expectedVersion) throw new AppError('Import changed; reload and retry', 409);
      await tx.importBatch.update({ where: { id }, data: { status: 'PROCESSING', version: { increment: 1 } } });
      await this.audit(tx, batch, actorId, 'COMMIT_STARTED', metadata);
      return importTargetSchema.parse(batch.target);
    });
    const pending = await this.db.importRow.findMany({ where: { importBatchId: id, status: 'APPROVED', importBatch: { firmId, startedById: actorId } }, select: { id: true }, take: 500, orderBy: { id: 'asc' } });
    for (const candidate of pending) {
      try {
        await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
          const batch = await this.owned(tx, firmId, actorId, id);
          const row = await tx.importRow.findFirst({ where: { id: candidate.id, importBatchId: id } });
          if (!row || row.status !== 'APPROVED') return;
          if (!row.sourceIdentifier || await this.duplicate(tx, firmId, target, row.sourceIdentifier)) throw new AppError('Duplicate external identifier', 409);
          const normalized = normalizeImport(target, z.record(z.string()).parse(row.rawData));
          await this.references(tx, firmId, target, normalized.data);
          const sourceMetadata = { ...metadata, firmId, userId: actorId };
          const created = target === 'ITEMS'
            ? await createItemForImport(tx, firmId, itemImportSchema.parse(normalized.data), sourceMetadata, row.sourceIdentifier)
            : await createCompanyForImport(tx, firmId, companyImportSchema.parse(normalized.data), sourceMetadata);
          await tx.importRow.update({ where: { id: row.id }, data: { status: 'IMPORTED', targetId: created.id, importedAt: new Date(), targetUpdatedAt: created.updatedAt, targetFingerprint: created.fingerprint, errorMessage: null } });
          await tx.importBatch.update({ where: { id }, data: { successfulRecords: { increment: 1 } } });
          await this.audit(tx, batch, actorId, 'ROW_IMPORTED', metadata, row.id, created.id);
        });
      } catch (error) {
        // Infrastructure/audit failures abort for safe retry. Never turn a lost
        // authorization or unknown commit outcome into a successful import.
        if (!(error instanceof AppError) || ![400, 404, 409].includes(error.statusCode)) throw error;
        await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
          const batch = await this.owned(tx, firmId, actorId, id);
          const failed = await tx.importRow.updateMany({ where: { id: candidate.id, importBatchId: id, status: 'APPROVED' }, data: { status: 'FAILED', errorMessage: 'Row could not be imported; check duplicates and active item references' } });
          if (failed.count === 1) {
            await tx.importBatch.update({ where: { id }, data: { failedRecords: { increment: 1 } } });
            await this.audit(tx, batch, actorId, 'ROW_FAILED', metadata, candidate.id);
          }
        });
      }
    }
    await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const batch = await this.owned(tx, firmId, actorId, id);
      const successfulRecords = await tx.importRow.count({ where: { importBatchId: id, status: 'IMPORTED' } });
      const failedRecords = await tx.importRow.count({ where: { importBatchId: id, status: { in: ['REJECTED', 'FAILED'] } } });
      await tx.importBatch.update({ where: { id }, data: { successfulRecords, failedRecords, completedAt: new Date(), status: successfulRecords === batch.totalRecords ? 'COMPLETED' : successfulRecords > 0 ? 'PARTIAL' : 'FAILED' } });
      await this.audit(tx, batch, actorId, 'COMMIT_FINISHED', metadata);
    });
    return this.detail(firmId, actorId, id);
  }

  async compensate(firmId: number, actorId: number, id: number, rowId: number, expectedVersion: number, metadata: RequestMetadata) {
    await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const batch = await this.owned(tx, firmId, actorId, id);
      if (batch.version !== expectedVersion) throw new AppError('Import changed; reload and retry', 409);
      const row = await tx.importRow.findFirst({ where: { id: rowId, importBatchId: id, status: 'IMPORTED' } });
      if (!row?.targetId || !row.targetUpdatedAt || !row.targetFingerprint) throw new AppError('Imported row not found', 404);
      if (row.compensatedAt) return;
      const sourceMetadata = { ...metadata, firmId, userId: actorId };
      if (batch.target === 'ITEMS') await compensateImportedItem(tx, firmId, row.targetId, row.targetUpdatedAt, row.targetFingerprint, sourceMetadata);
      else await compensateImportedCompany(tx, firmId, row.targetId, row.targetUpdatedAt, row.targetFingerprint, sourceMetadata);
      await tx.importRow.update({ where: { id: row.id }, data: { compensatedAt: new Date() } });
      await tx.importBatch.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit(tx, batch, actorId, 'ROW_COMPENSATED', metadata, row.id, row.targetId);
    });
    return this.detail(firmId, actorId, id);
  }

  private audit(tx: Prisma.TransactionClient, batch: ImportBatch, actorId: number, decision: string, metadata: RequestMetadata, rowId?: number, targetId?: number) {
    return createAuditLog(tx, { metadata: { ...metadata, firmId: batch.firmId, userId: actorId }, entityType: 'ImportBatch', entityId: String(batch.id), action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: jsonObject({ decision, target: batch.target, rowId, targetId }) });
  }
}
export const importsRepository = new ImportsRepository(prisma);
