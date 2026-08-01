import bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import { UserRole, UserStatus } from '@prisma/client';
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

const authRepositoryMock = {
  findUserByIdentifier: vi.fn(),
  findUserById: vi.fn(),
  createSession: vi.fn(),
  updateSessionRefreshTokenHash: vi.fn(),
  updateLastLoginAt: vi.fn(),
  findSessionWithUserById: vi.fn(),
  revokeSession: vi.fn(),
  revokeActiveSessions: vi.fn(),
  updatePassword: vi.fn(),
  createAuditLog: vi.fn(),
};

vi.mock('../src/core/database/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../src/modules/auth/auth.repository.js', () => ({
  authRepository: authRepositoryMock,
}));

const { login, refresh, logout, me, changePassword, authRepository } = await import(
  '../src/modules/auth/auth.routes.js',
);
const { generateAccessToken, generateRefreshToken, hashRefreshToken } = await import(
  '../src/modules/auth/security/auth.tokens.js',
);
const { REFRESH_TOKEN_COOKIE_NAME, ACCESS_TOKEN_COOKIE_NAME } = await import(
  '../src/modules/auth/auth.constants.js',
);

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function createUser(overrides: Partial<{ passwordHash: string; status: UserStatus }> = {}) {
  return {
    id: 1,
    name: 'Admin Name',
    email: 'admin@example.com',
    username: 'admin',
    passwordHash: overrides.passwordHash ?? '$2b$10$placeholderplaceholderplaceholderplaceholderplaceholder',
    role: UserRole.ADMIN,
    status: overrides.status ?? UserStatus.ACTIVE,
    lastLoginAt: null,
    passwordChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };
}

