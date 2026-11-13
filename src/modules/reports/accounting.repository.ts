import { createHash, randomUUID } from 'node:crypto';
import { AuditAction, Prisma, type PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { jsonObject } from '../../core/serialization/json.js';
import { csvDocument } from '../../core/serialization/csv.js';
import { dateWindow } from '../../core/validation/date-window.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { readBillingJournalSources } from '../invoices/index.js';
import { billingJournal } from './accounting.journal.js';
import { accountingMappingSchema, type accountingExportSchema, type accountingMappingCommandSchema } from './accounting.schema.js';

export class AccountingRepository {
  constructor(private readonly db: PrismaClient) {}
  private async access(tx: Prisma.TransactionClient, firmId: number, actorId: number, managing = false) {
    await authorizeFirmJobActor(tx, firmId, actorId, managing ? PERMISSIONS.ACCOUNTING_MANAGE : PERMISSIONS.ACCOUNTING_EXPORT);
    await assertTransactionFeature(tx, firmId, 'accounting.exports');
  }
  async mapping(firmId: number, actorId: number) {
    return this.db.$transaction(async (tx) => { await this.access(tx, firmId, actorId); return { mapping: await tx.accountingMappingVersion.findFirst({ where: { firmId }, orderBy: { version: 'desc' } }) }; });
  }
  async saveMapping(firmId: number, actorId: number, input: z.infer<typeof accountingMappingCommandSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, true);
      const previous = await tx.accountingMappingVersion.findFirst({ where: { firmId }, orderBy: { version: 'desc' } });
      if ((previous?.version ?? 0) !== input.expectedVersion) throw new AppError('Accounting mapping changed; reload and retry', 409);
      const mapping = await tx.accountingMappingVersion.create({ data: { firmId, actorId, version: input.expectedVersion + 1, mapping: jsonObject(input.mapping) } });
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'AccountingMapping', entityId: `${firmId}:${mapping.version}`, action: AuditAction.CREATE, policy: 'REQUIRED', newValues: { version: mapping.version, mappingHash: createHash('sha256').update(JSON.stringify(input.mapping)).digest('hex') } });
      return { mapping };
    });
  }
  async export(firmId: number, actorId: number, query: z.infer<typeof accountingExportSchema>, metadata: RequestMetadata) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId);
      const config = await tx.accountingMappingVersion.findUnique({ where: { firmId_version: { firmId, version: query.mappingVersion } } });
      if (!config) throw new AppError('Accounting mapping version not found', 404);
      const window = dateWindow(query.dateFrom, query.dateTo);
      const journal = billingJournal(await readBillingJournalSources(tx, firmId, actorId, window), accountingMappingSchema.parse(config.mapping), window);
      const exportId = randomUUID(); const generatedAt = new Date().toISOString();
      const header = ['schema_version', 'export_id', 'firm_id', 'generated_at', 'date_from', 'date_to', 'date_basis', 'mapping_version', 'source_event', 'source_id', 'document_number', 'event', 'event_at', 'currency', 'account', 'debit', 'credit'];
      const rows = journal.map((row) => ['1', exportId, String(firmId), generatedAt, query.dateFrom, query.dateTo, 'UTC_ISSUE_VOID_EVENTS', String(config.version), row.sourceEvent, String(row.sourceId), row.documentNumber, row.event, row.eventAt, row.currency, row.account, row.debit, row.credit]);
      const csv = csvDocument([header, ...rows]);
      const sha256 = createHash('sha256').update(csv).digest('hex');
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'AccountingExport', entityId: exportId, action: AuditAction.CREATE, policy: 'REQUIRED', newValues: { schemaVersion: 1, mappingVersion: config.version, dateFrom: query.dateFrom, dateTo: query.dateTo, rows: journal.length, sha256 } });
      return { csv, sha256 };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
  }
}
export const accountingRepository = new AccountingRepository(prisma);
