import type { ListSort } from '../../core/validation/list-sort.js';
import { auditLogsRepository } from './audit-logs.repository.js';
import { auditLogListSchema } from './audit-logs.schema.js';

// The assistant receives event metadata, not stored audit payloads.

export async function readAssistantAudit(firmId: number, page: number, sorting: ListSort<'id'> = {}) {
  const result = await auditLogsRepository.list(firmId, auditLogListSchema.parse({ page, limit: 20, sortBy: sorting.sortBy, sortOrder: sorting.sortOrder }));
  // Audit values can contain credentials or PII. Only event metadata is exposed.
  return { records: result.auditLogs.map((row) => ({ id: row.id, label: `${row.entityType} ${row.entityId}`, action: row.action, createdAt: row.createdAt.toISOString(), href: '/audit-logs' })), pagination: result.pagination };
}
