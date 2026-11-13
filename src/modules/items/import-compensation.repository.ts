import { AuditAction, type Prisma } from '@prisma/client';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { jsonObject } from '../../core/serialization/json.js';

export async function compensateImportedItem(tx: Prisma.TransactionClient, firmId: number, id: number, updatedAt: Date, fingerprint: string, metadata: RequestMetadata) {
  await tx.$queryRaw`SELECT id FROM items WHERE id = ${id} AND firm_id = ${firmId} FOR UPDATE`;
  const current = await tx.item.findFirst({ where: { id, firmId, deletedAt: null } });
  if (!current || requestHash(jsonObject(current)) !== fingerprint) throw new AppError('Imported item changed; review it manually before compensation', 409);
  const result = await tx.item.updateMany({ where: { id, firmId, updatedAt, deletedAt: null, stockTracking: false, sourceType: 'CSV_IMPORT' }, data: { isActive: false, updatedById: metadata.userId } });
  if (result.count !== 1) throw new AppError('Imported item changed; review it manually before compensation', 409);
  await createAuditLog(tx, { metadata: { ...metadata, firmId }, entityType: 'Item', entityId: String(id), action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: { isActive: false, reason: 'IMPORT_COMPENSATION' } });
}
