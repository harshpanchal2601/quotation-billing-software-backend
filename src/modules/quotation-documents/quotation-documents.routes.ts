import { UserRole } from '@prisma/client';
import { Router } from 'express';

import { requireAuthentication, requireRole } from '../../core/auth/authentication.middleware.js';
import {
  downloadPdfController,
  generatePdfController,
  previewPdfController,
} from './quotation-documents.controller.js';

const router = Router({ mergeParams: true });

router.use(requireAuthentication);
router.use(requireRole(UserRole.ADMIN));

router.post('/:id/pdf', generatePdfController);
router.get('/:id/pdf/:documentId/preview', previewPdfController);
router.get('/:id/pdf/:documentId/download', downloadPdfController);

export default router;
