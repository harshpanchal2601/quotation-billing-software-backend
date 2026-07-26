import { UserRole } from '@prisma/client';
import { Router } from 'express';

import { requireAuthentication, requireRole } from '../../middleware/authentication.js';
import { getDashboardOverviewController } from './dashboard.controller.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuthentication);
dashboardRouter.use(requireRole(UserRole.ADMIN));

dashboardRouter.get('/overview', getDashboardOverviewController);
