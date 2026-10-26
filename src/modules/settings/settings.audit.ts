import type { AuditAction, Prisma, PrismaClient } from '@prisma/client';

import {
  createAuditLog,
  pickChangedFields,
  type RequestMetadata,
} from '../../core/audit/audit-log.service.js';

export { pickChangedFields, type RequestMetadata };

export async function createSettingsAuditLog(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    metadata: RequestMetadata;
    entityType: string;
    entityId: string;
    action: AuditAction;
    policy?: 'REQUIRED' | 'BEST_EFFORT';
    oldValues?: Prisma.InputJsonObject;
    newValues?: Prisma.InputJsonObject;
  },
) {
  await createAuditLog(db, input);
}
