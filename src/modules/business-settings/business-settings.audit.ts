import type { AuditAction, Prisma, PrismaClient } from '@prisma/client';

import {
  createAuditLog,
  pickChangedFields,
  type RequestMetadata,
} from '../../utils/auditLog.js';

export { pickChangedFields, type RequestMetadata };

export async function createSettingsAuditLog(
  db: PrismaClient,
  input: {
    metadata: RequestMetadata;
    entityType: string;
    entityId: string;
    action: AuditAction;
    oldValues?: Prisma.InputJsonObject;
    newValues?: Prisma.InputJsonObject;
  },
) {
  await createAuditLog(db, input);
}
