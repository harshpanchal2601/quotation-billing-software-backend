import type { AuditAction, Prisma, PrismaClient } from '@prisma/client';

export type RequestMetadata = {
  userId?: number;
  ipAddress?: string;
  userAgent?: string;
};

export async function createAuditLog(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    metadata: RequestMetadata;
    entityType: string;
    entityId: string;
    action: AuditAction;
    oldValues?: Prisma.InputJsonObject;
    newValues?: Prisma.InputJsonObject;
  },
) {
  try {
    await db.auditLog.create({
      data: {
        userId: input.metadata.userId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        oldValues: input.oldValues as Prisma.InputJsonValue | undefined,
        newValues: input.newValues as Prisma.InputJsonValue | undefined,
        ipAddress: input.metadata.ipAddress,
        userAgent: input.metadata.userAgent,
      },
    });
  } catch (error) {
    console.warn(`${input.entityType} audit log could not be created.`);
    console.warn(error instanceof Error ? error.message : 'Unknown audit error');
  }
}

export function pickChangedFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
  fields: Array<keyof T>,
) {
  const oldValues: Record<string, Prisma.InputJsonValue | null> = {};
  const newValues: Record<string, Prisma.InputJsonValue | null> = {};

  for (const field of fields) {
    if (before[field] !== after[field]) {
      oldValues[String(field)] = normaliseJsonValue(before[field]);
      newValues[String(field)] = normaliseJsonValue(after[field]);
    }
  }

  return { oldValues, newValues };
}

function normaliseJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'object' && 'toString' in value) return String(value);
  return String(value);
}
