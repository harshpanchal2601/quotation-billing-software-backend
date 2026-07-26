import crypto from 'node:crypto';

import type { UserRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import type { AccessTokenPayload, RefreshTokenPayload } from './auth.types.js';

const accessTokenPayloadSchema = z.object({
  sub: z.string().regex(/^\d+$/),
  role: z.literal('ADMIN'),
  sessionId: z.number().int().positive(),
  iat: z.number().int().positive(),
});

const refreshTokenPayloadSchema = z.object({
  sub: z.string().regex(/^\d+$/),
  sessionId: z.number().int().positive(),
  tokenType: z.literal('refresh'),
  jti: z.string().uuid(),
  iat: z.number().int().positive(),
});

export function durationToSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);

  if (match === null) {
    throw new Error(`Invalid duration: ${duration}`);
  }

  const value = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  } as const;

  return value * multipliers[unit as keyof typeof multipliers];
}

export function durationToMilliseconds(duration: string): number {
  return durationToSeconds(duration) * 1000;
}

export function hashRefreshToken(refreshToken: string): string {
  return crypto.createHash('sha256').update(refreshToken).digest('hex');
}

export function generateAccessToken(input: { userId: number; role: UserRole; sessionId: number }) {
  return jwt.sign(
    {
      sub: String(input.userId),
      role: input.role,
      sessionId: input.sessionId,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: durationToSeconds(env.JWT_ACCESS_EXPIRES_IN) },
  );
}

export function generateRefreshToken(input: { userId: number; sessionId: number }) {
  return jwt.sign(
    {
      sub: String(input.userId),
      sessionId: input.sessionId,
      tokenType: 'refresh',
      jti: crypto.randomUUID(),
    },
    env.JWT_REFRESH_SECRET,
    { expiresIn: durationToSeconds(env.JWT_REFRESH_EXPIRES_IN) },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return accessTokenPayloadSchema.parse(jwt.verify(token, env.JWT_ACCESS_SECRET));
  } catch {
    throw new AppError('Authentication required', 401);
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    return refreshTokenPayloadSchema.parse(jwt.verify(token, env.JWT_REFRESH_SECRET));
  } catch {
    throw new AppError('Authentication required', 401);
  }
}
