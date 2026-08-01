import type { UserRole } from '@prisma/client';
import type { RequestHandler } from 'express';

import { AppError } from '../../core/errors/AppError.js';
import { ACCESS_TOKEN_COOKIE_NAME, AUTHENTICATION_REQUIRED_MESSAGE } from './auth.constants.js';
import { assertActiveUser } from './auth.helpers.js';
import { authRepository } from './auth.repository.js';
import { verifyAccessToken } from './security/auth.tokens.js';

export const requireAuthentication: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies[ACCESS_TOKEN_COOKIE_NAME] as string | undefined;

    if (token === undefined) {
      throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
    }

    const payload = verifyAccessToken(token);
    const user = await authRepository.findUserById(Number(payload.sub));

    if (user === null) {
      throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
    }

    assertActiveUser(user);

    if (user.passwordChangedAt !== null && payload.iat * 1000 < user.passwordChangedAt.getTime()) {
      throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
      sessionId: payload.sessionId,
    };

    next();
  } catch (error) {
    next(error instanceof AppError ? error : new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401));
  }
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new AppError('You are not authorised to perform this action', 403));
      return;
    }

    next();
  };
}
