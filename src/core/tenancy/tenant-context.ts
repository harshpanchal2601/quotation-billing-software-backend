import { AccountType, AuditAction, FirmStatus } from '@prisma/client';
import type { Request, RequestHandler } from 'express';

import { prisma } from '../database/prisma.js';
import { AppError } from '../errors/AppError.js';
import { createAuditLog } from '../audit/audit-log.service.js';

export const SELECTED_FIRM_HEADER = 'x-firm-id';

function parseSelectedFirmId(value: string | string[] | undefined) {
  if (Array.isArray(value) || value === undefined || !/^\d+$/.test(value)) {
    throw new AppError('Select a firm before accessing firm data', 400);
  }

  const firmId = Number(value);
  if (!Number.isSafeInteger(firmId) || firmId <= 0) {
    throw new AppError('Select a valid firm before accessing firm data', 400);
  }

  return firmId;
}

async function recordPlatformFirmAccess(
  req: Request,
  selectedFirmId: number | null,
  decision: 'FIRM_CONTEXT_GRANTED' | 'INVALID_SELECTION' | 'FIRM_UNAVAILABLE',
) {
  const actor = req.user;
  if (actor === undefined) throw new AppError('Authentication required', 401);
  await createAuditLog(prisma, {
    metadata: { userId: actor.id, ipAddress: req.ip, userAgent: req.get('user-agent') },
    entityType: 'PlatformFirmAccess',
    entityId: selectedFirmId === null ? 'unresolved' : String(selectedFirmId),
    action: AuditAction.CREATE,
    policy: 'REQUIRED',
    newValues: {
      actorId: actor.id,
      sessionId: actor.sessionId,
      selectedFirmId,
      method: req.method,
      path: req.originalUrl.split('?')[0] ?? '/',
      decision,
    },
  });
}

export const requireFirmContext: RequestHandler = async (req, _res, next) => {
  try {
    if (req.user === undefined) {
      throw new AppError('Authentication required', 401);
    }

    let firmId = req.user.firmId;
    if (req.user.accountType === AccountType.SUPER_ADMIN) {
      try {
        firmId = parseSelectedFirmId(req.headers[SELECTED_FIRM_HEADER]);
      } catch (error) {
        await recordPlatformFirmAccess(req, null, 'INVALID_SELECTION');
        throw error;
      }
    }

    if (firmId === null) {
      throw new AppError('Your account is not assigned to a firm', 403);
    }

    const firm = await prisma.firm.findFirst({
      where: {
        id: firmId,
        status: FirmStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (firm === null) {
      if (req.user.accountType === AccountType.SUPER_ADMIN) {
        await recordPlatformFirmAccess(req, firmId, 'FIRM_UNAVAILABLE');
      }
      throw new AppError('Firm access is unavailable', 403);
    }

    if (req.user.accountType === AccountType.SUPER_ADMIN) {
      // Platform access is a separate scope from the selected firm's business audit.
      // Append before granting context; audit failure must deny the request.
      await recordPlatformFirmAccess(req, firm.id, 'FIRM_CONTEXT_GRANTED');
    }

    req.firmId = firm.id;
    next();
  } catch (error) {
    next(error);
  }
};

export function getFirmId(req: Request) {
  if (req.firmId === undefined) {
    throw new AppError('Firm context is required', 500);
  }

  return req.firmId;
}
