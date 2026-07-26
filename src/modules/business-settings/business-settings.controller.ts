import type { Request, Response } from 'express';
import multer from 'multer';

import { prisma } from '../../config/database.js';
import { AppError } from '../../utils/AppError.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { BankDetailsService } from './bank-details.service.js';
import { BrandingAssetsService } from './branding-assets.service.js';
import { brandingAssetConfig, type BrandingAssetType } from './branding-upload.js';
import { BusinessProfileService } from './business-profile.service.js';
import { QuotationSettingsService } from './quotation-settings.service.js';
import {
  bankDetailCreateSchema,
  bankDetailUpdateSchema,
  businessProfileUpdateSchema,
  idParamSchema,
  quotationSettingsUpdateSchema,
} from './business-settings.validation.js';

const businessProfileService = new BusinessProfileService(prisma);
const quotationSettingsService = new QuotationSettingsService(prisma);
const bankDetailsService = new BankDetailsService(prisma);
const brandingAssetsService = new BrandingAssetsService(prisma);

function metadata(req: Request) {
  return {
    userId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

function assetTypeFromRequest(req: Request): BrandingAssetType {
  const assetType = req.params.assetType;
  if (assetType !== 'logo' && assetType !== 'signature' && assetType !== 'stamp') {
    throw new AppError('Branding asset not found', 404);
  }
  return assetType;
}

export const getBusinessProfile = asyncHandler(async (_req: Request, res: Response) => {
  const businessProfile = await businessProfileService.getBusinessProfile();
  return sendSuccess(res, 200, 'Business profile retrieved successfully', { businessProfile });
});

export const updateBusinessProfile = asyncHandler(async (req: Request, res: Response) => {
  const input = businessProfileUpdateSchema.parse(req.body);
  const businessProfile = await businessProfileService.updateBusinessProfile(input, metadata(req));
  return sendSuccess(res, 200, 'Business profile updated successfully', { businessProfile });
});

export const uploadBrandingAssetController = asyncHandler(async (req: Request, res: Response) => {
  const assetType = assetTypeFromRequest(req);
  const expectedField = brandingAssetConfig[assetType].field;
  const file = req.file;

  if (file === undefined || file.fieldname !== expectedField) {
    throw new AppError(`Upload a single ${expectedField} image`, 400);
  }

  const businessProfile = await brandingAssetsService.replaceAsset(assetType, file, metadata(req));
  return sendSuccess(res, 200, `${assetType} uploaded successfully`, { businessProfile });
});

export const deleteBrandingAsset = asyncHandler(async (req: Request, res: Response) => {
  const assetType = assetTypeFromRequest(req);
  const businessProfile = await brandingAssetsService.deleteAsset(assetType, metadata(req));
  return sendSuccess(res, 200, `${assetType} deleted successfully`, { businessProfile });
});

export const getQuotationSettings = asyncHandler(async (_req: Request, res: Response) => {
  const quotationSettings = await quotationSettingsService.getQuotationSettings();
  return sendSuccess(res, 200, 'Quotation settings retrieved successfully', { quotationSettings });
});

export const updateQuotationSettings = asyncHandler(async (req: Request, res: Response) => {
  const input = quotationSettingsUpdateSchema.parse(req.body);
  const quotationSettings = await quotationSettingsService.updateQuotationSettings(input, metadata(req));
  return sendSuccess(res, 200, 'Quotation settings updated successfully', { quotationSettings });
});

export const listBankDetails = asyncHandler(async (_req: Request, res: Response) => {
  const bankDetails = await bankDetailsService.listBankDetails();
  return sendSuccess(res, 200, 'Bank details retrieved successfully', { bankDetails });
});

export const createBankDetail = asyncHandler(async (req: Request, res: Response) => {
  const input = bankDetailCreateSchema.parse(req.body);
  const bankDetail = await bankDetailsService.createBankDetail(input, metadata(req));
  return sendSuccess(res, 201, 'Bank detail created successfully', { bankDetail });
});

export const updateBankDetail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const input = bankDetailUpdateSchema.parse(req.body);
  const bankDetail = await bankDetailsService.updateBankDetail(id, input, metadata(req));
  return sendSuccess(res, 200, 'Bank detail updated successfully', { bankDetail });
});

export const deleteBankDetail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  await bankDetailsService.deleteBankDetail(id, metadata(req));
  return sendSuccess(res, 200, 'Bank detail deleted successfully', null);
});

export const setDefaultBankDetail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const bankDetail = await bankDetailsService.setDefaultBankDetail(id, metadata(req));
  return sendSuccess(res, 200, 'Default bank detail updated successfully', { bankDetail });
});

export function mapMulterError(error: unknown) {
  if (error instanceof AppError) return error;
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return new AppError('Image must be 5 MB or smaller', 413);
    return new AppError('Invalid upload request', 400);
  }
  return error;
}
