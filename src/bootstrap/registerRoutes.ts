import { Router } from 'express';

import { healthRouter } from '../routes/health.routes.js';
import { authRouter } from '../modules/auth/index.js';
import { settingsRouter } from '../modules/settings/index.js';
import { categoriesRouter } from '../modules/categories/index.js';
import { companiesRouter } from '../modules/companies/index.js';
import { dashboardRouter } from '../modules/dashboard/index.js';
import { itemsRouter } from '../modules/items/index.js';
import { measurementUnitsRouter } from '../modules/measurement-units/index.js';
import { quotationsRouter } from '../modules/quotations/index.js';
import { firmEntitlementsRouter, platformRouter } from '../modules/platform/index.js';
import { administrationRouter } from '../modules/administration/index.js';
import { auditLogsRouter } from '../modules/audit-logs/index.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/platform', platformRouter);
apiRouter.use('/entitlements', firmEntitlementsRouter);
apiRouter.use('/administration', administrationRouter);
apiRouter.use('/audit-logs', auditLogsRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/companies', companiesRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/measurement-units', measurementUnitsRouter);
apiRouter.use('/items', itemsRouter);
apiRouter.use('/quotations', quotationsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/health', healthRouter);
