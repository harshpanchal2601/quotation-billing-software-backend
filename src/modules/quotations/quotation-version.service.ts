import type { Prisma, PrismaClient } from '@prisma/client';

export async function createQuotationVersion(
  db: PrismaClient | Prisma.TransactionClient,
  quotationId: number,
  snapshotData: unknown,
  createdById: number,
): Promise<number> {
  const versionCount = await db.quotationVersion.count({
    where: { quotationId },
  });

  const nextVersionNumber = versionCount + 1;

  await db.quotationVersion.create({
    data: {
      quotationId,
      versionNumber: nextVersionNumber,
      snapshot: snapshotData as Prisma.InputJsonValue,
      createdById,
    },
  });

  return nextVersionNumber;
}
