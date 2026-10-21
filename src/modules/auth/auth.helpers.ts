import { AccountType, FirmStatus, type User } from '@prisma/client';

import { AppError } from '../../core/errors/AppError.js';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.constants.js';
import type { SanitisedUser } from './auth.types.js';
import type { UserAccessRecord } from './auth.repository.js';
import { ALL_PERMISSIONS, expandAssignablePermissions, type Permission } from './permissions.js';

export function sanitiseUser(user: UserAccessRecord): SanitisedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    accountType: user.accountType,
    status: user.status,
    firmId: user.firmId,
    firm: user.firm ? { id: user.firm.id, name: user.firm.name, slug: user.firm.slug } : null,
    firmRole: user.firmRole ? { id: user.firmRole.id, name: user.firmRole.name } : null,
    permissions: resolveUserPermissions(user),
    mustChangePassword: user.mustChangePassword,
  };
}

export function assertFirmAccess(user: UserAccessRecord) {
  if (user.accountType === AccountType.SUPER_ADMIN) return;

  if (user.firm === null || user.firm.deletedAt !== null || user.firm.status !== FirmStatus.ACTIVE) {
    throw new AppError('Firm access is unavailable', 403);
  }

  if (
    user.accountType === AccountType.FIRM_USER &&
    (user.firmRole === null || user.firmRole.deletedAt !== null || user.firmRole.firmId !== user.firmId)
  ) {
    throw new AppError('Your account does not have an active role', 403);
  }
}

export function resolveUserPermissions(user: UserAccessRecord): Permission[] {
  if (user.accountType === AccountType.SUPER_ADMIN || user.accountType === AccountType.FIRM_ADMIN) {
    return ALL_PERMISSIONS;
  }

  return expandAssignablePermissions(user.firmRole?.permissions);
}

export function assertActiveUser(user: Pick<User, 'status' | 'deletedAt'>) {
  if (user.deletedAt !== null) {
    throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
  }

  if (user.status === 'INACTIVE') {
    throw new AppError('Account is inactive', 403);
  }

  if (user.status === 'LOCKED') {
    throw new AppError('Account is locked', 403);
  }
}
