import type { Request, Response } from 'express';

import { getDashboardOverviewService } from './dashboard.service.js';
import { dashboardOverviewQuerySchema } from './dashboard.validation.js';

export async function getDashboardOverviewController(req: Request, res: Response): Promise<void> {
  const query = dashboardOverviewQuerySchema.parse(req.query);
  const data = await getDashboardOverviewService(query);

  res.status(200).json({
    success: true,
    message: 'Dashboard overview retrieved successfully',
    data,
  });
}
