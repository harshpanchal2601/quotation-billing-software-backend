import { Router } from 'express';
import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication } from '../auth/auth.middleware.js';
import { platformSubscriptionsRepository } from './platform-subscriptions.repository.js';

export const firmEntitlementsRouter = Router();
firmEntitlementsRouter.use(requireAuthentication, requireFirmContext);
firmEntitlementsRouter.get('/me', asyncHandler(async (req, res) => {
  if (req.user === undefined || req.user.mustChangePassword) throw new AppError('Change your temporary password before continuing', 403);
  const access = await platformSubscriptionsRepository.effectiveAccess(getFirmId(req), req.user.permissions);
  return sendSuccess(res, 200, 'Effective access retrieved', access);
}));
