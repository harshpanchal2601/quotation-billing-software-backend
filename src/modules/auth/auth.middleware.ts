import type { AccountType, UserRole } from '@prisma/client';
import type { RequestHandler } from 'express';

import { AppError } from '../../core/errors/AppError.js';
import { ACCESS_TOKEN_COOKIE_NAME, AUTHENTICATION_REQUIRED_MESSAGE } from './auth.constants.js';
import { assertActiveUser, assertFirmAccess, sanitiseUser } from './auth.helpers.js';
import { authRepository } from './auth.repository.js';
import type { Permission } from './permissions.js';
import { verifyAccessToken } from './security/auth.tokens.js';
import { assertFeatureEntitlements } from '../entitlements/index.js';

export const requireAuthentication: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies[ACCESS_TOKEN_COOKIE_NAME] as string | undefined;

    if (token === undefined) {
      throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
    }

    const payload = verifyAccessToken(token);
    const session = await authRepository.findSessionWithUserById(payload.sessionId);

    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now() ||
      session.userId !== Number(payload.sub)
    ) {
      throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
    }

    const user = session.user;
    assertActiveUser(user);
    assertFirmAccess(user);

    if (user.passwordChangedAt !== null && payload.iat * 1000 < user.passwordChangedAt.getTime()) {
      throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
    }

    req.user = {
      ...sanitiseUser(user),
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

export function requirePermission(...permissions: Permission[]): RequestHandler {
  return async (req, _res, next) => {
    if (req.user === undefined) {
      next(new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401));
      return;
    }

    if (req.user.mustChangePassword) {
      next(new AppError('Change your temporary password before continuing', 403));
      return;
    }

    if (!permissions.some((permission) => req.user?.permissions.includes(permission))) {
      next(new AppError('You are not authorised to perform this action', 403));
      return;
    }

    try {
      if (req.firmId === undefined) throw new AppError('Firm context is required', 500);
      await assertFeatureEntitlements(req.firmId, permissions.filter((permission) => req.user?.permissions.includes(permission)));
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAccountType(...accountTypes: AccountType[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401));
      return;
    }

    if (req.user.mustChangePassword) {
      next(new AppError('Change your temporary password before continuing', 403));
      return;
    }

    if (!accountTypes.includes(req.user.accountType)) {
      next(new AppError('You are not authorised to perform this action', 403));
      return;
    }

    next();
  };
}
