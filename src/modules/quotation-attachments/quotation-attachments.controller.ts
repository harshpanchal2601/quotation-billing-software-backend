import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';

import { AppError } from '../../utils/AppError.js';
import {
  createQuotationAttachmentService,
  deleteQuotationAttachmentService,
  getAttachmentForDownloadService,
  getAttachmentForPreviewService,
  getQuotationAttachmentsService,
} from './quotation-attachments.service.js';
import { uploadQuotationAttachment } from './quotation-attachments.storage.js';

function parseId(param: string | undefined, paramName: string): number {
  const parsed = Number(param);
  if (!param || Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`Invalid ${paramName}`, 400);
  }
  return parsed;
}

function sanitiseFilename(filename: string): string {
  // Safe filename header substitution
  return filename.replace(/["\r\n/\\]/g, '_');
}

export async function getQuotationAttachmentsController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const result = await getQuotationAttachmentsService(quotationId);

    res.status(200).json({
      success: true,
      message: 'Quotation attachments retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export function uploadQuotationAttachmentController(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  uploadQuotationAttachment.single('file')(req, res, async (multerError) => {
    if (multerError) {
      if (multerError instanceof multer.MulterError) {
        if (multerError.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError('File size exceeds maximum limit of 20 MB', 413));
        }
        return next(new AppError(multerError.message, 400));
      }
      return next(multerError);
    }

    try {
      const quotationId = parseId(req.params.quotationId, 'quotation ID');
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError('Authentication required', 401);
      }

      const attachment = await createQuotationAttachmentService(quotationId, req.file, userId, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.status(201).json({
        success: true,
        message: 'Attachment uploaded successfully',
        data: { attachment },
      });
    } catch (error) {
      next(error);
    }
  });
}

export async function previewAttachmentController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const attachmentId = parseId(req.params.attachmentId, 'attachment ID');

    const { fullPath, mimeType, originalFilename } = await getAttachmentForPreviewService(
      quotationId,
      attachmentId,
    );

    const safeFilename = sanitiseFilename(originalFilename);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.sendFile(fullPath, (err) => {
      if (err && !res.headersSent) {
        next(new AppError('Failed to stream attachment preview', 500));
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function downloadAttachmentController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const attachmentId = parseId(req.params.attachmentId, 'attachment ID');

    const { fullPath, mimeType, originalFilename } = await getAttachmentForDownloadService(
      quotationId,
      attachmentId,
    );

    const safeFilename = sanitiseFilename(originalFilename);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.download(fullPath, safeFilename, (err) => {
      if (err && !res.headersSent) {
        next(new AppError('Failed to download attachment', 500));
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteAttachmentController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const attachmentId = parseId(req.params.attachmentId, 'attachment ID');

    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const result = await deleteQuotationAttachmentService(quotationId, attachmentId, userId, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
}
