import { Router } from 'express';
import { requireAuthentication, requireRole } from '../../core/auth/authentication.middleware.js';
import {
  calculatePreview,
  createQuotation,
  createQuotationRevision,
  deleteQuotation,
  getQuotation,
  listQuotations,
  updateQuotation,
  updateQuotationStatus,
} from './quotations.controller.js';

export const quotationsRouter = Router();

quotationsRouter.use(requireAuthentication);
quotationsRouter.use(requireRole('ADMIN'));

quotationsRouter.get('/', listQuotations);
quotationsRouter.post('/calculate', calculatePreview);
quotationsRouter.post('/', createQuotation);
quotationsRouter.get('/:id', getQuotation);
quotationsRouter.post('/:id/revisions', createQuotationRevision);
quotationsRouter.put('/:id', updateQuotation);
quotationsRouter.patch('/:id/status', updateQuotationStatus);
quotationsRouter.delete('/:id', deleteQuotation);
