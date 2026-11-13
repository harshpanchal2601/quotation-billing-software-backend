import type { NextFunction, Request, Response } from 'express';
import { AccountType, FirmStatus, UserRole, UserStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.PORT = '5000';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/buminex_quotation';
process.env.JWT_ACCESS_SECRET = 'access-secret';
process.env.JWT_REFRESH_SECRET = 'refresh-secret';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

vi.mock('../src/core/database/prisma.js', () => ({
  prisma: {
    authSession: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../src/modules/entitlements/index.js', () => ({ assertFeatureEntitlements: vi.fn() }));

const { requireAuthentication, requirePermission, requireRole } = await import('../src/modules/auth/auth.middleware.js');
const { assertFeatureEntitlements } = await import('../src/modules/entitlements/index.js');
const { ACCESS_TOKEN_COOKIE_NAME } = await import('../src/modules/auth/auth.constants.js');
const { generateAccessToken } = await import('../src/modules/auth/security/auth.tokens.js');
const { prisma } = await import('../src/core/database/prisma.js');

function createUser(passwordChangedAt: Date | null = null) {
  return {
    id: 1,
    name: 'Admin Name',
    email: 'admin@example.com',
    username: 'admin',
    passwordHash: 'hash',
    role: UserRole.ADMIN,
    accountType: AccountType.FIRM_ADMIN,
    firmId: 1,
    firmRoleId: null,
    status: UserStatus.ACTIVE,
    mustChangePassword: false,
    lastLoginAt: null,
    passwordChangedAt,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    firm: {
      id: 1,
      name: 'Example Firm',
      slug: 'example-firm',
      status: FirmStatus.ACTIVE,
      userLimit: 4,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    },
    firmRole: null,
  };
}

function createNext() {
  return vi.fn() as NextFunction;
}

function createSession(user = createUser()) {
  return {
    id: 5,
    userId: user.id,
    refreshTokenHash: 'hash',
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    user,
  };
}

describe('permission and entitlement composition', () => {
  beforeEach(() => vi.clearAllMocks());
  const request = (permissions: string[]) => ({ firmId: 1, user: { id: 1, permissions, mustChangePassword: false } }) as unknown as Request;

  it('denies an authorized role when the subscription denies the action', async () => {
    vi.mocked(assertFeatureEntitlements).mockRejectedValueOnce(new Error('plan denied'));
    const next = createNext();
    await requirePermission('items.view')(request(['items.view']), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'plan denied' }));
  });

  it('denies missing RBAC independently and does not evaluate unrelated grants', async () => {
    const next = createNext();
    await requirePermission('items.view')(request(['companies.view']), {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(assertFeatureEntitlements).not.toHaveBeenCalled();
  });

  it('passes only RBAC-authorized alternatives into entitlement evaluation', async () => {
    vi.mocked(assertFeatureEntitlements).mockResolvedValueOnce(undefined);
    const next = createNext();
    await requirePermission('items.view', 'companies.view')(request(['items.view']), {} as Response, next);
    expect(assertFeatureEntitlements).toHaveBeenCalledWith(1, ['items.view']);
    expect(next).toHaveBeenCalledWith();
  });
});

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
    vi.mocked(prisma.authSession.findUnique).mockResolvedValueOnce(createSession());

    await requireAuthentication(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toEqual({
      id: 1,
      name: 'Admin Name',
      email: 'admin@example.com',
      username: 'admin',
      role: 'ADMIN',
      accountType: 'FIRM_ADMIN',
      status: 'ACTIVE',
      firmId: 1,
      firm: { id: 1, name: 'Example Firm', slug: 'example-firm' },
      firmRole: null,
      permissions: expect.any(Array),
      mustChangePassword: false,
      sessionId: 5,
    });
    expect(req.user).not.toHaveProperty('passwordHash');
    expect(prisma.authSession.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      include: { user: { include: { firm: true, firmRole: true } } },
    });
  });

  it('rejects access tokens issued before passwordChangedAt', async () => {
    const token = generateAccessToken({ userId: 1, role: UserRole.ADMIN, sessionId: 5 });
    const req = { cookies: { [ACCESS_TOKEN_COOKIE_NAME]: token } } as unknown as Request;
    const next = createNext();
    vi.mocked(prisma.authSession.findUnique).mockResolvedValueOnce(
      createSession(createUser(new Date(Date.now() + 1_000))),
    );

    await requireAuthentication(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it.each([
    ['missing', () => null],
    ['revoked', () => ({ ...createSession(), revokedAt: new Date() })],
    ['expired', () => ({ ...createSession(), expiresAt: new Date(0) })],
    ['owned by another user', () => ({ ...createSession(), userId: 2 })],
  ])('rejects a %s session even with a valid access token', async (_label, session) => {
    const token = generateAccessToken({ userId: 1, role: UserRole.ADMIN, sessionId: 5 });
    const req = { cookies: { [ACCESS_TOKEN_COOKIE_NAME]: token } } as unknown as Request;
    const next = createNext();
    vi.mocked(prisma.authSession.findUnique).mockResolvedValueOnce(session() as never);

    await requireAuthentication(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(req.user).toBeUndefined();
  });

  it.each([
    ['locked user', { status: UserStatus.LOCKED }, 403],
    ['inactive user', { status: UserStatus.INACTIVE }, 403],
    ['deleted user', { deletedAt: new Date() }, 401],
    ['suspended firm', { firm: { ...createUser().firm, status: FirmStatus.SUSPENDED } }, 403],
    ['deleted firm', { firm: { ...createUser().firm, deletedAt: new Date() } }, 403],
    ['missing firm', { firm: null }, 403],
    ['missing role', { accountType: AccountType.FIRM_USER }, 403],
    ['foreign role', {
      accountType: AccountType.FIRM_USER,
      firmRole: { id: 9, firmId: 2, deletedAt: null, permissions: ['quotations.view'] },
    }, 403],
    ['deleted role', {
      accountType: AccountType.FIRM_USER,
      firmRole: { id: 9, firmId: 1, deletedAt: new Date(), permissions: ['quotations.view'] },
    }, 403],
  ])('rejects a %s on an authenticated request', async (_label, overrides, statusCode) => {
    const token = generateAccessToken({ userId: 1, role: UserRole.ADMIN, sessionId: 5 });
    const req = { cookies: { [ACCESS_TOKEN_COOKIE_NAME]: token } } as unknown as Request;
    const next = createNext();
    vi.mocked(prisma.authSession.findUnique).mockResolvedValueOnce({
      ...createSession(), user: { ...createUser(), ...overrides },
    } as never);

    await requireAuthentication(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode }));
    expect(req.user).toBeUndefined();
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
        accountType: AccountType.FIRM_ADMIN,
        status: UserStatus.ACTIVE,
        firmId: 1,
        firm: { id: 1, name: 'Example Firm', slug: 'example-firm' },
        firmRole: null,
        permissions: [],
        mustChangePassword: false,
        sessionId: 5,
      },
    } as Request;

    requireRole(UserRole.ADMIN)(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
  });
});
