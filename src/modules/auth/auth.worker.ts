import { AccountType, type Prisma } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';
import { assertActiveUser, assertFirmAccess, resolveUserPermissions } from './auth.helpers.js';
import type { Permission } from './permissions.js';

export async function authorizeFirmJobActor(tx: Prisma.TransactionClient, firmId: number, actorId: number, permission: Permission) {
  const user = await tx.user.findFirst({ where: { id: actorId, deletedAt: null }, include: { firm: true, firmRole: true } });
  if (user === null || (user.firmId !== firmId && user.accountType !== AccountType.SUPER_ADMIN) || user.mustChangePassword) throw new AppError('Job identity unavailable', 403);
  assertActiveUser(user);
  assertFirmAccess(user);
  if (!resolveUserPermissions(user).includes(permission)) throw new AppError('Job permission unavailable', 403);
  return user;
}
