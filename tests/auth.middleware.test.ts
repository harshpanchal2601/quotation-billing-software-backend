import type { NextFunction, Request, Response } from 'express';
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

vi.mock('../src/config/database.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

const { requireAuthentication, requireRole } = await import('../src/middleware/authentication.js');
const { ACCESS_TOKEN_COOKIE_NAME } = await import('../src/modules/auth/auth.constants.js');
const { generateAccessToken } = await import('../src/modules/auth/auth.tokens.js');
const { prisma } = await import('../src/config/database.js');

function createUser(passwordChangedAt: Date | null = null) {
  return {
    id: 1,
    name: 'Admin Name',
    email: 'admin@example.com',
    username: 'admin',
    passwordHash: 'hash',
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    lastLoginAt: null,
    passwordChangedAt,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

function createNext() {
  return vi.fn() as NextFunction;
}

describe('requireAuthentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a missing access token', async () => {
    const req = { cookies: {} } as Request;
    const next = createNext();

    await requireAuthentication(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('loads the authenticated user without exposing passwordHash', async () => {
    const token = generateAccessToken({ userId: 1, role: UserRole.ADMIN, sessionId: 5 });
    const req = { cookies: { [ACCESS_TOKEN_COOKIE_NAME]: token } } as unknown as Request;
    const next = createNext();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(createUser());

    await requireAuthentication(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({
      id: 1,
      name: 'Admin Name',
      email: 'admin@example.com',
      username: 'admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      sessionId: 5,
    });
    expect(req.user).not.toHaveProperty('passwordHash');
  });

  it('rejects access tokens issued before passwordChangedAt', async () => {
    const token = generateAccessToken({ userId: 1, role: UserRole.ADMIN, sessionId: 5 });
    const req = { cookies: { [ACCESS_TOKEN_COOKIE_NAME]: token } } as unknown as Request;
    const next = createNext();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(
      createUser(new Date(Date.now() + 1_000)),
    );

    await requireAuthentication(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});

describe('requireRole', () => {
  it('rejects missing authenticated request state', () => {
    const next = createNext();

    requireRole(UserRole.ADMIN)({} as Request, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('allows an authenticated administrator', () => {
    const next = createNext();
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
    } as Request;

    requireRole(UserRole.ADMIN)(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });
});
