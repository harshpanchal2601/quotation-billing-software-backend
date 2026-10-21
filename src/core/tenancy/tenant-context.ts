import { AccountType, FirmStatus } from '@prisma/client';
import type { Request, RequestHandler } from 'express';

import { prisma } from '../database/prisma.js';
import { AppError } from '../errors/AppError.js';

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

export const requireFirmContext: RequestHandler = async (req, _res, next) => {
  try {
    if (req.user === undefined) {
      throw new AppError('Authentication required', 401);
    }

    const firmId = req.user.accountType === AccountType.SUPER_ADMIN
      ? parseSelectedFirmId(req.headers[SELECTED_FIRM_HEADER])
      : req.user.firmId;

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
      throw new AppError('Firm access is unavailable', 403);
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
