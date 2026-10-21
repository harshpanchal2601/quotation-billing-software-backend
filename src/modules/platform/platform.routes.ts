import { AccountType } from '@prisma/client';
import { Router, type Request, type Response } from 'express';

import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { requireAccountType, requireAuthentication } from '../auth/auth.middleware.js';
import { platformRepository } from './platform.repository.js';
import {
  platformFirmCreateSchema,
  platformFirmIdSchema,
  platformFirmListSchema,
  platformFirmStatusSchema,
  platformFirmUpdateSchema,
  platformAdminPasswordSchema,
} from './platform.schema.js';

export const platformRouter = Router();

function metadata(req: Request) {
  return { userId: req.user?.id, ipAddress: req.ip, userAgent: req.get('user-agent') };
}

async function listFirms(req: Request, res: Response) {
  const data = await platformRepository.listFirms(platformFirmListSchema.parse(req.query));
  return sendSuccess(res, 200, 'Firms retrieved successfully', data);
}

async function getFirm(req: Request, res: Response) {
  const firm = await platformRepository.getFirm(platformFirmIdSchema.parse(req.params).id);
  return sendSuccess(res, 200, 'Firm retrieved successfully', { firm });
}

async function createFirm(req: Request, res: Response) {
  const firm = await platformRepository.createFirm(platformFirmCreateSchema.parse(req.body), metadata(req));
  return sendSuccess(res, 201, 'Firm and administrator created successfully', { firm });
}

async function updateFirm(req: Request, res: Response) {
  const firm = await platformRepository.updateFirm(
    platformFirmIdSchema.parse(req.params).id,
    platformFirmUpdateSchema.parse(req.body),
    metadata(req),
  );
  return sendSuccess(res, 200, 'Firm updated successfully', { firm });
}

async function updateFirmStatus(req: Request, res: Response) {
  const firm = await platformRepository.updateFirmStatus(
    platformFirmIdSchema.parse(req.params).id,
    platformFirmStatusSchema.parse(req.body).status,
    metadata(req),
  );
  return sendSuccess(res, 200, 'Firm status updated successfully', { firm });
}

async function resetFirmAdministratorPassword(req: Request, res: Response) {
  await platformRepository.resetFirmAdministratorPassword(
    platformFirmIdSchema.parse(req.params).id,
    platformAdminPasswordSchema.parse(req.body).temporaryPassword,
    metadata(req),
  );
  return sendSuccess(res, 200, 'Firm administrator temporary password set successfully', null);
}

platformRouter.use(requireAuthentication, requireAccountType(AccountType.SUPER_ADMIN));
platformRouter.get('/firms', asyncHandler(listFirms));
platformRouter.post('/firms', asyncHandler(createFirm));
platformRouter.get('/firms/:id', asyncHandler(getFirm));
platformRouter.put('/firms/:id', asyncHandler(updateFirm));
platformRouter.patch('/firms/:id/status', asyncHandler(updateFirmStatus));
platformRouter.post('/firms/:id/administrator/reset-password', asyncHandler(resetFirmAdministratorPassword));