describe('auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs in and sets the auth cookies', async () => {
    const passwordHash = await bcrypt.hash('StrongPass1!', 10);
    vi.mocked(authRepository.findUserByIdentifier).mockResolvedValueOnce(createUser({ passwordHash }) as never);
    vi.mocked(authRepository.createSession).mockResolvedValueOnce({ id: 12 } as never);
    vi.mocked(authRepository.updateSessionRefreshTokenHash).mockResolvedValueOnce({ id: 12 } as never);
    vi.mocked(authRepository.updateLastLoginAt).mockResolvedValueOnce(createUser() as never);
    vi.mocked(authRepository.createAuditLog).mockResolvedValueOnce({ id: 1 } as never);

    const req = {
      body: { identifier: ' Admin ', password: 'StrongPass1!' },
      ip: '127.0.0.1',
      get: vi.fn().mockReturnValue('vitest'),
    } as unknown as Request;
    const res = createRes();

    await login(req, res);

    expect(authRepository.findUserByIdentifier).toHaveBeenCalledWith('admin');
    expect(res.cookie).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/api/v1/auth' }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects invalid login credentials', async () => {
    vi.mocked(authRepository.findUserByIdentifier).mockResolvedValueOnce(null as never);

    const req = {
      body: { identifier: 'missing', password: 'WrongPass1!' },
      ip: '127.0.0.1',
      get: vi.fn().mockReturnValue('vitest'),
    } as unknown as Request;
    const res = createRes();

    await expect(login(req, res)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Invalid email, username or password',
    });
  });

  it('rejects inactive login attempts', async () => {
    vi.mocked(authRepository.findUserByIdentifier).mockResolvedValueOnce(
      createUser({ status: UserStatus.INACTIVE }) as never,
    );

    const req = {
      body: { identifier: 'admin', password: 'StrongPass1!' },
      ip: '127.0.0.1',
      get: vi.fn().mockReturnValue('vitest'),
    } as unknown as Request;
    const res = createRes();

    await expect(login(req, res)).rejects.toMatchObject({
      statusCode: 403,
      message: 'Account is inactive',
    });
  });

  it('refreshes a valid session and rotates the refresh token', async () => {
    const currentRefreshToken = generateRefreshToken({ userId: 1, sessionId: 77 });
    const currentAccessToken = generateAccessToken({ userId: 1, role: UserRole.ADMIN, sessionId: 77 });

    vi.mocked(authRepository.findSessionWithUserById).mockResolvedValueOnce({
      id: 77,
      userId: 1,
      refreshTokenHash: hashRefreshToken(currentRefreshToken),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: createUser({ passwordHash: await bcrypt.hash('StrongPass1!', 10) }),
    } as never);
    vi.mocked(authRepository.updateSessionRefreshTokenHash).mockResolvedValueOnce({ id: 77 } as never);

    const req = {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: currentRefreshToken, [ACCESS_TOKEN_COOKIE_NAME]: currentAccessToken },
    } as unknown as Request;
    const res = createRes();

    await refresh(req, res);

    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects refresh attempts with a mismatched token hash', async () => {
    const refreshToken = generateRefreshToken({ userId: 1, sessionId: 77 });

    vi.mocked(authRepository.findSessionWithUserById).mockResolvedValueOnce({
      id: 77,
      userId: 1,
      refreshTokenHash: hashRefreshToken('different-token'),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: createUser({ passwordHash: await bcrypt.hash('StrongPass1!', 10) }),
    } as never);

    const req = {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: refreshToken },
    } as unknown as Request;
    const res = createRes();

    await expect(refresh(req, res)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Authentication required',
    });
  });

  it('clears cookies on logout and keeps the response contract', async () => {
    const refreshToken = generateRefreshToken({ userId: 1, sessionId: 99 });
    vi.mocked(authRepository.findSessionWithUserById).mockResolvedValueOnce({
      id: 99,
      userId: 1,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: createUser(),
    } as never);
    vi.mocked(authRepository.revokeSession).mockResolvedValueOnce({ id: 99 } as never);
    vi.mocked(authRepository.createAuditLog).mockResolvedValueOnce({ id: 2 } as never);

    const req = {
      cookies: { [REFRESH_TOKEN_COOKIE_NAME]: refreshToken },
      ip: '127.0.0.1',
      get: vi.fn().mockReturnValue('vitest'),
    } as unknown as Request;
    const res = createRes();

    await logout(req, res);

    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns the authenticated user payload from req.user', async () => {
    const req = {
      user: {
        id: 1,
        name: 'Admin Name',
        email: 'admin@example.com',
        username: 'admin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        sessionId: 5,
      },
    } as unknown as Request;
    const res = createRes();

    await me(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Authenticated user retrieved',
      }),
    );
  });

  it('changes password and clears the auth cookies', async () => {
    const passwordHash = await bcrypt.hash('StrongPass1!', 10);
    vi.mocked(authRepository.findUserById).mockResolvedValueOnce(createUser({ passwordHash }) as never);
    vi.mocked(authRepository.updatePassword).mockResolvedValueOnce(createUser() as never);
    vi.mocked(authRepository.revokeActiveSessions).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(authRepository.createAuditLog).mockResolvedValueOnce({ id: 3 } as never);

    const req = {
      body: {
        currentPassword: 'StrongPass1!',
        newPassword: 'NewStrongPass1!',
        confirmPassword: 'NewStrongPass1!',
      },
      user: {
        id: 1,
        name: 'Admin Name',
        email: 'admin@example.com',
        username: 'admin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        sessionId: 5,
      },
      ip: '127.0.0.1',
      get: vi.fn().mockReturnValue('vitest'),
    } as unknown as Request;
    const res = createRes();

    await changePassword(req, res);

    expect(authRepository.revokeActiveSessions).toHaveBeenCalledWith(1);
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects an incorrect current password', async () => {
    const passwordHash = await bcrypt.hash('StrongPass1!', 10);
    vi.mocked(authRepository.findUserById).mockResolvedValueOnce(createUser({ passwordHash }) as never);

    const req = {
      body: {
        currentPassword: 'WrongPass1!',
        newPassword: 'NewStrongPass1!',
        confirmPassword: 'NewStrongPass1!',
      },
      user: {
        id: 1,
        name: 'Admin Name',
        email: 'admin@example.com',
        username: 'admin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        sessionId: 5,
      },
      ip: '127.0.0.1',
      get: vi.fn().mockReturnValue('vitest'),
    } as unknown as Request;
    const res = createRes();

    await expect(changePassword(req, res)).rejects.toMatchObject({
      statusCode: 401,
      message: 'Current password is incorrect',
    });
  });

  it('rejects reuse of the current password', async () => {
    const passwordHash = await bcrypt.hash('StrongPass1!', 10);
    vi.mocked(authRepository.findUserById).mockResolvedValueOnce(createUser({ passwordHash }) as never);

    const req = {
      body: {
        currentPassword: 'StrongPass1!',
        newPassword: 'StrongPass1!',
        confirmPassword: 'StrongPass1!',
      },
      user: {
        id: 1,
        name: 'Admin Name',
        email: 'admin@example.com',
        username: 'admin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        sessionId: 5,
      },
      ip: '127.0.0.1',
      get: vi.fn().mockReturnValue('vitest'),
    } as unknown as Request;
    const res = createRes();

    await expect(changePassword(req, res)).rejects.toMatchObject({
      statusCode: 400,
      message: 'New password must be different from the current password',
    });
  });
});