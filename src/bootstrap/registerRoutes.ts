import { Router } from 'express';

import { healthRouter } from '../routes/health.routes.js';
import { authRouter } from '../modules/auth/index.js';
import { businessSettingsRouter } from '../modules/business-settings/business-settings.routes.js';
import { categoriesRouter } from '../modules/categories/index.js';
import { companiesRouter } from '../modules/companies/index.js';
import { dashboardRouter } from '../modules/dashboard/index.js';
import { itemsRouter } from '../modules/items/index.js';
import { measurementUnitsRouter } from '../modules/measurement-units/index.js';
import quotationDocumentsRouter from '../modules/quotation-documents/quotation-documents.routes.js';
import { quotationAttachmentsRouter } from '../modules/quotation-attachments/quotation-attachments.routes.js';
import { quotationEmailRouter } from '../modules/quotation-email/quotation-email.routes.js';
import { quotationsRouter } from '../modules/quotations/quotations.routes.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/settings', businessSettingsRouter);
apiRouter.use('/companies', companiesRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/measurement-units', measurementUnitsRouter);
apiRouter.use('/items', itemsRouter);
apiRouter.use('/quotations', quotationDocumentsRouter);
apiRouter.use('/quotations', quotationAttachmentsRouter);
apiRouter.use('/quotations', quotationEmailRouter);
apiRouter.use('/quotations', quotationsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/health', healthRouter);
