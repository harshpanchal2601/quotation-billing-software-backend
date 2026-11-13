import { createHash, randomUUID } from 'node:crypto';
import { AuditAction, Prisma, type PrismaClient, type SavedReportView } from '@prisma/client';
import type { z } from 'zod';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { jsonObject } from '../../core/serialization/json.js';
import { dateWindow } from '../../core/validation/date-window.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { readPipelineReport } from '../crm/index.js';
import { enqueueReportExported } from '../connections/events.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { readStockValuation } from '../inventory/index.js';
import { readSalesReport } from '../invoices/index.js';
import { readReceivablesSummary } from '../payments/index.js';
import { readPurchasingReport } from '../purchasing/index.js';
import { readQuotationReport } from '../quotations/index.js';
import { reportCsv } from './reports.csv.js';
import { reportPdf, reportXlsx } from './reports.formats.js';
import { reportQuerySchema, type ReportQuery, type ReportSectionKey, type savedViewCreateSchema, type savedViewUpdateSchema, type savedViewsQuerySchema } from './reports.schema.js';
import type { ReportMetric, ReportOverview, ReportSection, ReportSectionData } from './reports.types.js';

const metric = (key: string, label: string, value: string | number, currency: string | null, unit: ReportMetric['unit'], dimension: string | null = null): ReportMetric => ({ key, label, value: String(value), currency, unit, dimension });
function savedView(row: SavedReportView) {
  if (row.filterVersion !== 1) throw new AppError('Saved report version is not supported', 409);
  return { id: row.id, name: row.name, version: row.version, filters: reportQuerySchema.parse(row.filters), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export class ReportsRepository {
  constructor(private readonly db: PrismaClient) {}

  private async access(tx: Prisma.TransactionClient, firmId: number, actorId: number, exporting = false) {
    await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.REPORTS_VIEW);
    await assertTransactionFeature(tx, firmId, 'reports');
    if (exporting) {
      await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.REPORTS_EXPORT);
      await assertTransactionFeature(tx, firmId, 'reports.exports');
    }
  }

  private async section(tx: Prisma.TransactionClient, firmId: number, actorId: number, key: ReportSectionKey, query: ReportQuery, generatedAt: Date): Promise<ReportSection> {
    const window = dateWindow(query.dateFrom, query.dateTo);
    const context = { timezone: 'UTC', scope: 'FIRM' as const, asOf: generatedAt.toISOString(), dateBasis: 'PERIOD' as const };
    let data: ReportSectionData;
    try {
      switch (key) {
        case 'quotations': {
          const rows = await readQuotationReport(tx, firmId, actorId, window, query.currency);
          data = { ...context, source: 'quotations', basis: 'Latest live quotation revisions dated in the period; conversion is currently accepted or completed / all quotations.', metrics: rows.flatMap((row) => [
            metric('quotationCount', 'Quotations', row.count, row.currency, 'COUNT'),
            metric('quotationValue', 'Quotation value', row.value, row.currency, 'MONEY'),
            metric('acceptedCount', 'Accepted or completed', row.acceptedCount, row.currency, 'COUNT'),
            metric('acceptedValue', 'Accepted or completed value', row.acceptedValue, row.currency, 'MONEY'),
            metric('conversionRate', 'Quote acceptance rate', row.conversionRate, row.currency, 'PERCENT'),
          ]) };
          break;
        }
        case 'sales': {
          const report = await readSalesReport(tx, firmId, actorId, query);
          data = { ...context, source: 'invoices', basis: 'Currently issued invoices plus debit notes minus credit notes, by document date. Document sales include tax; this is not recognized accounting revenue.', metrics: report.currencies.flatMap((row) => [
            metric('netSales', 'Net document sales', row.netSales, row.currency, 'MONEY'), metric('documents', 'Issued documents', row.documents, row.currency, 'COUNT'),
          ]) };
          break;
        }
        case 'receivables': {
          const report = await readReceivablesSummary(tx, firmId, actorId, query.currency, generatedAt);
          data = { ...context, dateBasis: 'CURRENT', asOf: report.asOf, timezone: report.timezone, source: 'invoices/payment_allocations/customer_payments', basis: 'Current outstanding adjusted invoices and unreversed allocations. Ageing uses the billing calendar; the selected activity period does not filter balances.', metrics: [
            ...report.buckets.flatMap((row) => [metric('outstanding', 'Outstanding', row.amount, row.currency, 'MONEY', row.bucket), metric('invoices', 'Open invoices', row.count, row.currency, 'COUNT', row.bucket)]),
            ...report.customerCredits.map((row) => metric('customerCredit', 'Unapplied customer credit', row.unapplied, row.currency, 'MONEY')),
          ] };
          break;
        }
        case 'pipeline': {
          const report = await readPipelineReport(tx, firmId, actorId, window, query.currency);
          data = { ...context, scope: report.scope, source: 'opportunities', basis: 'Opportunities created in the period, grouped by their current stage. Values are unweighted; visibility follows CRM ownership.', metrics: report.currencies.flatMap((row) => [
            metric('opportunityCount', 'Opportunities', row.count, row.currency, 'COUNT', row.stage), metric('opportunityValue', 'Opportunity value', row.value, row.currency, 'MONEY', row.stage),
          ]) };
          break;
        }
        case 'stock': {
          const until = new Date(Math.min(window.until.getTime(), generatedAt.getTime()));
          const rows = await readStockValuation(tx, firmId, actorId, until, query.currency);
          data = { ...context, dateBasis: 'CLOSING', asOf: until.toISOString(), source: 'stock_movements', basis: 'Signed stock movement valuation before the end boundary, capped at report generation. Six decimal places are retained. Unlike item quantities are never added.', metrics: rows.flatMap((row) => [
            metric('stockValue', 'Closing stock value', row.value, row.currency, 'VALUATION'), metric('positions', 'Positions with movements', row.positions, row.currency, 'COUNT'),
          ]) };
          break;
        }
        case 'purchaseOrders':
        case 'supplierBills':
        case 'expenses': {
          const rows = await readPurchasingReport(tx, firmId, actorId, key, window, query.currency);
          const descriptions = {
            purchaseOrders: { source: 'purchase_orders', basis: 'Currently approved, partially received or received orders created in the period. Original order commitments include tax; these are not supplier payables.' },
            supplierBills: { source: 'supplier_bills', basis: 'Currently posted supplier bills by bill date, including tax. Purchase commitments and bills are separate measures.' },
            expenses: { source: 'expenses', basis: 'Currently posted expense documents by expense date, including tax. Expenses are not added to supplier bills.' },
          };
          data = { ...context, ...descriptions[key], metrics: rows.flatMap((row) => [metric('amount', key === 'purchaseOrders' ? 'Order commitments' : 'Posted amount', row.amount, row.currency, 'MONEY'), metric('documents', 'Documents', row.count, row.currency, 'COUNT')]) };
          break;
        }
      }
      return { key, status: 'AVAILABLE', data };
    } catch (error) {
      // Authorization failure is an unavailable widget, never an invented zero.
      if (error instanceof AppError && error.statusCode === 403) return { key, status: 'UNAVAILABLE' };
      throw error;
    }
  }

  async overviewInTransaction(tx: Prisma.TransactionClient, firmId: number, actorId: number, query: ReportQuery): Promise<ReportOverview> {
    await this.access(tx, firmId, actorId);
    const generatedAt = new Date();
    const sections: ReportSection[] = [];
    // One repeatable-read transaction keeps all domain queries on the same DB snapshot.
    for (const key of query.sections) sections.push(await this.section(tx, firmId, actorId, key, query, generatedAt));
    if (sections.reduce((count, section) => count + (section.status === 'AVAILABLE' ? section.data.metrics.length : 0), 0) > 10_000) throw new AppError('Report exceeds 10000 metrics; narrow its sections or currency', 413);
    const localization: Pick<ReportOverview, 'localizationSnapshot'> = query.locale || query.language || query.timezone ? { localizationSnapshot: { locale: query.locale ?? 'en-IN', language: query.language ?? 'en', timezone: query.timezone ?? 'UTC' } } : {};
    return { schemaVersion: 1, firmId, generatedAt: generatedAt.toISOString(), dateFrom: query.dateFrom, dateTo: query.dateTo, currency: query.currency ?? null, currencyPolicy: 'SEGMENTED_NO_CONVERSION', sections, ...localization };
  }

  async overview(firmId: number, actorId: number, query: ReportQuery) {
    return this.db.$transaction((tx) => this.overviewInTransaction(tx, firmId, actorId, query), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
  }

  async assertExportAccess(tx: Prisma.TransactionClient, firmId: number, actorId: number, query?: ReportQuery, report?: ReportOverview) {
    await this.access(tx, firmId, actorId, true);
    if (!report) return;
    if (!query) throw new Error('Export filters are required to validate a snapshot');
    if (report.firmId !== firmId) throw new AppError('Report ownership is invalid', 409);
    for (const section of report.sections) {
      if (section.status !== 'AVAILABLE') continue;
      const current = await this.section(tx, firmId, actorId, section.key, query, new Date(report.generatedAt));
      if (current.status !== 'AVAILABLE' || current.data.scope !== section.data.scope) throw new AppError('Report access changed; rerun the export', 403);
    }
  }

  async exportCsv(firmId: number, actorId: number, query: ReportQuery, metadata: RequestMetadata) {
    return this.exportReport(firmId, actorId, query, metadata, 'csv') as Promise<string>;
  }

  async exportReport(firmId: number, actorId: number, query: ReportQuery, metadata: RequestMetadata, format: 'csv' | 'xlsx' | 'pdf') {
    const exportId = randomUUID();
    const report = await this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId, true);
      const report = await this.overviewInTransaction(tx, firmId, actorId, query);
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'ReportExport', entityId: exportId, action: AuditAction.CREATE, policy: 'REQUIRED', newValues: jsonObject({ format: format.toUpperCase(), schemaVersion: report.schemaVersion, filters: query, generatedAt: report.generatedAt, sections: report.sections.map((section) => ({ key: section.key, status: section.status })) }) });
      return report;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
    // Browser work must not hold a database transaction open.
    const output = format === 'csv' ? reportCsv(report) : format === 'xlsx' ? reportXlsx(report) : await reportPdf(report);
    if (Buffer.byteLength(output) > 10_000_000) throw new AppError('Report export exceeds 10 MB; narrow its sections or currency', 413);
    // Revalidate after expensive rendering, before returning any bytes.
    await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.assertExportAccess(tx, firmId, actorId, query, report);
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'ReportExport', entityId: exportId, action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: { decision: 'GENERATED', format, sha256: createHash('sha256').update(output).digest('hex'), bytes: Buffer.byteLength(output) } });
      await enqueueReportExported(tx, firmId, actorId, exportId, format, report.generatedAt);
    });
    return output;
  }

  async listViews(firmId: number, actorId: number, query: z.infer<typeof savedViewsQuerySchema>) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId);
      const where = { firmId, actorId };
      const [rows, total] = await Promise.all([
        tx.savedReportView.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: query.limit, skip: (query.page - 1) * query.limit }),
        tx.savedReportView.count({ where }),
      ]);
      return { views: rows.map(savedView), pagination: { ...query, total, totalPages: Math.ceil(total / query.limit) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async saveView(firmId: number, actorId: number, input: z.infer<typeof savedViewCreateSchema> | z.infer<typeof savedViewUpdateSchema>, metadata: RequestMetadata, id?: string) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId);
      const existing = id ? await tx.savedReportView.findFirst({ where: { id, firmId, actorId } }) : null;
      if (id && !existing) throw new AppError('Saved report not found', 404);
      if (existing && (!('expectedVersion' in input) || existing.version !== input.expectedVersion)) throw new AppError('Saved report changed; reload and retry', 409);
      const data = { name: input.name, filters: jsonObject(input.filters) };
      const row = existing
        ? await tx.savedReportView.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.savedReportView.create({ data: { id: randomUUID(), firmId, actorId, ...data } });
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'SavedReportView', entityId: row.id, action: existing ? AuditAction.UPDATE : AuditAction.CREATE, policy: 'REQUIRED', newValues: jsonObject({ name: row.name, version: row.version, filters: row.filters }) });
      return savedView(row);
    });
  }

  async deleteView(firmId: number, actorId: number, id: string, expectedVersion: number, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId);
      const row = await tx.savedReportView.findFirst({ where: { id, firmId, actorId } });
      if (!row) throw new AppError('Saved report not found', 404);
      if (row.version !== expectedVersion) throw new AppError('Saved report changed; reload and retry', 409);
      await tx.savedReportView.delete({ where: { id: row.id } });
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'SavedReportView', entityId: id, action: AuditAction.DELETE, policy: 'REQUIRED', oldValues: jsonObject({ name: row.name, version: row.version }) });
    });
  }
}

export const reportsRepository = new ReportsRepository(prisma);
