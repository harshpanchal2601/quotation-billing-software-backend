import { Router, type Request, type Response } from 'express';

import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { ASSIGNABLE_PERMISSIONS, PERMISSIONS } from '../auth/permissions.js';
import { administrationRepository } from './administration.repository.js';
import {
  administrationIdSchema,
  firmUserCreateSchema,
  firmUserUpdateSchema,
  roleCreateSchema,
  roleUpdateSchema,
  temporaryPasswordSchema,
} from './administration.schema.js';

export const administrationRouter = Router();

function metadata(req: Request) {
  return {
    userId: req.user?.id,
    firmId: req.firmId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

async function listPermissions(_req: Request, res: Response) {
  return sendSuccess(res, 200, 'Assignable permissions retrieved successfully', {
    permissions: ASSIGNABLE_PERMISSIONS,
  });
}

async function listRoles(req: Request, res: Response) {
  const roles = await administrationRepository.listRoles(getFirmId(req));
  return sendSuccess(res, 200, 'Roles retrieved successfully', { roles });
}

async function createRole(req: Request, res: Response) {
  const role = await administrationRepository.createRole(
    getFirmId(req),
    roleCreateSchema.parse(req.body),
    metadata(req),
  );
  return sendSuccess(res, 201, 'Role created successfully', { role });
}

async function updateRole(req: Request, res: Response) {
  const role = await administrationRepository.updateRole(
    getFirmId(req),
    administrationIdSchema.parse(req.params).id,
    roleUpdateSchema.parse(req.body),
    metadata(req),
  );
  return sendSuccess(res, 200, 'Role updated successfully', { role });
}

async function deleteRole(req: Request, res: Response) {
  await administrationRepository.deleteRole(
    getFirmId(req),
    administrationIdSchema.parse(req.params).id,
    metadata(req),
  );
  return sendSuccess(res, 200, 'Role deleted successfully', null);
}

async function listUsers(req: Request, res: Response) {
  const data = await administrationRepository.listUsers(getFirmId(req));
  return sendSuccess(res, 200, 'Firm users retrieved successfully', data);
}

async function createUser(req: Request, res: Response) {
  const user = await administrationRepository.createUser(
    getFirmId(req),
    firmUserCreateSchema.parse(req.body),
    metadata(req),
  );
  return sendSuccess(res, 201, 'Firm user created successfully', { user });
}

async function updateUser(req: Request, res: Response) {
  const user = await administrationRepository.updateUser(
    getFirmId(req),
    administrationIdSchema.parse(req.params).id,
    firmUserUpdateSchema.parse(req.body),
    metadata(req),
  );
  return sendSuccess(res, 200, 'Firm user updated successfully', { user });
}

async function resetUserPassword(req: Request, res: Response) {
  await administrationRepository.resetUserPassword(
    getFirmId(req),
    administrationIdSchema.parse(req.params).id,
    temporaryPasswordSchema.parse(req.body).temporaryPassword,
    metadata(req),
  );
  return sendSuccess(res, 200, 'Temporary password set successfully', null);
}

async function deleteUser(req: Request, res: Response) {
  await administrationRepository.deleteUser(
    getFirmId(req),
    administrationIdSchema.parse(req.params).id,
    metadata(req),
  );
  return sendSuccess(res, 200, 'Firm user deleted successfully', null);
}

administrationRouter.use(requireAuthentication, requireFirmContext);
administrationRouter.get(
  '/permissions',
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  asyncHandler(listPermissions),
);
administrationRouter.get('/roles', requirePermission(PERMISSIONS.ROLES_MANAGE), asyncHandler(listRoles));
administrationRouter.post('/roles', requirePermission(PERMISSIONS.ROLES_MANAGE), asyncHandler(createRole));
administrationRouter.put('/roles/:id', requirePermission(PERMISSIONS.ROLES_MANAGE), asyncHandler(updateRole));
administrationRouter.delete('/roles/:id', requirePermission(PERMISSIONS.ROLES_MANAGE), asyncHandler(deleteRole));
administrationRouter.get('/users', requirePermission(PERMISSIONS.USERS_MANAGE), asyncHandler(listUsers));
administrationRouter.post('/users', requirePermission(PERMISSIONS.USERS_MANAGE), asyncHandler(createUser));
administrationRouter.put('/users/:id', requirePermission(PERMISSIONS.USERS_MANAGE), asyncHandler(updateUser));
administrationRouter.post(
  '/users/:id/reset-password',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  asyncHandler(resetUserPassword),
);
administrationRouter.delete('/users/:id', requirePermission(PERMISSIONS.USERS_MANAGE), asyncHandler(deleteUser));
