import { AuditAction, type PrismaClient } from '@prisma/client';

import { AppError } from '../../../core/errors/AppError.js';
import { createAuditLog, type RequestMetadata } from '../../../core/audit/audit-log.service.js';
import { prisma } from '../../../core/database/prisma.js';
import { storageService } from '../../../integrations/storage/index.js';
import {
  getFileCategory,
  MAX_ATTACHMENTS_PER_QUOTATION,
  MAX_FILE_SIZE_BYTES,
  PREVIEWABLE_MIME_TYPES,
  resolveAttachmentAbsolutePath,
  resolveAttachmentRelativePath,
} from './quotation-attachment.policy.js';
import type { QuotationAttachmentDto, QuotationAttachmentListResponse } from './quotation-attachments.types.js';

export class QuotationAttachmentsRepository {
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

  async listAttachments(quotationId: number): Promise<QuotationAttachmentListResponse> {
    await this.assertQuotationExists(quotationId);

    const attachments = await this.db.quotationAttachment.findMany({
      where: { quotationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });

    const dtos: QuotationAttachmentDto[] = attachments.map((att) => ({
      id: att.id,
      quotationId: att.quotationId,
      originalFilename: att.originalFilename,
      mimeType: att.mimeType,
      fileSize: Number(att.fileSize),
      fileCategory: getFileCategory(att.mimeType),
      canPreview: PREVIEWABLE_MIME_TYPES.has(att.mimeType),
      uploadedAt: att.createdAt.toISOString(),
      uploadedBy: att.uploadedBy ? { id: att.uploadedBy.id, name: att.uploadedBy.name } : undefined,
    }));

    return {
      attachments: dtos,
      limits: {
        maximumAttachments: MAX_ATTACHMENTS_PER_QUOTATION,
        remainingAttachments: Math.max(0, MAX_ATTACHMENTS_PER_QUOTATION - attachments.length),
        maximumFileSizeBytes: MAX_FILE_SIZE_BYTES,
      },
    };
  }

  async createAttachment(
    quotationId: number,
    file: Express.Multer.File,
    userId: number,
    metadata: RequestMetadata,
  ): Promise<QuotationAttachmentDto> {
    const quotation = await this.assertQuotationExists(quotationId);

    const activeCount = await this.db.quotationAttachment.count({
      where: { quotationId, deletedAt: null },
    });

    if (activeCount >= MAX_ATTACHMENTS_PER_QUOTATION) {
      throw new AppError(`Maximum ${MAX_ATTACHMENTS_PER_QUOTATION} attachments reached for this quotation`, 409);
    }

    const relativePath = resolveAttachmentRelativePath(file.filename);

    const attachment = await this.db.quotationAttachment.create({
      data: {
        quotationId,
        originalFilename: file.originalname,
        storedFilename: file.filename,
        filePath: relativePath,
        mimeType: file.mimetype,
        fileSize: BigInt(file.size),
        uploadedById: userId,
      },
      include: {
        uploadedBy: { select: { id: true, name: true } },
      },
    });

    await createAuditLog(this.db, {
      metadata: { ...metadata, userId },
      entityType: 'QuotationAttachment',
      entityId: String(attachment.id),
      action: AuditAction.CREATE,
      newValues: {
        quotationId,
        quotationNumber: quotation.quotationNumber,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
      },
    });

    return {
      id: attachment.id,
      quotationId: attachment.quotationId,
      originalFilename: attachment.originalFilename,
      mimeType: attachment.mimeType,
      fileSize: Number(attachment.fileSize),
      fileCategory: getFileCategory(attachment.mimeType),
      canPreview: PREVIEWABLE_MIME_TYPES.has(attachment.mimeType),
      uploadedAt: attachment.createdAt.toISOString(),
      uploadedBy: attachment.uploadedBy ? { id: attachment.uploadedBy.id, name: attachment.uploadedBy.name } : undefined,
    };
  }

  async getAttachmentForAccess(quotationId: number, attachmentId: number, previewOnly: boolean) {
    await this.assertQuotationExists(quotationId);

    const attachment = await this.db.quotationAttachment.findFirst({
      where: { id: attachmentId, quotationId, deletedAt: null },
    });

    if (!attachment) {
      throw new AppError('Attachment not found', 404);
    }

    if (previewOnly && !PREVIEWABLE_MIME_TYPES.has(attachment.mimeType)) {
      throw new AppError('Inline preview is not available for this file type. Download the file to view it.', 415);
    }

    const fullPath = resolveAttachmentAbsolutePath(attachment.filePath);
    const exists = await storageService.fileExists(attachment.filePath.replace(/^\/?storage\//, ''));
    if (!exists) {
      throw new AppError('Attachment file missing from storage', 404);
    }

    return {
      fullPath,
      mimeType: attachment.mimeType,
      originalFilename: attachment.originalFilename,
    };
  }

  async deleteAttachment(
    quotationId: number,
    attachmentId: number,
    userId: number,
    metadata: RequestMetadata,
  ): Promise<{ success: boolean; message: string }> {
    const quotation = await this.assertQuotationExists(quotationId);

    const attachment = await this.db.quotationAttachment.findFirst({
      where: { id: attachmentId, quotationId, deletedAt: null },
    });

    if (!attachment) {
      throw new AppError('Attachment not found', 404);
    }

    await this.db.quotationAttachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() },
    });

    const relativePath = attachment.filePath.replace(/^\/?storage\//, '');
    await storageService.deleteStorageFile(relativePath).catch(() => {});

    await createAuditLog(this.db, {
      metadata: { ...metadata, userId },
      entityType: 'QuotationAttachment',
      entityId: String(attachment.id),
      action: AuditAction.DELETE,
      oldValues: {
        quotationId,
        quotationNumber: quotation.quotationNumber,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
      },
    });

    return {
      success: true,
      message: 'Attachment deleted successfully',
    };
  }
}

export const quotationAttachmentsRepository = new QuotationAttachmentsRepository(prisma);
