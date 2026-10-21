import { Router, type Request, type Response } from 'express';

import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { dashboardOverviewQuerySchema } from './dashboard.schema.js';
import { dashboardRepository } from './dashboard.repository.js';

export const dashboardRouter = Router();
export { dashboardRepository };

export async function getDashboardOverview(req: Request, res: Response) {
	const query = dashboardOverviewQuerySchema.parse(req.query);
	const data = await dashboardRepository.getDashboardOverview(getFirmId(req), query);

	return sendSuccess(res, 200, 'Dashboard overview retrieved successfully', data);
}

dashboardRouter.use(requireAuthentication);
dashboardRouter.use(requireFirmContext);
dashboardRouter.use(requirePermission(PERMISSIONS.DASHBOARD_VIEW));

dashboardRouter.get('/overview', asyncHandler(getDashboardOverview));
