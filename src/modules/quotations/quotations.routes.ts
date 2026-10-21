import { Router, type Request, type Response } from 'express';

import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { quotationAttachmentsRouter } from './attachments/quotation-attachments.routes.js';
import { quotationDocumentsRouter } from './documents/quotation-documents.routes.js';
import { quotationEmailRouter } from './email/quotation-email.routes.js';
import { quotationsRepository } from './quotations.repository.js';
import {
  calculationPreviewSchema,
  idParamSchema,
  quotationCreateSchema,
  quotationListQuerySchema,
  quotationStatusSchema,
  quotationUpdateSchema,
} from './quotations.schema.js';

export const quotationsRouter = Router();

quotationsRouter.use(requireAuthentication);
quotationsRouter.use(requireFirmContext);

quotationsRouter.use(quotationDocumentsRouter);
quotationsRouter.use(quotationAttachmentsRouter);
quotationsRouter.use(quotationEmailRouter);

function metadata(req: Request) {
  return {
    userId: req.user?.id,
    firmId: req.firmId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

quotationsRouter.get(
  '/',
  requirePermission(PERMISSIONS.QUOTATIONS_VIEW),
  asyncHandler(async (req: Request, res: Response) => {
    const query = quotationListQuerySchema.parse(req.query);
    const result = await quotationsRepository.listQuotations(getFirmId(req), query);
    return sendSuccess(res, 200, 'Quotations retrieved successfully', result);
  }),
);

quotationsRouter.post(
  '/calculate',
  requirePermission(PERMISSIONS.QUOTATIONS_CREATE),
  asyncHandler(async (req: Request, res: Response) => {
    const input = calculationPreviewSchema.parse(req.body);
    const result = await quotationsRepository.calculatePreview(getFirmId(req), input);
    return sendSuccess(res, 200, 'Calculation preview generated successfully', result);
  }),
);

quotationsRouter.post(
  '/',
  requirePermission(PERMISSIONS.QUOTATIONS_CREATE),
  asyncHandler(async (req: Request, res: Response) => {
    const input = quotationCreateSchema.parse(req.body);
    const userId = req.user?.id;
    if (!userId) throw new AppError('User authentication required', 401);
    const result = await quotationsRepository.createQuotation(getFirmId(req), input, metadata(req), userId);
    return sendSuccess(res, 201, 'Quotation created successfully', { quotation: result });
  }),
);

quotationsRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.QUOTATIONS_VIEW),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const result = await quotationsRepository.getQuotation(getFirmId(req), id);
    return sendSuccess(res, 200, 'Quotation retrieved successfully', { quotation: result });
  }),
);

quotationsRouter.post(
  '/:id/revisions',
  requirePermission(PERMISSIONS.QUOTATIONS_EDIT),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const userId = req.user?.id;
    if (!userId) throw new AppError('User authentication required', 401);
    const result = await quotationsRepository.createQuotationRevision(getFirmId(req), id, metadata(req), userId);
    return sendSuccess(res, 201, 'Quotation revision created successfully', { quotation: result });
  }),
);

quotationsRouter.put(
  '/:id',
  requirePermission(PERMISSIONS.QUOTATIONS_EDIT),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const input = quotationUpdateSchema.parse(req.body);
    const userId = req.user?.id;
    if (!userId) throw new AppError('User authentication required', 401);
    const result = await quotationsRepository.updateQuotation(getFirmId(req), id, input, metadata(req), userId);
    return sendSuccess(res, 200, 'Quotation updated successfully', { quotation: result });
  }),
);

quotationsRouter.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.QUOTATIONS_STATUS),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    const input = quotationStatusSchema.parse(req.body);
    const userId = req.user?.id;
    if (!userId) throw new AppError('User authentication required', 401);
    const result = await quotationsRepository.updateQuotationStatus(getFirmId(req), id, input, metadata(req), userId);
    return sendSuccess(res, 200, 'Quotation status updated successfully', { quotation: result });
  }),
);

quotationsRouter.delete(
  '/:id',
  requirePermission(PERMISSIONS.QUOTATIONS_DELETE),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = idParamSchema.parse(req.params);
    if (!req.user?.id) throw new AppError('User authentication required', 401);
    await quotationsRepository.deleteQuotation(getFirmId(req), id, metadata(req));
    return sendSuccess(res, 200, 'Quotation deleted successfully', null);
  }),
);
