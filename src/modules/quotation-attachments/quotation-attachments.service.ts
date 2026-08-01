import fs from 'node:fs/promises';
import path from 'node:path';
import { AuditAction } from '@prisma/client';

import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import {
  ATTACHMENT_STORAGE_DIR,
  getFileCategory,
  MAX_ATTACHMENTS_PER_QUOTATION,
  MAX_FILE_SIZE_BYTES,
  PREVIEWABLE_MIME_TYPES,
  STORAGE_ROOT,
} from './quotation-attachments.storage.js';
import type { QuotationAttachmentDto, QuotationAttachmentListResponse } from './quotation-attachments.types.js';

export async function getQuotationAttachmentsService(
  quotationId: number,
): Promise<QuotationAttachmentListResponse> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, deletedAt: null },
    select: { id: true },
  });

  if (!quotation) {
    throw new AppError('Quotation not found', 404);
  }

  const attachments = await prisma.quotationAttachment.findMany({
    where: { quotationId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      uploadedBy: {
        select: { id: true, name: true },
      },
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

export async function createQuotationAttachmentService(
  quotationId: number,
  file: Express.Multer.File | undefined,
  userId: number,
  metadata: RequestMetadata,
): Promise<QuotationAttachmentDto> {
  if (!file) {
    throw new AppError('No attachment file provided', 400);
  }

  const cleanupFile = async () => {
    if (file.path) {
      await fs.unlink(file.path).catch(() => {});
    }
  };

  try {
    const quotation = await prisma.quotation.findFirst({
      where: { id: quotationId, deletedAt: null },
      select: { id: true, quotationNumber: true },
    });

    if (!quotation) {
      await cleanupFile();
      throw new AppError('Quotation not found', 404);
    }

    const activeCount = await prisma.quotationAttachment.count({
      where: { quotationId, deletedAt: null },
    });

    if (activeCount >= MAX_ATTACHMENTS_PER_QUOTATION) {
      await cleanupFile();
      throw new AppError(`Maximum ${MAX_ATTACHMENTS_PER_QUOTATION} attachments reached for this quotation`, 409);
    }

    const relativePath = `storage/quotation-attachments/${file.filename}`;

    const attachment = await prisma.quotationAttachment.create({
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
        uploadedBy: {
          select: { id: true, name: true },
        },
      },
    });

    await createAuditLog(prisma, {
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
  } catch (error) {
    await cleanupFile();
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('The attachment could not be saved. Please try uploading it again.', 500);
  }
}

export async function getAttachmentForPreviewService(
  quotationId: number,
  attachmentId: number,
): Promise<{ fullPath: string; mimeType: string; originalFilename: string }> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, deletedAt: null },
    select: { id: true },
  });

  if (!quotation) {
    throw new AppError('Quotation not found', 404);
  }

  const attachment = await prisma.quotationAttachment.findFirst({
    where: { id: attachmentId, quotationId, deletedAt: null },
  });

  if (!attachment) {
    throw new AppError('Attachment not found', 404);
  }

  if (!PREVIEWABLE_MIME_TYPES.has(attachment.mimeType)) {
    throw new AppError('Inline preview is not available for this file type. Download the file to view it.', 415);
  }

  const fullPath = path.resolve(STORAGE_ROOT, attachment.filePath.replace(/^\/?storage\//, ''));
  if (!fullPath.startsWith(ATTACHMENT_STORAGE_DIR)) {
    throw new AppError('Invalid attachment path', 403);
  }

  try {
    await fs.stat(fullPath);
  } catch {
    throw new AppError('Attachment file missing from storage', 404);
  }

  return {
    fullPath,
    mimeType: attachment.mimeType,
    originalFilename: attachment.originalFilename,
  };
}

export async function getAttachmentForDownloadService(
  quotationId: number,
  attachmentId: number,
): Promise<{ fullPath: string; mimeType: string; originalFilename: string }> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, deletedAt: null },
    select: { id: true },
  });

  if (!quotation) {
    throw new AppError('Quotation not found', 404);
  }

  const attachment = await prisma.quotationAttachment.findFirst({
    where: { id: attachmentId, quotationId, deletedAt: null },
  });

  if (!attachment) {
    throw new AppError('Attachment not found', 404);
  }

  const fullPath = path.resolve(STORAGE_ROOT, attachment.filePath.replace(/^\/?storage\//, ''));
  if (!fullPath.startsWith(ATTACHMENT_STORAGE_DIR)) {
    throw new AppError('Invalid attachment path', 403);
  }

  try {
    await fs.stat(fullPath);
  } catch {
    throw new AppError('Attachment file missing from storage', 404);
  }

  return {
    fullPath,
    mimeType: attachment.mimeType,
    originalFilename: attachment.originalFilename,
  };
}

export async function deleteQuotationAttachmentService(
  quotationId: number,
  attachmentId: number,
  userId: number,
  metadata: RequestMetadata,
): Promise<{ success: boolean; message: string }> {
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, deletedAt: null },
    select: { id: true, quotationNumber: true },
  });

  if (!quotation) {
    throw new AppError('Quotation not found', 404);
  }

  const attachment = await prisma.quotationAttachment.findFirst({
    where: { id: attachmentId, quotationId, deletedAt: null },
  });

  if (!attachment) {
    throw new AppError('Attachment not found', 404);
  }

  // Soft delete database record
  await prisma.quotationAttachment.update({
    where: { id: attachmentId },
    data: { deletedAt: new Date() },
  });

  // Remove physical file
  const fullPath = path.resolve(STORAGE_ROOT, attachment.filePath.replace(/^\/?storage\//, ''));
  if (fullPath.startsWith(ATTACHMENT_STORAGE_DIR)) {
    await fs.unlink(fullPath).catch(() => {});
  }

  // Write audit log
  await createAuditLog(prisma, {
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
