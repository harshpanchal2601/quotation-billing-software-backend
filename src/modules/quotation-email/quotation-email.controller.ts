import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../utils/AppError.js';
import {
  getGeneratedDocumentHistoryService,
  getQuotationCommunicationHistoryService,
  sendQuotationEmailService,
} from './quotation-email.service.js';
import { validateSendQuotationEmailInput } from './quotation-email.validation.js';

function parseId(param: string | undefined, paramName: string): number {
  const parsed = Number(param);
  if (!param || Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`Invalid ${paramName}`, 400);
  }
  return parsed;
}

export async function getGeneratedDocumentHistoryController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const result = await getGeneratedDocumentHistoryService(quotationId, {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      sortOrder: req.query.sortOrder === 'asc' ? 'asc' : 'desc',
    });

    res.status(200).json({
      success: true,
      message: 'Generated document history retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function sendQuotationEmailController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const validatedInput = validateSendQuotationEmailInput(req.body);

    const result = await sendQuotationEmailService(quotationId, validatedInput, userId, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(200).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function getQuotationCommunicationHistoryController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const quotationId = parseId(req.params.quotationId, 'quotation ID');
    const result = await getQuotationCommunicationHistoryService(quotationId, {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 20,
      sortOrder: req.query.sortOrder === 'asc' ? 'asc' : 'desc',
    });

    res.status(200).json({
      success: true,
      message: 'Quotation communication history retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}
