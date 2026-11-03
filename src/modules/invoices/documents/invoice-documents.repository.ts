import { createHash, randomUUID } from 'node:crypto';
import { AuditAction, type PrismaClient } from '@prisma/client';
import { AppError } from '../../../core/errors/AppError.js';
import { prisma } from '../../../core/database/prisma.js';
import { createAuditLog, type RequestMetadata } from '../../../core/audit/audit-log.service.js';
import { renderAndStorePdf } from '../../../integrations/documents/index.js';
import { storageService } from '../../../integrations/storage/index.js';
import { assertTransactionFeature, prepareStorageUsage, recordUsage, withFirmEntitlementTransaction } from '../../entitlements/index.js';
import { billingAccess, InvoicesRepository, type DocumentScope } from '../invoices.repository.js';
import { renderInvoiceHtml } from './invoice-document.template.js';

export class InvoiceDocumentsRepository {
  constructor(private readonly db: PrismaClient, private readonly invoices = new InvoicesRepository(db)) {}
  async generate(firmId: number, actorId: number, id: number, scope: DocumentScope, metadata: RequestMetadata) {
    const original = await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.invoices.authorize(tx, firmId, actorId, scope, 'documents');
      const row = await this.invoices.find(tx, firmId, id, scope);
      if (row.status !== 'ISSUED' || row.issueSnapshot === null) throw new AppError('Issue the document before generating its historical PDF', 409);
      return row;
    });
    const filePath = `billing-documents/${firmId}/${randomUUID()}.pdf`;
    const rendered = await renderAndStorePdf(renderInvoiceHtml(original.issueSnapshot), filePath);
    try {
      return await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
        await this.invoices.authorize(tx, firmId, actorId, scope, 'documents');
        const current = await this.invoices.find(tx, firmId, id, scope);
        if (current.status !== 'ISSUED' || current.version !== original.version) throw new AppError('Document changed while its PDF was rendering; retry', 409);
        await prepareStorageUsage(tx, firmId);
        await recordUsage(tx, firmId, 'documents', 1n, `billing-pdf:${filePath}`, billingAccess[scope].feature);
        await recordUsage(tx, firmId, 'storageBytes', BigInt(rendered.fileSize), `billing-pdf:${filePath}`);
        const latest = await tx.invoiceDocument.findFirst({ where: { firmId, invoiceId: id }, orderBy: { versionNumber: 'desc' } });
        const document = await tx.invoiceDocument.create({ data: { firmId, invoiceId: id, versionNumber: (latest?.versionNumber ?? 0) + 1, filePath, fileHash: rendered.fileHash, fileSize: rendered.fileSize, generatedById: actorId } });
        await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'BillingDocument', entityId: String(id), action: AuditAction.GENERATE_PDF, policy: 'REQUIRED', newValues: { documentId: document.id, versionNumber: document.versionNumber, fileHash: document.fileHash } });
        return { id: document.id, versionNumber: document.versionNumber, fileHash: document.fileHash, fileSize: document.fileSize, generatedAt: document.generatedAt.toISOString() };
      });
    } catch (error) {
      await storageService.deleteStorageFile(filePath).catch(() => {});
      throw error;
    }
  }
  async list(firmId: number, id: number, scope: DocumentScope) {
    await assertTransactionFeature(this.db, firmId, billingAccess[scope].feature);
    await this.invoices.find(this.db, firmId, id, scope);
    return this.db.invoiceDocument.findMany({ where: { firmId, invoiceId: id }, orderBy: { versionNumber: 'desc' }, select: { id: true, versionNumber: true, fileHash: true, fileSize: true, generatedAt: true } });
  }
  async download(firmId: number, id: number, documentId: number, scope: DocumentScope) {
    await assertTransactionFeature(this.db, firmId, billingAccess[scope].feature);
    const record = await this.invoices.find(this.db, firmId, id, scope);
    const document = await this.db.invoiceDocument.findFirst({ where: { id: documentId, firmId, invoiceId: id } });
    if (!document || !document.filePath.startsWith(`billing-documents/${firmId}/`) || !await storageService.fileExists(document.filePath)) throw new AppError('Billing PDF not found', 404);
    const buffer = await storageService.readStorageFile(document.filePath);
    if (createHash('sha256').update(buffer).digest('hex') !== document.fileHash) throw new AppError('Stored PDF integrity check failed', 409);
    return { buffer, filename: `${record.kind}-${record.documentNumber?.replace(/[^A-Z0-9-]/g, '-')}.pdf` };
  }
}
export const invoiceDocumentsRepository = new InvoiceDocumentsRepository(prisma);
