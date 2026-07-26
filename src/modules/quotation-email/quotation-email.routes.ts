import { UserRole } from '@prisma/client';
import { Router } from 'express';

import { requireAuthentication, requireRole } from '../../middleware/authentication.js';
import {
  getGeneratedDocumentHistoryController,
  sendQuotationEmailController,
} from './quotation-email.controller.js';

export const quotationEmailRouter = Router({ mergeParams: true });

quotationEmailRouter.use(requireAuthentication);
quotationEmailRouter.use(requireRole(UserRole.ADMIN));

quotationEmailRouter.get('/:quotationId/documents', getGeneratedDocumentHistoryController);
quotationEmailRouter.post('/:quotationId/email', sendQuotationEmailController);
