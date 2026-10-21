import path from 'node:path';
import {
  AuditAction,
  CommunicationStatus,
  CommunicationType,
  Prisma,
  QuotationStatus,
  type PrismaClient,
} from '@prisma/client';

import { mailConfig } from '../../../config/mail.config.js';
import { storageConfig } from '../../../config/storage.config.js';
import { AppError } from '../../../core/errors/AppError.js';
import { createAuditLog, type RequestMetadata } from '../../../core/audit/audit-log.service.js';
import { prisma } from '../../../core/database/prisma.js';
import { mailService } from '../../../integrations/mail/index.js';
import { storageService } from '../../../integrations/storage/index.js';
import { getBusinessProfileRecordForQuotation } from '../../settings/index.js';
import { validateStatusTransition, getStatusTimestampUpdate } from '../quotation-status.js';
import { buildQuotationEmailContent } from '../email/quotation-email.template.js';
import { sendQuotationEmailSchema } from '../email/quotation-email.schema.js';
import type {
  GeneratedDocumentHistoryItemDto,
  GeneratedDocumentHistoryResponse,
  QuotationCommunicationHistoryItemDto,
  QuotationCommunicationHistoryResponse,
  SendQuotationEmailInput,
  SendQuotationEmailResponse,
} from '../documents/quotation-documents.types.js';
import { quotationDocumentsRepository } from '../documents/quotation-documents.repository.js';
import { resolveAttachmentAbsolutePath } from '../attachments/quotation-attachment.policy.js';

const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;

