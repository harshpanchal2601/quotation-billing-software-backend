import { UserRole } from '@prisma/client';
import { Router } from 'express';

import { requireAuthentication, requireRole } from '../../core/auth/authentication.middleware.js';
import {
  deleteAttachmentController,
  downloadAttachmentController,
  getQuotationAttachmentsController,
  previewAttachmentController,
  uploadQuotationAttachmentController,
} from './quotation-attachments.controller.js';

export const quotationAttachmentsRouter = Router({ mergeParams: true });

quotationAttachmentsRouter.use(requireAuthentication);
quotationAttachmentsRouter.use(requireRole(UserRole.ADMIN));

quotationAttachmentsRouter.get('/:quotationId/attachments', getQuotationAttachmentsController);
quotationAttachmentsRouter.post('/:quotationId/attachments', uploadQuotationAttachmentController);
quotationAttachmentsRouter.get('/:quotationId/attachments/:attachmentId/preview', previewAttachmentController);
quotationAttachmentsRouter.get('/:quotationId/attachments/:attachmentId/download', downloadAttachmentController);
quotationAttachmentsRouter.delete('/:quotationId/attachments/:attachmentId', deleteAttachmentController);
