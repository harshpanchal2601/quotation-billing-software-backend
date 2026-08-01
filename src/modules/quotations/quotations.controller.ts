import type { Request, Response } from 'express';

import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { QuotationsService } from './quotations.service.js';
import {
  calculationPreviewSchema,
  idParamSchema,
  quotationCreateSchema,
  quotationListQuerySchema,
  quotationStatusSchema,
  quotationUpdateSchema,
} from './quotations.validation.js';

const quotationsService = new QuotationsService(prisma);

export function getQuotationsServiceInstance() {
  return quotationsService;
}

export const listQuotations = asyncHandler(async (req: Request, res: Response) => {
  const query = quotationListQuerySchema.parse(req.query);
  const result = await quotationsService.listQuotations(query);
  return sendSuccess(res, 200, 'Quotations retrieved successfully', result);
});

export const calculatePreview = asyncHandler(async (req: Request, res: Response) => {
  const input = calculationPreviewSchema.parse(req.body);
  const result = await quotationsService.calculatePreview(input);
  return sendSuccess(res, 200, 'Calculation preview generated successfully', result);
});

export const createQuotation = asyncHandler(async (req: Request, res: Response) => {
  const input = quotationCreateSchema.parse(req.body);
  const userId = req.user?.id;
  if (!userId) throw new AppError('User authentication required', 401);
  const result = await quotationsService.createQuotation(input, getMetadata(req), userId);
  return sendSuccess(res, 201, 'Quotation created successfully', { quotation: result });
});

export const createQuotationRevision = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const userId = req.user?.id;
  if (!userId) throw new AppError('User authentication required', 401);
  const result = await quotationsService.createQuotationRevision(id, getMetadata(req), userId);
  return sendSuccess(res, 201, 'Quotation revision created successfully', { quotation: result });
});

export const getQuotation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const result = await quotationsService.getQuotation(id);
  return sendSuccess(res, 200, 'Quotation retrieved successfully', { quotation: result });
});

export const updateQuotation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const input = quotationUpdateSchema.parse(req.body);
  const userId = req.user?.id;
  if (!userId) throw new AppError('User authentication required', 401);
  const result = await quotationsService.updateQuotation(id, input, getMetadata(req), userId);
  return sendSuccess(res, 200, 'Quotation updated successfully', { quotation: result });
});

export const updateQuotationStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const input = quotationStatusSchema.parse(req.body);
  const userId = req.user?.id;
  if (!userId) throw new AppError('User authentication required', 401);
  const result = await quotationsService.updateQuotationStatus(id, input, getMetadata(req), userId);
  return sendSuccess(res, 200, 'Quotation status updated successfully', { quotation: result });
});

export const deleteQuotation = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const userId = req.user?.id;
  if (!userId) throw new AppError('User authentication required', 401);
  await quotationsService.deleteQuotation(id, getMetadata(req));
  return sendSuccess(res, 200, 'Quotation deleted successfully', null);
});

function getMetadata(req: Request) {
  return {
    userId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}