function sanitiseFilename(filename: string): string {
  return filename.replace(/["\r\n/\\]/g, '_');
}

function normaliseRecipientBuckets(input: SendQuotationEmailInput) {
  const seen = new Set<string>();
  const uniqueForBucket = (values: string[] | undefined) => {
    const result: string[] = [];
    for (const value of values ?? []) {
      const normalised = value.trim().toLowerCase();
      if (!normalised || seen.has(normalised)) continue;
      seen.add(normalised);
      result.push(normalised);
    }
    return result;
  };
  return {
    to: uniqueForBucket(input.to),
    cc: uniqueForBucket(input.cc),
    bcc: uniqueForBucket(input.bcc),
  };
}

function safeFailureSummary(error: unknown): { category: string; summary: string } {
  if (error instanceof AppError) {
    return { category: `HTTP_${error.statusCode}`, summary: error.message };
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : 'SMTP_ERROR';
  return {
    category: code.slice(0, 100),
    summary: 'Email server did not accept the message. Please check SMTP settings or recipient addresses.',
  };
}

function getProviderMessageId(info: unknown): string | null {
  if (typeof info === 'object' && info !== null && 'messageId' in info) {
    const messageId = (info as { messageId?: unknown }).messageId;
    if (typeof messageId === 'string' && messageId.trim()) {
      return messageId.slice(0, 191);
    }
  }
  return null;
}

function serialiseCommunication(
  communication: Prisma.QuotationCommunicationGetPayload<{
    include: {
      sender: { select: { id: true; name: true; email: true } };
      generatedDocument: { select: { id: true; versionNumber: true; generatedAt: true } };
    };
  }>,
): QuotationCommunicationHistoryItemDto {
  return {
    id: communication.id,
    quotationId: communication.quotationId,
    generatedDocumentId: communication.generatedDocumentId,
    quotationRevisionNumber:
      typeof communication.documentSnapshot === 'object' &&
      communication.documentSnapshot !== null &&
      'quotationRevisionNumber' in communication.documentSnapshot
        ? Number((communication.documentSnapshot as { quotationRevisionNumber?: unknown }).quotationRevisionNumber)
        : null,
    communicationType: communication.communicationType,
    status: communication.status,
    attemptNumber: communication.attemptNumber,
    to: Array.isArray(communication.toRecipients) ? communication.toRecipients.map(String) : [],
    cc: Array.isArray(communication.ccRecipients) ? communication.ccRecipients.map(String) : [],
    bcc: Array.isArray(communication.bccRecipients) ? communication.bccRecipients.map(String) : [],
    subject: communication.subjectSnapshot,
    message: communication.messageSnapshot,
    document: communication.documentSnapshot,
    attachments: communication.attachmentSnapshots,
    providerMessageId: communication.providerMessageId,
    failureCategory: communication.failureCategory,
    failureSummary: communication.failureSummary,
    createdAt: communication.createdAt.toISOString(),
    acceptedAt: communication.acceptedAt?.toISOString() ?? null,
    failedAt: communication.failedAt?.toISOString() ?? null,
    sender: communication.sender
      ? { id: communication.sender.id, name: communication.sender.name, email: communication.sender.email }
      : null,
  };
}

export class QuotationCommunicationsRepository {
  constructor(private readonly db: PrismaClient) {}

  async assertQuotationExists(quotationId: number) {
    const quotation = await this.db.quotation.findFirst({
      where: { id: quotationId, deletedAt: null },
      select: { id: true, quotationNumber: true },
    });
    if (!quotation) {
      throw new AppError('Quotation not found', 404);
    }
    return quotation;
  }

  async getDocumentHistory(
    quotationId: number,
    query: { page?: number; limit?: number; sortOrder?: 'asc' | 'desc' },
  ): Promise<GeneratedDocumentHistoryResponse> {
    const quotation = await this.assertQuotationExists(quotationId);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const { total, documents } = await quotationDocumentsRepository.listDocumentHistory(quotationId, {
      page,
      limit,
      sortOrder,
    });

    const pdfStorageDir = storageService.resolveStoragePath(storageConfig.quotationDocumentDirectory);

    const items: GeneratedDocumentHistoryItemDto[] = await Promise.all(
      documents.map(async (doc) => {
        const fullPath = path.resolve(storageConfig.root, doc.filePath.replace(/^\/?storage\//, ''));
        let isAvailable = false;
        if (fullPath.startsWith(pdfStorageDir)) {
          isAvailable = await quotationDocumentsRepository.documentFileExists(doc.filePath);
        }
        const safeNumber = quotation.quotationNumber.replace(/[/\\\\]/g, '-');
        return {
          id: doc.id,
          quotationId: doc.quotationId,
          versionNumber: doc.versionNumber,
          documentType: doc.documentType,
          quotationNumber: quotation.quotationNumber,
          displayFilename: `Quotation-${safeNumber}-v${doc.versionNumber}.pdf`,
          generatedAt: doc.generatedAt.toISOString(),
          generatedBy: doc.generatedBy ? { id: doc.generatedBy.id, name: doc.generatedBy.name } : undefined,
          isAvailable,
          canPreview: isAvailable,
          canEmail: isAvailable,
        };
      }),
    );

    return {
      documents: items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async getCommunicationHistory(
    quotationId: number,
    query: { page?: number; limit?: number; sortOrder?: 'asc' | 'desc' },
  ): Promise<QuotationCommunicationHistoryResponse> {
    await this.assertQuotationExists(quotationId);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const skip = (page - 1) * limit;

    const [total, communications] = await Promise.all([
      this.db.quotationCommunication.count({ where: { quotationId } }),
      this.db.quotationCommunication.findMany({
        where: { quotationId },
        orderBy: { createdAt: sortOrder },
        skip,
        take: limit,
        include: {
          sender: { select: { id: true, name: true, email: true } },
          generatedDocument: { select: { id: true, versionNumber: true, generatedAt: true } },
        },
      }),
    ]);

    return {
      communications: communications.map(serialiseCommunication),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  async sendQuotationEmail(
    quotationId: number,
    input: SendQuotationEmailInput,
    userId: number,
    metadata: RequestMetadata,
  ): Promise<SendQuotationEmailResponse> {
    const quotation = await this.db.quotation.findFirst({
      where: { id: quotationId, deletedAt: null },
      select: {
        id: true,
        quotationNumber: true,
        revisionNumber: true,
        status: true,
        isLatestRevision: true,
      },
    });

    if (!quotation) {
      throw new AppError('Quotation not found', 404);
    }

    if (
      !quotation.isLatestRevision &&
      (quotation.status === QuotationStatus.DRAFT || quotation.status === QuotationStatus.PENDING)
    ) {
      throw new AppError('Only the latest draft or pending quotation revision can be emailed.', 409);
    }

    const recipients = normaliseRecipientBuckets(input);
    if (recipients.to.length === 0) {
      throw new AppError('At least one primary recipient (To) email address is required', 400);
    }

    const document = await this.db.generatedDocument.findFirst({
      where: { id: input.generatedDocumentId, quotationId, documentType: 'QUOTATION_PDF' },
      include: { generatedBy: { select: { id: true, name: true } } },
    });

    if (!document) {
      throw new AppError('Selected quotation PDF document not found', 404);
    }

    const pdfFullPath = quotationDocumentsRepository.resolveDocumentAbsolutePath(document.filePath);
    const pdfStorageDir = storageService.resolveStoragePath(storageConfig.quotationDocumentDirectory);
    if (!pdfFullPath.startsWith(pdfStorageDir)) {
      throw new AppError('Invalid document path', 403);
    }

    let pdfStat: import('node:fs').Stats;
    try {
      const fs = await import('node:fs/promises');
      pdfStat = await fs.stat(pdfFullPath);
    } catch {
      throw new AppError('Selected quotation PDF file is missing from storage', 404);
    }

    let totalSizeBytes = pdfStat.size;
    const safePdfName = `Quotation-${quotation.quotationNumber.replace(/[/\\\\]/g, '-')}.pdf`;
    const documentSnapshot = {
      id: document.id,
      versionNumber: document.versionNumber,
      documentType: document.documentType,
      displayFilename: safePdfName,
      generatedAt: document.generatedAt.toISOString(),
      quotationRevisionNumber: quotation.revisionNumber,
      generatedBy: document.generatedBy ? { id: document.generatedBy.id, name: document.generatedBy.name } : null,
    };

    const attachmentIds = input.attachmentIds || [];
    const selectedAttachments: Array<{
      id: number;
      fullPath: string;
      originalFilename: string;
      mimeType: string;
      size: number;
    }> = [];
    const selectedAttachmentSnapshots: Array<{
      id: number;
      originalFilename: string;
      mimeType: string;
      fileSize: number;
    }> = [];

    if (attachmentIds.length > 0) {
      const fetchedAttachments = await this.db.quotationAttachment.findMany({
        where: { id: { in: attachmentIds }, quotationId, deletedAt: null },
      });

      if (fetchedAttachments.length !== attachmentIds.length) {
        throw new AppError('One or more selected attachments do not belong to this quotation or are unavailable', 404);
      }

      for (const att of fetchedAttachments) {
        const attFullPath = resolveAttachmentAbsolutePath(att.filePath);
        try {
          const fs = await import('node:fs/promises');
          const attStat = await fs.stat(attFullPath);
          totalSizeBytes += attStat.size;
          selectedAttachments.push({
            id: att.id,
            fullPath: attFullPath,
            originalFilename: att.originalFilename,
            mimeType: att.mimeType,
            size: attStat.size,
          });
          selectedAttachmentSnapshots.push({
            id: att.id,
            originalFilename: att.originalFilename,
            mimeType: att.mimeType,
            fileSize: attStat.size,
          });
        } catch {
          throw new AppError(`Attachment file "${att.originalFilename}" is missing from storage`, 404);
        }
      }
    }

    if (totalSizeBytes > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
      throw new AppError('Total email attachment size exceeds 20 MB limit', 413);
    }

    const businessProfile = await getBusinessProfileRecordForQuotation();
    const businessName = businessProfile?.displayName || 'Buminex Pharmtech Solutions';
    const fromEmail = mailConfig.fromEmail || businessProfile?.primaryEmail || 'noreply@example.com';
    const fromName = mailConfig.fromName || businessName;

    const { text, html } = buildQuotationEmailContent({
      quotationNumber: quotation.quotationNumber,
      businessName,
      messageText: input.message,
    });

    const emailAttachments = [
      { filename: safePdfName, path: pdfFullPath, contentType: 'application/pdf' },
      ...selectedAttachments.map((att) => ({
        filename: sanitiseFilename(att.originalFilename),
        path: att.fullPath,
        contentType: att.mimeType,
      })),
    ];

    const attemptNumber = (await this.db.quotationCommunication.count({ where: { quotationId } })) + 1;
    const attempt = await this.db.quotationCommunication.create({
      data: {
        quotationId,
        generatedDocumentId: document.id,
        senderUserId: userId,
        communicationType: CommunicationType.QUOTATION_EMAIL,
        status: CommunicationStatus.PENDING,
        attemptNumber,
        toRecipients: recipients.to as Prisma.InputJsonValue,
        ccRecipients: recipients.cc as Prisma.InputJsonValue,
        bccRecipients: recipients.bcc as Prisma.InputJsonValue,
        subjectSnapshot: input.subject,
        messageSnapshot: input.message,
        documentSnapshot: documentSnapshot as Prisma.InputJsonValue,
        attachmentSnapshots: selectedAttachmentSnapshots as Prisma.InputJsonValue,
      },
    });

    let sendInfo: unknown;
    try {
      sendInfo = await mailService.send({
        from: `"${fromName}" <${fromEmail}>`,
        to: recipients.to.join(', '),
        cc: recipients.cc.length > 0 ? recipients.cc.join(', ') : undefined,
        bcc: recipients.bcc.length > 0 ? recipients.bcc.join(', ') : undefined,
        subject: input.subject,
        text,
        html,
        attachments: emailAttachments,
      });
    } catch (err: unknown) {
      if (err instanceof AppError && err.statusCode === 503) {
        throw err;
      }
      console.error('SMTP Send Error:', err instanceof Error ? err.message : 'Unknown SMTP error');
      const failure = safeFailureSummary(err);
      await this.db.quotationCommunication.update({
        where: { id: attempt.id },
        data: {
          status: CommunicationStatus.FAILED,
          failedAt: new Date(),
          failureCategory: failure.category,
          failureSummary: failure.summary,
        },
      });
      throw new AppError('Failed to send quotation email. Please check SMTP settings or recipient addresses.', 502);
    }

    const acceptedAt = new Date();
    const providerMessageId = getProviderMessageId(sendInfo);
    const shouldTransitionToSent =
      quotation.isLatestRevision &&
      (quotation.status === QuotationStatus.DRAFT || quotation.status === QuotationStatus.PENDING);

    let quotationStatusAfter = quotation.status;
    let statusTransitioned = false;

    await this.db.$transaction(async (tx) => {
      await tx.quotationCommunication.update({
        where: { id: attempt.id },
        data: { status: CommunicationStatus.ACCEPTED, acceptedAt, providerMessageId },
      });

      if (shouldTransitionToSent) {
        validateStatusTransition(quotation.status, QuotationStatus.SENT);
        await tx.quotation.update({
          where: { id: quotation.id },
          data: {
            status: QuotationStatus.SENT,
            updatedById: userId,
            ...getStatusTimestampUpdate(QuotationStatus.SENT),
          },
        });
        await tx.quotationStatusHistory.create({
          data: {
            quotationId,
            fromStatus: quotation.status,
            toStatus: QuotationStatus.SENT,
            changedById: userId,
            comment: `Quotation emailed. Communication attempt #${attempt.id}.`,
          },
        });
        quotationStatusAfter = QuotationStatus.SENT;
        statusTransitioned = true;
      }

      await createAuditLog(tx, {
        metadata: { ...metadata, userId },
        entityType: 'QuotationCommunication',
        entityId: String(attempt.id),
        action: AuditAction.CREATE,
        newValues: {
          event: 'QUOTATION_EMAIL_ACCEPTED',
          quotationId,
          quotationNumber: quotation.quotationNumber,
          revisionNumber: quotation.revisionNumber,
          generatedDocumentId: input.generatedDocumentId,
          recipientCount: recipients.to.length,
          ccCount: recipients.cc.length,
          bccCount: recipients.bcc.length,
          attachmentCount: selectedAttachments.length,
          acceptedAt: acceptedAt.toISOString(),
          statusTransitioned,
        },
      });
    });

    return {
      communicationId: attempt.id,
      quotationId,
      generatedDocumentId: input.generatedDocumentId,
      status: CommunicationStatus.ACCEPTED,
      recipientCount: recipients.to.length,
      attachmentCount: selectedAttachments.length + 1,
      acceptedAt: acceptedAt.toISOString(),
      quotationStatusAfter,
      statusTransitioned,
      message: statusTransitioned
        ? 'Email accepted by email server and quotation status moved to Sent.'
        : 'Email accepted by email server.',
    };
  }
}

export const quotationCommunicationsRepository = new QuotationCommunicationsRepository(prisma);

export function validateSendQuotationEmailInput(input: unknown) {
  const result = sendQuotationEmailSchema.safeParse(input);
  if (!result.success) {
    const firstMessage = result.error.issues[0]?.message || 'Invalid email request data';
    throw new AppError(firstMessage, 400);
  }
  return result.data;
}
