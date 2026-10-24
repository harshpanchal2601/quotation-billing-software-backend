import { AccountType, UserRole, UserStatus } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/database/prisma.js', () => ({
  prisma: {
    auditLog: { create: vi.fn() },
    firm: {
      findFirst: vi.fn(),
    },
  },
}));

const { requireFirmContext, SELECTED_FIRM_HEADER } = await import(
  '../src/core/tenancy/tenant-context.js'
);
const { prisma } = await import('../src/core/database/prisma.js');

function createRequest(accountType: AccountType, firmId: number | null, selectedFirmId?: string) {
  return {
    method: 'GET',
    originalUrl: '/api/v1/companies?search=private',
    ip: '127.0.0.1',
    get: vi.fn().mockReturnValue('vitest'),
    headers: selectedFirmId === undefined ? {} : { [SELECTED_FIRM_HEADER]: selectedFirmId },
    user: {
      id: 1,
      name: 'Access User',
      email: 'user@example.com',
      username: 'access.user',
      role: UserRole.ADMIN,
      accountType,
      status: UserStatus.ACTIVE,
      firmId,
      firm: firmId === null ? null : { id: firmId, name: 'Assigned Firm', slug: 'assigned-firm' },
      firmRole: null,
      permissions: [],
      mustChangePassword: false,
      sessionId: 1,
    },
  } as unknown as Request;
}

function createNext() {
  return vi.fn() as NextFunction;
}

describe('requireFirmContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the assigned firm for firm users and ignores a forged selection header', async () => {
    const request = createRequest(AccountType.FIRM_USER, 7, '99');
    const next = createNext();
    vi.mocked(prisma.firm.findFirst).mockResolvedValueOnce({ id: 7 } as never);

    await requireFirmContext(request, {} as Response, next);

    expect(prisma.firm.findFirst).toHaveBeenCalledWith({
      where: { id: 7, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    expect(request.firmId).toBe(7);
    expect(next).toHaveBeenCalledWith();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('requires super administrators to explicitly select a firm', async () => {
    const request = createRequest(AccountType.SUPER_ADMIN, null);
    const next = createNext();

    await requireFirmContext(request, {} as Response, next);

    expect(prisma.firm.findFirst).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('resolves an active selected firm for a super administrator', async () => {
    const request = createRequest(AccountType.SUPER_ADMIN, null, '11');
    const next = createNext();
    vi.mocked(prisma.firm.findFirst).mockResolvedValueOnce({ id: 11 } as never);

    await requireFirmContext(request, {} as Response, next);

    expect(request.firmId).toBe(11);
    expect(next).toHaveBeenCalledWith();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firmId: undefined,
        userId: 1,
        entityType: 'PlatformFirmAccess',
        entityId: '11',
        newValues: {
          actorId: 1, sessionId: 1, selectedFirmId: 11,
          method: 'GET', path: '/api/v1/companies', decision: 'FIRM_CONTEXT_GRANTED',
        },
      }),
    });
  });

  it.each(['', '0', '-1', '1.5', 'abc', '9007199254740992'])('rejects malformed selection %s', async (value) => {
    const request = createRequest(AccountType.SUPER_ADMIN, null, value);
    const next = createNext();
    await requireFirmContext(request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(prisma.firm.findFirst).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ newValues: expect.objectContaining({
        selectedFirmId: null, decision: 'INVALID_SELECTION',
      }) }),
    });
  });

  it('records denied support access to an unavailable firm without granting context', async () => {
    const request = createRequest(AccountType.SUPER_ADMIN, null, '11');
    const next = createNext();
    vi.mocked(prisma.firm.findFirst).mockResolvedValueOnce(null);
    await requireFirmContext(request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(request.firmId).toBeUndefined();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ newValues: expect.objectContaining({
        selectedFirmId: 11, decision: 'FIRM_UNAVAILABLE',
      }) }),
    });
  });

  it('denies platform firm access when its required audit cannot be persisted', async () => {
    const request = createRequest(AccountType.SUPER_ADMIN, null, '11');
    const next = createNext();
    const failure = new Error('audit unavailable');
    vi.mocked(prisma.firm.findFirst).mockResolvedValueOnce({ id: 11 } as never);
    vi.mocked(prisma.auditLog.create).mockRejectedValueOnce(failure);
    await requireFirmContext(request, {} as Response, next);
    expect(request.firmId).toBeUndefined();
    expect(next).toHaveBeenCalledWith(failure);
  });

  it('rejects a missing, deleted, or suspended firm', async () => {
    const request = createRequest(AccountType.FIRM_ADMIN, 7);
    const next = createNext();
    vi.mocked(prisma.firm.findFirst).mockResolvedValueOnce(null);

    await requireFirmContext(request, {} as Response, next);

    expect(request.firmId).toBeUndefined();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
