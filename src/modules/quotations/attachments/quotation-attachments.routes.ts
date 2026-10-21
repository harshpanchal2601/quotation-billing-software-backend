import { UserRole } from '@prisma/client';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import { AppError } from '../../../core/errors/AppError.js';
import { asyncHandler } from '../../../core/http/asyncHandler.js';
import { requireAuthentication, requireRole } from '../../auth/auth.middleware.js';
import {
  sanitiseAttachmentFilename,
  uploadQuotationAttachment,
} from './quotation-attachment.policy.js';
import { quotationAttachmentsRepository } from './quotation-attachments.repository.js';

export const quotationAttachmentsRouter = Router({ mergeParams: true });

quotationAttachmentsRouter.use(requireAuthentication);
quotationAttachmentsRouter.use(requireRole(UserRole.ADMIN));

function parseId(param: string | undefined, paramName: string): number {
  const parsed = Number(param);
  if (!param || Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`Invalid ${paramName}`, 400);
  }
  return parsed;
}

function metadata(req: Request) {
  return {
    userId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

quotationAttachmentsRouter.get(
  '/:quotationId/attachments',
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const result = await quotationAttachmentsRepository.listAttachments(quotationId);
    res.status(200).json({
      success: true,
      message: 'Quotation attachments retrieved successfully',
      data: result,
    });
  }),
);

quotationAttachmentsRouter.post(
  '/:quotationId/attachments',
  (req: Request, res: Response) => {
    return uploadQuotationAttachment.single('file')(req, res, async (multerError) => {
      if (multerError) {
        if (multerError instanceof multer.MulterError) {
          if (multerError.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              success: false,
              message: 'File size exceeds maximum limit of 20 MB',
            });
          }
          return res.status(400).json({
            success: false,
            message: 'The attachment could not be uploaded. Please choose a supported file and try again.',
          });
        }
        return res.status(500).json({ success: false, message: multerError.message });
      }

      try {
        const quotationId = parseId(req.params.quotationId, 'quotation ID');
        const userId = req.user?.id;
        if (!userId) {
          throw new AppError('Authentication required', 401);
        }
        if (!req.file) {
          throw new AppError('No attachment file provided', 400);
        }

        const attachment = await quotationAttachmentsRepository.createAttachment(
          quotationId,
          req.file,
          userId,
          metadata(req),
        );

        return res.status(201).json({
          success: true,
          message: 'Attachment uploaded successfully',
          data: { attachment },
        });
      } catch (error) {
        if (req.file?.path) {
          const fs = await import('node:fs/promises');
          await fs.unlink(req.file.path).catch(() => {});
        }
        if (error instanceof AppError) {
          return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        return res.status(500).json({
          success: false,
          message: 'The attachment could not be saved. Please try uploading it again.',
        });
      }
    });
  },
);

quotationAttachmentsRouter.get(
  '/:quotationId/attachments/:attachmentId/preview',
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const attachmentId = parseId(req.params.attachmentId, 'attachment ID');
    const { fullPath, mimeType, originalFilename } = await quotationAttachmentsRepository.getAttachmentForAccess(
      quotationId,
      attachmentId,
      true,
    );
    const safeFilename = sanitiseAttachmentFilename(originalFilename);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(fullPath, (err) => {
      if (err && !res.headersSent) {
        throw new AppError('Failed to stream attachment preview', 500);
      }
    });
  }),
);

quotationAttachmentsRouter.get(
  '/:quotationId/attachments/:attachmentId/download',
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const attachmentId = parseId(req.params.attachmentId, 'attachment ID');
    const { fullPath, mimeType, originalFilename } = await quotationAttachmentsRepository.getAttachmentForAccess(
      quotationId,
      attachmentId,
      false,
    );
    const safeFilename = sanitiseAttachmentFilename(originalFilename);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(fullPath, safeFilename, (err) => {
      if (err && !res.headersSent) {
        throw new AppError('Failed to download attachment', 500);
      }
    });
  }),
);

quotationAttachmentsRouter.delete(
  '/:quotationId/attachments/:attachmentId',
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const attachmentId = parseId(req.params.attachmentId, 'attachment ID');
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }
    const result = await quotationAttachmentsRepository.deleteAttachment(
      quotationId,
      attachmentId,
      userId,
      metadata(req),
    );
    res.status(200).json({
      success: true,
      message: result.message,
    });
  }),
);
