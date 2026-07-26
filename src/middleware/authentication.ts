import type { RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';

import { prisma } from '../config/database.js';
import { ACCESS_TOKEN_COOKIE_NAME, AUTHENTICATION_REQUIRED_MESSAGE } from '../modules/auth/auth.constants.js';
import { verifyAccessToken } from '../modules/auth/auth.tokens.js';
import { AppError } from '../utils/AppError.js';

export const requireAuthentication: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies[ACCESS_TOKEN_COOKIE_NAME] as string | undefined;

    if (token === undefined) {
      throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
    }

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where: { id: Number(payload.sub) },
    });

    if (user === null || user.deletedAt !== null || user.status !== 'ACTIVE') {
      throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
    }

    if (
      user.passwordChangedAt !== null &&
      payload.iat * 1000 < user.passwordChangedAt.getTime()
    ) {
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
