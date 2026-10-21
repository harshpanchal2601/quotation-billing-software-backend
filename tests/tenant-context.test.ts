import { AccountType, UserRole, UserStatus } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/database/prisma.js', () => ({
  prisma: {
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
