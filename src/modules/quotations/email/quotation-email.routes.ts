import { UserRole } from '@prisma/client';
import { Router, type Request, type Response } from 'express';

import { AppError } from '../../../core/errors/AppError.js';
import { asyncHandler } from '../../../core/http/asyncHandler.js';
import { requireAuthentication, requireRole } from '../../auth/auth.middleware.js';
import {
  quotationCommunicationsRepository,
  validateSendQuotationEmailInput,
} from '../communications/quotation-communications.repository.js';

export const quotationEmailRouter = Router({ mergeParams: true });

quotationEmailRouter.use(requireAuthentication);
quotationEmailRouter.use(requireRole(UserRole.ADMIN));

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

quotationEmailRouter.get(
  '/:quotationId/documents',
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const result = await quotationCommunicationsRepository.getDocumentHistory(quotationId, {
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
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const result = await quotationCommunicationsRepository.getCommunicationHistory(quotationId, {
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
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }
    const validatedInput = validateSendQuotationEmailInput(req.body);
    const result = await quotationCommunicationsRepository.sendQuotationEmail(
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
