import bcrypt from 'bcrypt';
import type { PrismaClient, User } from '@prisma/client';
import { AuditAction, UserRole, UserStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.PORT = '5000';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/buminex_quotation';
process.env.JWT_ACCESS_SECRET = 'access-secret';
process.env.JWT_REFRESH_SECRET = 'refresh-secret';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.BCRYPT_SALT_ROUNDS = '10';

const { AuthService } = await import('../src/modules/auth/auth.service.js');
const { hashRefreshToken, verifyRefreshToken } = await import('../src/modules/auth/auth.tokens.js');
const { INVALID_CREDENTIALS_MESSAGE } = await import('../src/modules/auth/auth.constants.js');

type MockPrisma = {
  user: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  authSession: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
};

function createMockPrisma(): MockPrisma {
  return {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    authSession: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };
}

function asPrisma(db: MockPrisma): PrismaClient {
  return db as unknown as PrismaClient;
}

function createUser(overrides: Partial<User> = {}): User {
  return {
    id: 1,
    name: 'Admin Name',
    email: 'admin@example.com',
    username: 'admin',
    passwordHash: '$2b$10$placeholderplaceholderplaceholderplaceholderplaceholder',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    lastLoginAt: null,
    passwordChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('AuthService', () => {
  let db: MockPrisma;
  let service: InstanceType<typeof AuthService>;

  beforeEach(() => {
    db = createMockPrisma();
    service = new AuthService(asPrisma(db));
  });

  it('logs in with a username, creates a hashed session token and sanitises the response', async () => {
    const passwordHash = await bcrypt.hash('StrongPass1!', 10);
    db.user.findFirst.mockResolvedValueOnce(createUser({ passwordHash }));
    db.authSession.create.mockResolvedValueOnce({ id: 10 });
    db.authSession.update.mockResolvedValueOnce({ id: 10 });
    db.user.update.mockResolvedValueOnce(createUser({ passwordHash }));
    db.auditLog.create.mockResolvedValueOnce({ id: 1 });

    const result = await service.login(
      { identifier: ' Admin ', password: 'StrongPass1!' },
      { ipAddress: '127.0.0.1', userAgent: 'vitest' },
    );

    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [{ email: 'admin' }, { username: 'admin' }],
      },
    });
    expect(result.user).toEqual({
      id: 1,
      name: 'Admin Name',
      email: 'admin@example.com',
      username: 'admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    expect(result).not.toHaveProperty('user.passwordHash');

    const updateCall = db.authSession.update.mock.calls[0]?.[0];
    expect(updateCall.data.refreshTokenHash).toBe(hashRefreshToken(result.tokens.refreshToken));
    expect(updateCall.data.refreshTokenHash).not.toBe(result.tokens.refreshToken);
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 1,
        entityType: 'User',
        entityId: '1',
        action: AuditAction.LOGIN,
      }),
    });
  });

  it('logs in with an email identifier', async () => {
    const passwordHash = await bcrypt.hash('StrongPass1!', 10);
    db.user.findFirst.mockResolvedValueOnce(createUser({ passwordHash }));
    db.authSession.create.mockResolvedValueOnce({ id: 11 });
    db.authSession.update.mockResolvedValueOnce({ id: 11 });
    db.user.update.mockResolvedValueOnce(createUser({ passwordHash }));
    db.auditLog.create.mockResolvedValueOnce({ id: 2 });

    await service.login(
      { identifier: ' ADMIN@EXAMPLE.COM ', password: 'StrongPass1!' },
      {},
    );

    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [{ email: 'admin@example.com' }, { username: 'admin@example.com' }],
      },
    });
  });

  it('uses the same public error for unknown users and incorrect passwords', async () => {
    db.user.findFirst.mockResolvedValueOnce(null);
    await expect(service.login({ identifier: 'admin', password: 'StrongPass1!' }, {})).rejects.toMatchObject({
      statusCode: 401,
      message: INVALID_CREDENTIALS_MESSAGE,
    });

    db.user.findFirst.mockResolvedValueOnce(createUser({ passwordHash: await bcrypt.hash('StrongPass1!', 10) }));
    await expect(service.login({ identifier: 'admin', password: 'WrongPass1!' }, {})).rejects.toMatchObject({
      statusCode: 401,
      message: INVALID_CREDENTIALS_MESSAGE,
    });
  });

  it('rejects inactive and locked users', async () => {
    db.user.findFirst.mockResolvedValueOnce(createUser({ status: UserStatus.INACTIVE }));
    await expect(service.login({ identifier: 'admin', password: 'StrongPass1!' }, {})).rejects.toMatchObject({
      statusCode: 403,
      message: 'Account is inactive',
    });

    db.user.findFirst.mockResolvedValueOnce(createUser({ status: UserStatus.LOCKED }));
    await expect(service.login({ identifier: 'admin', password: 'StrongPass1!' }, {})).rejects.toMatchObject({
      statusCode: 403,
      message: 'Account is locked',
    });
  });

  it('refreshes an active session and rotates the refresh token hash', async () => {
    const loginPasswordHash = await bcrypt.hash('StrongPass1!', 10);
    db.user.findFirst.mockResolvedValueOnce(createUser({ passwordHash: loginPasswordHash }));
    db.authSession.create.mockResolvedValueOnce({ id: 20 });
    db.authSession.update.mockResolvedValueOnce({ id: 20 });
    db.user.update.mockResolvedValueOnce(createUser({ passwordHash: loginPasswordHash }));
    db.auditLog.create.mockResolvedValueOnce({ id: 3 });

    const loginResult = await service.login({ identifier: 'admin', password: 'StrongPass1!' }, {});
    const originalRefreshToken = loginResult.tokens.refreshToken;

    db.authSession.findUnique.mockResolvedValueOnce({
      id: 20,
      userId: 1,
      refreshTokenHash: hashRefreshToken(originalRefreshToken),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: createUser({ passwordHash: loginPasswordHash }),
    });
    db.authSession.update.mockClear();
    db.authSession.update.mockResolvedValueOnce({ id: 20 });

    const refreshResult = await service.refresh(originalRefreshToken);
    const updateCall = db.authSession.update.mock.calls[0]?.[0];

    expect(refreshResult.tokens.refreshToken).not.toBe(originalRefreshToken);
    expect(updateCall.data.refreshTokenHash).toBe(hashRefreshToken(refreshResult.tokens.refreshToken));
  });

  it('rejects revoked sessions and mismatched refresh-token hashes', async () => {
    const passwordHash = await bcrypt.hash('StrongPass1!', 10);
    db.user.findFirst.mockResolvedValue(createUser({ passwordHash }));
    db.authSession.create.mockResolvedValue({ id: 30 });
    db.authSession.update.mockResolvedValue({ id: 30 });
    db.user.update.mockResolvedValue(createUser({ passwordHash }));
    db.auditLog.create.mockResolvedValue({ id: 4 });

    const loginResult = await service.login({ identifier: 'admin', password: 'StrongPass1!' }, {});

    db.authSession.findUnique.mockResolvedValueOnce({
      id: 30,
      userId: 1,
      refreshTokenHash: hashRefreshToken(loginResult.tokens.refreshToken),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
      user: createUser({ passwordHash }),
    });
    await expect(service.refresh(loginResult.tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });

    db.authSession.findUnique.mockResolvedValueOnce({
      id: 30,
      userId: 1,
      refreshTokenHash: hashRefreshToken('different-token'),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: createUser({ passwordHash }),
    });
    await expect(service.refresh(loginResult.tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('revokes logout sessions and succeeds when no token is available', async () => {
    const passwordHash = await bcrypt.hash('StrongPass1!', 10);
    db.user.findFirst.mockResolvedValueOnce(createUser({ passwordHash }));
    db.authSession.create.mockResolvedValueOnce({ id: 40 });
    db.authSession.update.mockResolvedValue({ id: 40 });
    db.user.update.mockResolvedValueOnce(createUser({ passwordHash }));
    db.auditLog.create.mockResolvedValue({ id: 5 });

    const loginResult = await service.login({ identifier: 'admin', password: 'StrongPass1!' }, {});
    const payload = verifyRefreshToken(loginResult.tokens.refreshToken);
    db.authSession.findUnique.mockResolvedValueOnce({ id: payload.sessionId, userId: 1 });

    await service.logout(loginResult.tokens.refreshToken, {});
    expect(db.authSession.update).toHaveBeenLastCalledWith({
      where: { id: payload.sessionId },
      data: { revokedAt: expect.any(Date) },
    });

    await expect(service.logout(undefined, {})).resolves.toBeUndefined();
  });

  it('returns a sanitised current user', async () => {
    const user = createUser();
    db.user.findUnique.mockResolvedValueOnce(user);

    await expect(service.getUser(1)).resolves.toEqual({
      id: 1,
      name: 'Admin Name',
      email: 'admin@example.com',
      username: 'admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
  });

  it('changes a password, revokes active sessions and writes an audit record', async () => {
    const passwordHash = await bcrypt.hash('StrongPass1!', 10);
    db.user.findUnique.mockResolvedValueOnce(createUser({ passwordHash }));
    db.user.update.mockResolvedValueOnce(createUser());
    db.authSession.updateMany.mockResolvedValueOnce({ count: 2 });
    db.auditLog.create.mockResolvedValueOnce({ id: 6 });

    await service.changePassword(
      1,
      {
        currentPassword: 'StrongPass1!',
        newPassword: 'NewStrongPass1!',
        confirmPassword: 'NewStrongPass1!',
      },
      {},
    );

    const updateCall = db.user.update.mock.calls[0]?.[0];
    expect(updateCall.data.passwordHash).not.toBe('NewStrongPass1!');
    expect(db.authSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 1,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: AuditAction.PASSWORD_CHANGE }),
    });
  });

  it('rejects invalid current password and same new password', async () => {
    const passwordHash = await bcrypt.hash('StrongPass1!', 10);
    db.user.findUnique.mockResolvedValue(createUser({ passwordHash }));

    await expect(
      service.changePassword(
        1,
        {
          currentPassword: 'WrongPass1!',
          newPassword: 'NewStrongPass1!',
          confirmPassword: 'NewStrongPass1!',
        },
        {},
      ),
    ).rejects.toMatchObject({ statusCode: 401 });

    await expect(
      service.changePassword(
        1,
        {
          currentPassword: 'StrongPass1!',
          newPassword: 'StrongPass1!',
          confirmPassword: 'StrongPass1!',
        },
        {},
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
