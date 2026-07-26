import bcrypt from 'bcrypt';
import type { PrismaClient, User } from '@prisma/client';
import { AuditAction, UserStatus } from '@prisma/client';

import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.constants.js';
import { hashRefreshToken, durationToMilliseconds, generateAccessToken, generateRefreshToken, verifyRefreshToken } from './auth.tokens.js';
import type { ChangePasswordInput, LoginInput } from './auth.validation.js';
import type { SanitisedUser } from './auth.types.js';

type RequestMetadata = {
  ipAddress?: string;
  userAgent?: string;
};

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

function sanitiseUser(user: User): SanitisedUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    status: user.status,
  };
}

function assertActiveUser(user: Pick<User, 'status' | 'deletedAt'>) {
  if (user.deletedAt !== null) {
    throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
  }

  if (user.status === UserStatus.INACTIVE) {
    throw new AppError('Account is inactive', 403);
  }

  if (user.status === UserStatus.LOCKED) {
    throw new AppError('Account is locked', 403);
  }
}

export class AuthService {
  constructor(private readonly db: PrismaClient) {}

  async login(input: LoginInput, metadata: RequestMetadata) {
    const identifier = input.identifier.trim().toLowerCase();
    const user = await this.db.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email: identifier }, { username: identifier }],
      },
    });

    if (user === null) {
      throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    assertActiveUser(user);

    const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);

    if (!passwordMatches) {
      throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    const expiresAt = new Date(Date.now() + durationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN));
    const session = await this.db.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: 'pending',
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        expiresAt,
      },
    });
    const tokens = this.generateTokens(user, session.id);

    await this.db.authSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashRefreshToken(tokens.refreshToken),
        expiresAt,
      },
    });
    await this.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.createAuditLog(user.id, AuditAction.LOGIN, metadata);

    return {
      user: sanitiseUser(user),
      tokens,
    };
  }

  async refresh(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);
    const session = await this.db.authSession.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });

    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now() ||
      session.userId !== Number(payload.sub)
    ) {
      throw new AppError('Authentication required', 401);
    }

    assertActiveUser(session.user);

    if (session.refreshTokenHash !== hashRefreshToken(refreshToken)) {
      throw new AppError('Authentication required', 401);
    }

    const tokens = this.generateTokens(session.user, session.id);

    await this.db.authSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashRefreshToken(tokens.refreshToken),
        expiresAt: new Date(Date.now() + durationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN)),
      },
    });

    return {
      user: sanitiseUser(session.user),
      tokens,
    };
  }

  async logout(refreshToken: string | undefined, metadata: RequestMetadata) {
    if (refreshToken === undefined) {
      return;
    }

    try {
      const payload = verifyRefreshToken(refreshToken);
      const session = await this.db.authSession.findUnique({
        where: { id: payload.sessionId },
      });

      if (session === null || session.userId !== Number(payload.sub)) {
        return;
      }

      await this.db.authSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      await this.createAuditLog(session.userId, AuditAction.LOGOUT, metadata);
    } catch {
      return;
    }
  }

  async getUser(userId: number) {
    const user = await this.db.user.findUnique({ where: { id: userId } });

    if (user === null) {
      throw new AppError('Authentication required', 401);
    }

    assertActiveUser(user);

    return sanitiseUser(user);
  }

  async changePassword(userId: number, input: ChangePasswordInput, metadata: RequestMetadata) {
    const user = await this.db.user.findUnique({ where: { id: userId } });

    if (user === null) {
      throw new AppError('Authentication required', 401);
    }

    assertActiveUser(user);

    const currentPasswordMatches = await bcrypt.compare(input.currentPassword, user.passwordHash);

    if (!currentPasswordMatches) {
      throw new AppError('Current password is incorrect', 401);
    }

    const samePassword = await bcrypt.compare(input.newPassword, user.passwordHash);

    if (samePassword) {
      throw new AppError('New password must be different from the current password', 400);
    }

    const passwordHash = await bcrypt.hash(input.newPassword, env.BCRYPT_SALT_ROUNDS);

    await this.db.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });
    await this.db.authSession.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    await this.createAuditLog(user.id, AuditAction.PASSWORD_CHANGE, metadata);
  }

  private generateTokens(user: Pick<User, 'id' | 'role'>, sessionId: number): AuthTokens {
    return {
      accessToken: generateAccessToken({ userId: user.id, role: user.role, sessionId }),
      refreshToken: generateRefreshToken({ userId: user.id, sessionId }),
    };
  }

  private async createAuditLog(userId: number, action: AuditAction, metadata: RequestMetadata) {
    try {
      await this.db.auditLog.create({
        data: {
          userId,
          entityType: 'User',
          entityId: String(userId),
          action,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
        },
      });
    } catch (error) {
      console.warn('Authentication audit log could not be created.');
      console.warn(error instanceof Error ? error.message : 'Unknown audit error');
    }
  }
}
