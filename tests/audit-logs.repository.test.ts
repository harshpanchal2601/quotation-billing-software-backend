import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { AuditLogsRepository } from '../src/modules/audit-logs/audit-logs.repository.js';
import { auditLogListSchema } from '../src/modules/audit-logs/audit-logs.schema.js';

vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));

describe('tenant audit listing', () => {
  it('uses the same firm and filters for count and pagination and redacts foreign actors', async () => {
    const db = {
      auditLog: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1, firmId: 7, user: { id: 10, firmId: 7, name: 'Local', email: 'local@example.invalid' } },
          { id: 2, firmId: 7, user: { id: 20, firmId: 8, name: 'Foreign', email: 'foreign@example.invalid' } },
          { id: 3, firmId: 7, user: { id: 30, firmId: null, name: 'Platform', email: 'platform@example.invalid' } },
          { id: 4, firmId: 7, user: null },
        ]),
        count: vi.fn().mockResolvedValue(4),
      },
      $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    const query = auditLogListSchema.parse({ page: 2, limit: 2, action: 'UPDATE', entityType: 'Company',
      userId: 10, dateFrom: '2026-10-01', dateTo: '2026-10-22' });
    const result = await new AuditLogsRepository(db as unknown as PrismaClient).list(7, query);
    const where = { firmId: 7, action: 'UPDATE', entityType: 'Company', userId: 10,
      createdAt: { gte: query.dateFrom, lte: query.dateTo } };
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 2, take: 2 }));
    expect(db.auditLog.count).toHaveBeenCalledWith({ where });
    expect(result.auditLogs.map((entry) => entry.user)).toEqual([
      { id: 10, name: 'Local', email: 'local@example.invalid' }, null, null, null,
    ]);
    expect(result.pagination).toEqual({ page: 2, limit: 2, total: 4, totalPages: 2 });
  });
});
