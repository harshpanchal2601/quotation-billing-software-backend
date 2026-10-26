import { Router, type Request, type Response } from 'express';

import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { bankDetailsRepository } from './bank-details/bank-details.repository.js';
import {
  bankDetailCreateSchema,
  bankDetailUpdateSchema,
  idParamSchema,
} from './bank-details/bank-details.schema.js';
import { brandingRepository } from './branding/branding.repository.js';
import {
  brandingAssetConfig,
  mapMulterError,
  uploadBrandingAsset,
  type BrandingAssetType,
} from './branding/branding.policy.js';
import { businessProfileRepository } from './business-profile/business-profile.repository.js';
import { businessProfileUpdateSchema } from './business-profile/business-profile.schema.js';
import { quotationSettingsRepository } from './quotation-settings/quotation-settings.repository.js';
import { quotationSettingsUpdateSchema } from './quotation-settings/quotation-settings.schema.js';
import { businessPolicyRepository } from './business-policy/business-policy.repository.js';
import { businessPolicyUpdateSchema } from './business-policy/business-policy.schema.js';

export const settingsRouter = Router();

function metadata(req: Request) {
  return {
    userId: req.user?.id,
    firmId: req.firmId,
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

async function getBusinessProfile(req: Request, res: Response) {
  const businessProfile = await businessProfileRepository.getBusinessProfile(getFirmId(req));
  return sendSuccess(res, 200, 'Business profile retrieved successfully', { businessProfile });
}

async function getFirmBranding(req: Request, res: Response) {
  const businessProfile = await businessProfileRepository.getBusinessProfile(getFirmId(req));
  return sendSuccess(res, 200, 'Firm branding retrieved successfully', {
    branding: {
      displayName: businessProfile.displayName,
      logoUrl: businessProfile.logoUrl,
      primaryColour: businessProfile.primaryColour,
      secondaryColour: businessProfile.secondaryColour,
    },
  });
}

async function updateBusinessProfile(req: Request, res: Response) {
  const input = businessProfileUpdateSchema.parse(req.body);
  const businessProfile = await businessProfileRepository.updateBusinessProfile(getFirmId(req), input, metadata(req));
  return sendSuccess(res, 200, 'Business profile updated successfully', { businessProfile });
}

async function uploadBrandingAssetHandler(req: Request, res: Response) {
  const assetType = assetTypeFromRequest(req);
  const expectedField = brandingAssetConfig[assetType].field;
  const file = req.file;

  if (file === undefined || file.fieldname !== expectedField) {
    throw new AppError(`Upload a single ${expectedField} image`, 400);
  }

  const businessProfile = await brandingRepository.replaceAsset(getFirmId(req), assetType, file, metadata(req));
  return sendSuccess(res, 200, `${assetType} uploaded successfully`, { businessProfile });
}

async function deleteBrandingAsset(req: Request, res: Response) {
  const assetType = assetTypeFromRequest(req);
  const businessProfile = await brandingRepository.deleteAsset(getFirmId(req), assetType, metadata(req));
  return sendSuccess(res, 200, `${assetType} deleted successfully`, { businessProfile });
}

async function getQuotationSettings(req: Request, res: Response) {
  const quotationSettings = await quotationSettingsRepository.getQuotationSettings(getFirmId(req));
  return sendSuccess(res, 200, 'Quotation settings retrieved successfully', { quotationSettings });
}

async function updateQuotationSettings(req: Request, res: Response) {
  const input = quotationSettingsUpdateSchema.parse(req.body);
  const quotationSettings = await quotationSettingsRepository.updateQuotationSettings(getFirmId(req), input, metadata(req));
  return sendSuccess(res, 200, 'Quotation settings updated successfully', { quotationSettings });
}

async function listBankDetails(req: Request, res: Response) {
  const bankDetails = await bankDetailsRepository.listBankDetails(getFirmId(req));
  return sendSuccess(res, 200, 'Bank details retrieved successfully', { bankDetails });
}

async function createBankDetail(req: Request, res: Response) {
  const input = bankDetailCreateSchema.parse(req.body);
  const bankDetail = await bankDetailsRepository.createBankDetail(getFirmId(req), input, metadata(req));
  return sendSuccess(res, 201, 'Bank detail created successfully', { bankDetail });
}

async function updateBankDetail(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const input = bankDetailUpdateSchema.parse(req.body);
  const bankDetail = await bankDetailsRepository.updateBankDetail(getFirmId(req), id, input, metadata(req));
  return sendSuccess(res, 200, 'Bank detail updated successfully', { bankDetail });
}

async function deleteBankDetail(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  await bankDetailsRepository.deleteBankDetail(getFirmId(req), id, metadata(req));
  return sendSuccess(res, 200, 'Bank detail deleted successfully', null);
}

async function setDefaultBankDetail(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const bankDetail = await bankDetailsRepository.setDefaultBankDetail(getFirmId(req), id, metadata(req));
  return sendSuccess(res, 200, 'Default bank detail updated successfully', { bankDetail });
}

settingsRouter.use(requireAuthentication, requireFirmContext);

settingsRouter.get('/branding', asyncHandler(getFirmBranding));
settingsRouter.get('/business-policy', requirePermission(PERMISSIONS.FIRM_PROFILE_MANAGE), asyncHandler(async (req, res) => {
  const configuration = await businessPolicyRepository.get(getFirmId(req));
  return sendSuccess(res, 200, 'Business policy retrieved', { configuration });
}));
settingsRouter.put('/business-policy', requirePermission(PERMISSIONS.FIRM_PROFILE_MANAGE), asyncHandler(async (req, res) => {
  const input = businessPolicyUpdateSchema.parse(req.body);
  const configuration = await businessPolicyRepository.update(getFirmId(req), req.user!.id, input.expectedVersion, input.policy, metadata(req));
  return sendSuccess(res, 200, 'Business policy saved', { configuration });
}));
settingsRouter.get('/business-profile', requirePermission(PERMISSIONS.FIRM_PROFILE_MANAGE), asyncHandler(getBusinessProfile));
settingsRouter.put('/business-profile', requirePermission(PERMISSIONS.FIRM_PROFILE_MANAGE), asyncHandler(updateBusinessProfile));

for (const assetType of Object.keys(brandingAssetConfig)) {
  settingsRouter.post(
    `/business-profile/${assetType}`,
    requirePermission(PERMISSIONS.FIRM_PROFILE_MANAGE),
    (req, res, next) => {
      req.params.assetType = assetType;
      uploadBrandingAsset.single(brandingAssetConfig[assetType as keyof typeof brandingAssetConfig].field)(
        req,
        res,
        (error: unknown) => next(mapMulterError(error)),
      );
    },
    asyncHandler(uploadBrandingAssetHandler),
  );
  settingsRouter.delete(`/business-profile/${assetType}`, requirePermission(PERMISSIONS.FIRM_PROFILE_MANAGE), (req, _res, next) => {
    req.params.assetType = assetType;
    next();
  }, asyncHandler(deleteBrandingAsset));
}

settingsRouter.get('/quotation', requirePermission(PERMISSIONS.QUOTATION_SETTINGS_MANAGE), asyncHandler(getQuotationSettings));
settingsRouter.put('/quotation', requirePermission(PERMISSIONS.QUOTATION_SETTINGS_MANAGE), asyncHandler(updateQuotationSettings));

settingsRouter.get('/bank-details', requirePermission(PERMISSIONS.BANK_DETAILS_MANAGE), asyncHandler(listBankDetails));
settingsRouter.post('/bank-details', requirePermission(PERMISSIONS.BANK_DETAILS_MANAGE), asyncHandler(createBankDetail));
settingsRouter.put('/bank-details/:id', requirePermission(PERMISSIONS.BANK_DETAILS_MANAGE), asyncHandler(updateBankDetail));
settingsRouter.delete('/bank-details/:id', requirePermission(PERMISSIONS.BANK_DETAILS_MANAGE), asyncHandler(deleteBankDetail));
settingsRouter.patch('/bank-details/:id/default', requirePermission(PERMISSIONS.BANK_DETAILS_MANAGE), asyncHandler(setDefaultBankDetail));

settingsRouter.use(
  asyncHandler(async () => {
    throw new AppError('Settings route not found', 404);
  }),
);
