import type { User } from '@prisma/client';

import { AppError } from '../../core/errors/AppError.js';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.constants.js';
import type { SanitisedUser } from './auth.types.js';

export function sanitiseUser(user: User): SanitisedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    status: user.status,
  };
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
