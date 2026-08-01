import type { Prisma, PrismaClient } from '@prisma/client';

import { AppError } from '../../core/errors/AppError.js';

const ITEM_CODE_PREFIX = 'ITEM-';

export async function generateNextItemCode(db: PrismaClient | Prisma.TransactionClient): Promise<string> {
  const latestItem = await db.item.findFirst({
    select: { itemCode: true },
    orderBy: { id: 'desc' },
  });

  let maxNum = 0;

  if (latestItem !== null) {
    const match = latestItem.itemCode.match(/^ITEM-(\d+)$/);
    if (match && match[1]) {
      maxNum = parseInt(match[1], 10);
    }
  }

  const allItems = await db.item.findMany({
    select: { itemCode: true },
    take: 1000,
    orderBy: { id: 'desc' },
  });

  for (const item of allItems) {
    const match = item.itemCode.match(/^ITEM-(\d+)$/);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) {
        maxNum = num;
      }
    }
  }

  const nextNum = maxNum + 1;
  return `${ITEM_CODE_PREFIX}${String(nextNum).padStart(6, '0')}`;
}

export async function generateUniqueItemCodeWithRetry(
  db: PrismaClient,
): Promise<string> {
  const maxAttempts = 5;
  let currentNum: number | null = null;

  for (let i = 0; i < maxAttempts; i++) {
    let candidate: string;

    if (currentNum === null) {
      candidate = await generateNextItemCode(db);
      const match = candidate.match(/^ITEM-(\d+)$/);
      currentNum = match && match[1] ? parseInt(match[1], 10) : 1;
    } else {
      currentNum += 1;
      candidate = `${ITEM_CODE_PREFIX}${String(currentNum).padStart(6, '0')}`;
    }

    const existing = await db.item.findFirst({
      where: { itemCode: candidate },
      select: { id: true },
    });

    if (!existing) {
      return candidate;
    }
  }

  throw new AppError('Unable to generate a unique item code due to high concurrency. Please retry.', 409);
}
