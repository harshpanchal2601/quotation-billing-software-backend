import { Router, type Request, type Response } from 'express';

import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { auditLogsRepository } from './audit-logs.repository.js';
import { auditLogListSchema } from './audit-logs.schema.js';

export const auditLogsRouter = Router();

async function listAuditLogs(req: Request, res: Response) {
  const data = await auditLogsRepository.list(getFirmId(req), auditLogListSchema.parse(req.query));
  return sendSuccess(res, 200, 'Audit logs retrieved successfully', data);
}

auditLogsRouter.use(requireAuthentication, requireFirmContext, requirePermission(PERMISSIONS.AUDIT_VIEW));
auditLogsRouter.get('/', asyncHandler(listAuditLogs));
