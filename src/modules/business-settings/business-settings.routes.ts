import { Router } from 'express';
import { UserRole } from '@prisma/client';

import { requireAuthentication, requireRole } from '../../core/auth/authentication.middleware.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { AppError } from '../../core/errors/AppError.js';
import {
  createBankDetail,
  deleteBankDetail,
  deleteBrandingAsset,
  getBusinessProfile,
  getQuotationSettings,
  listBankDetails,
  mapMulterError,
  setDefaultBankDetail,
  updateBankDetail,
  updateBusinessProfile,
  updateQuotationSettings,
  uploadBrandingAssetController,
} from './business-settings.controller.js';
import { brandingAssetConfig, uploadBrandingAsset } from './branding-upload.js';

export const businessSettingsRouter = Router();

businessSettingsRouter.use(requireAuthentication, requireRole(UserRole.ADMIN));

businessSettingsRouter.get('/business-profile', getBusinessProfile);
businessSettingsRouter.put('/business-profile', updateBusinessProfile);

for (const assetType of Object.keys(brandingAssetConfig)) {
  businessSettingsRouter.post(
    `/business-profile/${assetType}`,
    (req, res, next) => {
      req.params.assetType = assetType;
      uploadBrandingAsset.single(brandingAssetConfig[assetType as keyof typeof brandingAssetConfig].field)(
        req,
        res,
        (error: unknown) => next(mapMulterError(error)),
      );
    },
    uploadBrandingAssetController,
  );
  businessSettingsRouter.delete(`/business-profile/${assetType}`, (req, _res, next) => {
    req.params.assetType = assetType;
    next();
  }, deleteBrandingAsset);
}

businessSettingsRouter.get('/quotation', getQuotationSettings);
businessSettingsRouter.put('/quotation', updateQuotationSettings);

businessSettingsRouter.get('/bank-details', listBankDetails);
businessSettingsRouter.post('/bank-details', createBankDetail);
businessSettingsRouter.put('/bank-details/:id', updateBankDetail);
businessSettingsRouter.delete('/bank-details/:id', deleteBankDetail);
businessSettingsRouter.patch('/bank-details/:id/default', setDefaultBankDetail);

businessSettingsRouter.use(
  asyncHandler(async () => {
    throw new AppError('Settings route not found', 404);
  }),
);
