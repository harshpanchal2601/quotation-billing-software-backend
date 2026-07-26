import type { Request, Response } from 'express';

import { prisma } from '../../config/database.js';
import {
  AUTHENTICATION_REQUIRED_MESSAGE,
  REFRESH_TOKEN_COOKIE_NAME,
} from './auth.constants.js';
import { clearAuthCookies, setAuthCookies } from './auth.cookies.js';
import { AuthService } from './auth.service.js';
import { changePasswordSchema, loginSchema } from './auth.validation.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/AppError.js';

const authService = new AuthService(prisma);

function getMetadata(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

export async function login(req: Request, res: Response) {
  const input = loginSchema.parse(req.body);
  const result = await authService.login(input, getMetadata(req));

  setAuthCookies(res, result.tokens);

  return sendSuccess(res, 200, 'Login successful', {
    user: result.user,
  });
}

export async function refresh(req: Request, res: Response) {
  const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME] as string | undefined;

  if (refreshToken === undefined) {
    throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
  }

  const result = await authService.refresh(refreshToken);

  setAuthCookies(res, result.tokens);

  return sendSuccess(res, 200, 'Token refreshed successfully', {
    user: result.user,
  });
}

export async function logout(req: Request, res: Response) {
  const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME] as string | undefined;

  await authService.logout(refreshToken, getMetadata(req));
  clearAuthCookies(res);

  return sendSuccess(res, 200, 'Logout successful', null);
}

export async function me(req: Request, res: Response) {
  if (req.user === undefined) {
    throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
  }

  return sendSuccess(res, 200, 'Authenticated user retrieved', {
    user: req.user,
  });
}

export async function changePassword(req: Request, res: Response) {
  const input = changePasswordSchema.parse(req.body);

  if (req.user === undefined) {
    throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
  }

  await authService.changePassword(req.user.id, input, getMetadata(req));
  clearAuthCookies(res);

  return sendSuccess(res, 200, 'Password changed successfully. Please log in again.', null);
}
