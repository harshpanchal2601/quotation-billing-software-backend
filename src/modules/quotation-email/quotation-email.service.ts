import fs from 'node:fs/promises';
import path from 'node:path';
import { AuditAction } from '@prisma/client';

import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { createAuditLog, type RequestMetadata } from '../../utils/auditLog.js';
import { ATTACHMENT_STORAGE_DIR, STORAGE_ROOT as ATTACHMENT_STORAGE_ROOT } from '../quotation-attachments/quotation-attachments.storage.js';
import type {
  GeneratedDocumentHistoryItemDto,
  GeneratedDocumentHistoryResponse,
  SendQuotationEmailInput,
  SendQuotationEmailResponse,
} from '../quotation-documents/quotation-documents.types.js';
import { getMailTransporter } from './mail-transport.service.js';
import { buildQuotationEmailContent } from './quotation-email-template.js';

const DOC_STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
const PDF_STORAGE_DIR = path.resolve(DOC_STORAGE_ROOT, 'quotation-documents');
const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

function sanitiseFilename(filename: string): string {
  return filename.replace(/["\r\n/\\]/g, '_');
}

export async function getGeneratedDocumentHistoryService(
  quotationId: number,
  query: { page?: number; limit?: number; sortOrder?: 'asc' | 'desc' },
): Promise<GeneratedDocumentHistoryResponse> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, deletedAt: null },
    select: { id: true, quotationNumber: true },
  });

  if (!quotation) {
    throw new AppError('Quotation not found', 404);
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
  const skip = (page - 1) * limit;

  const total = await prisma.generatedDocument.count({
    where: { quotationId },
  });

  const documents = await prisma.generatedDocument.findMany({
    where: { quotationId },
    orderBy: { generatedAt: sortOrder },
    skip,
    take: limit,
    include: {
      generatedBy: { select: { id: true, name: true } },
    },
  });

  const items: GeneratedDocumentHistoryItemDto[] = await Promise.all(
    documents.map(async (doc) => {
      const fullPath = path.resolve(DOC_STORAGE_ROOT, doc.filePath.replace(/^\/?storage\//, ''));
      let isAvailable = false;
      if (fullPath.startsWith(PDF_STORAGE_DIR)) {
        try {
          await fs.stat(fullPath);
          isAvailable = true;
        } catch {
          isAvailable = false;
        }
      }

      const safeNumber = quotation.quotationNumber.replace(/[/\\\\]/g, '-');
      const displayFilename = `Quotation-${safeNumber}-v${doc.versionNumber}.pdf`;

      return {
        id: doc.id,
        quotationId: doc.quotationId,
        versionNumber: doc.versionNumber,
        documentType: doc.documentType,
        quotationNumber: quotation.quotationNumber,
        displayFilename,
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
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function sendQuotationEmailService(
  quotationId: number,
  input: SendQuotationEmailInput,
  userId: number,
  metadata: RequestMetadata,
): Promise<SendQuotationEmailResponse> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, deletedAt: null },
    select: { id: true, quotationNumber: true, status: true },
  });

  if (!quotation) {
    throw new AppError('Quotation not found', 404);
  }

  // 1. Fetch & validate Generated Document
  const document = await prisma.generatedDocument.findFirst({
    where: { id: input.generatedDocumentId, quotationId, documentType: 'QUOTATION_PDF' },
  });

  if (!document) {
    throw new AppError('Selected quotation PDF document not found', 404);
  }

  const pdfFullPath = path.resolve(DOC_STORAGE_ROOT, document.filePath.replace(/^\/?storage\//, ''));
  if (!pdfFullPath.startsWith(PDF_STORAGE_DIR)) {
    throw new AppError('Invalid document path', 403);
  }

  let pdfStat: import('node:fs').Stats;
  try {
    pdfStat = await fs.stat(pdfFullPath);
  } catch {
    throw new AppError('Selected quotation PDF file is missing from storage', 404);
  }

  let totalSizeBytes = pdfStat.size;

  // 2. Fetch & validate selected quotation attachments
  const attachmentIds = input.attachmentIds || [];
  const selectedAttachments: Array<{ id: number; fullPath: string; originalFilename: string; mimeType: string; size: number }> = [];

  if (attachmentIds.length > 0) {
    const fetchedAttachments = await prisma.quotationAttachment.findMany({
      where: {
        id: { in: attachmentIds },
        quotationId,
        deletedAt: null,
      },
    });

    if (fetchedAttachments.length !== attachmentIds.length) {
      throw new AppError('One or more selected attachments do not belong to this quotation or are unavailable', 404);
    }

    for (const att of fetchedAttachments) {
      const attFullPath = path.resolve(ATTACHMENT_STORAGE_ROOT, att.filePath.replace(/^\/?storage\//, ''));
      if (!attFullPath.startsWith(ATTACHMENT_STORAGE_DIR)) {
        throw new AppError('Invalid attachment storage path', 403);
      }
      try {
        const attStat = await fs.stat(attFullPath);
        totalSizeBytes += attStat.size;
        selectedAttachments.push({
          id: att.id,
          fullPath: attFullPath,
          originalFilename: att.originalFilename,
          mimeType: att.mimeType,
          size: attStat.size,
        });
      } catch {
        throw new AppError(`Attachment file "${att.originalFilename}" is missing from storage`, 404);
      }
    }
  }

  // 3. Size limit check
  if (totalSizeBytes > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
    throw new AppError('Total email attachment size exceeds 20 MB limit', 413);
  }

  // 4. Fetch business profile
  const businessProfile = await prisma.businessProfile.findFirst({
    select: { displayName: true, primaryEmail: true },
  });

  const businessName = businessProfile?.displayName || 'Buminex Pharmtech Solutions';
  const fromEmail = env.SMTP_FROM_EMAIL || businessProfile?.primaryEmail || 'noreply@example.com';
  const fromName = env.SMTP_FROM_NAME || businessName;

  // 5. Build email transport and message
  const transporter = getMailTransporter();
  const { text, html } = buildQuotationEmailContent({
    quotationNumber: quotation.quotationNumber,
    businessName,
    messageText: input.message,
  });

  const safePdfName = `Quotation-${quotation.quotationNumber.replace(/[/\\\\]/g, '-')}.pdf`;

  const emailAttachments = [
    {
      filename: safePdfName,
      path: pdfFullPath,
      contentType: 'application/pdf',
    },
    ...selectedAttachments.map((att) => ({
      filename: sanitiseFilename(att.originalFilename),
      path: att.fullPath,
      contentType: att.mimeType,
    })),
  ];

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: input.to.join(', '),
      cc: input.cc && input.cc.length > 0 ? input.cc.join(', ') : undefined,
      bcc: input.bcc && input.bcc.length > 0 ? input.bcc.join(', ') : undefined,
      subject: input.subject,
      text,
      html,
      attachments: emailAttachments,
    });
  } catch (err: unknown) {
    console.error('SMTP Send Error:', err instanceof Error ? err.message : 'Unknown SMTP error');
    throw new AppError('Failed to send quotation email. Please check SMTP settings or recipient addresses.', 502);
  }

  // 6. Write success Audit Log
  const acceptedAt = new Date().toISOString();
  await createAuditLog(prisma, {
    metadata: { ...metadata, userId },
    entityType: 'Quotation',
    entityId: String(quotationId),
    action: AuditAction.CREATE,
    newValues: {
      event: 'QUOTATION_EMAIL_SENT',
      quotationNumber: quotation.quotationNumber,
      generatedDocumentId: input.generatedDocumentId,
      recipientCount: input.to.length,
      ccCount: input.cc?.length || 0,
      bccCount: input.bcc?.length || 0,
      attachmentCount: selectedAttachments.length,
      acceptedAt,
    },
  });

  return {
    quotationId,
    generatedDocumentId: input.generatedDocumentId,
    recipientCount: input.to.length,
    attachmentCount: selectedAttachments.length + 1, // PDF + supporting
    acceptedAt,
  };
}
