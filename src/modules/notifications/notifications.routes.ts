import { Router } from 'express';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAccountType, requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { notificationRepository } from './notifications.repository.js';
import { notificationJobsRepository } from './jobs.repository.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { z } from 'zod';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuthentication, requireAccountType('SUPER_ADMIN', 'FIRM_ADMIN', 'FIRM_USER'), requireFirmContext);
notificationsRouter.get('/jobs', requirePermission(PERMISSIONS.FIRM_PROFILE_MANAGE), asyncHandler(async (req, res) => {
  const jobs = await notificationJobsRepository.list(getFirmId(req));
  return sendSuccess(res, 200, 'Notification jobs retrieved', { jobs });
}));
notificationsRouter.post('/jobs/:id/retry', requirePermission(PERMISSIONS.FIRM_PROFILE_MANAGE), asyncHandler(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const job = await notificationJobsRepository.retry(getFirmId(req), req.user!.id, id);
  return sendSuccess(res, 200, 'Notification job queued for retry', { job });
}));
notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const notifications = await notificationRepository.list(getFirmId(req), req.user!.id);
  return sendSuccess(res, 200, 'Notifications retrieved', { notifications });
}));
