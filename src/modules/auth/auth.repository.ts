import { AuditAction, type PrismaClient } from '@prisma/client';

import type { RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';

export class AuthRepository {
  constructor(private readonly db: PrismaClient) {}

  findUserByIdentifier(identifier: string) {
    return this.db.user.findFirst({
      where: {
        deletedAt: null,
        OR: [{ email: identifier }, { username: identifier }],
      },
    });
  }

  findUserById(userId: number) {
    return this.db.user.findUnique({ where: { id: userId } });
  }

  createSession(userId: number, expiresAt: Date, ipAddress?: string, userAgent?: string) {
    return this.db.authSession.create({
      data: {
        userId,
        refreshTokenHash: 'pending',
        ipAddress,
        userAgent,
        expiresAt,
      },
    });
  }

  updateSessionRefreshTokenHash(sessionId: number, refreshTokenHash: string, expiresAt: Date) {
    return this.db.authSession.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash,
        expiresAt,
      },
    });
  }

  updateLastLoginAt(userId: number) {
    return this.db.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  findSessionWithUserById(sessionId: number) {
    return this.db.authSession.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
  }

  revokeSession(sessionId: number) {
    return this.db.authSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }

  revokeActiveSessions(userId: number) {
    return this.db.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  updatePassword(userId: number, passwordHash: string) {
    return this.db.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });
  }

  createAuditLog(userId: number, action: AuditAction, metadata: RequestMetadata) {
    return this.db.auditLog.create({
      data: {
        userId,
        entityType: 'User',
        entityId: String(userId),
        action,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
      },
    });
  }
}

export const authRepository = new AuthRepository(prisma);
