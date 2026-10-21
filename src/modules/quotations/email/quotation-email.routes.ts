import { Router, type Request, type Response } from 'express';

import { AppError } from '../../../core/errors/AppError.js';
import { asyncHandler } from '../../../core/http/asyncHandler.js';
import { getFirmId } from '../../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../../auth/auth.middleware.js';
import { PERMISSIONS } from '../../auth/permissions.js';
import {
  quotationCommunicationsRepository,
  validateSendQuotationEmailInput,
} from '../communications/quotation-communications.repository.js';

export const quotationEmailRouter = Router({ mergeParams: true });

quotationEmailRouter.use(requireAuthentication);

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
    firmId: req.firmId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

quotationEmailRouter.get(
  '/:quotationId/documents',
  requirePermission(PERMISSIONS.QUOTATIONS_DOCUMENTS, PERMISSIONS.QUOTATIONS_EMAIL),
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const result = await quotationCommunicationsRepository.getDocumentHistory(getFirmId(req), quotationId, {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      sortOrder: req.query.sortOrder === 'asc' ? 'asc' : 'desc',
    });
    res.status(200).json({
      success: true,
      message: 'Generated document history retrieved successfully',
      data: result,
    });
  }),
);

quotationEmailRouter.get(
  '/:quotationId/communications',
  requirePermission(PERMISSIONS.QUOTATIONS_EMAIL),
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const result = await quotationCommunicationsRepository.getCommunicationHistory(getFirmId(req), quotationId, {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      sortOrder: req.query.sortOrder === 'asc' ? 'asc' : 'desc',
    });
    res.status(200).json({
      success: true,
      message: 'Quotation communication history retrieved successfully',
      data: result,
    });
  }),
);

quotationEmailRouter.post(
  '/:quotationId/email',
  requirePermission(PERMISSIONS.QUOTATIONS_EMAIL),
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }
    const validatedInput = validateSendQuotationEmailInput(req.body);
    const result = await quotationCommunicationsRepository.sendQuotationEmail(
      getFirmId(req),
      quotationId,
      validatedInput,
      userId,
      metadata(req),
    );
    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  }),
);
