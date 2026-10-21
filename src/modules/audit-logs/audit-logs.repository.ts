import type { Prisma, PrismaClient } from '@prisma/client';

import { prisma } from '../../core/database/prisma.js';
import type { AuditLogListQuery } from './audit-logs.schema.js';

export class AuditLogsRepository {
  constructor(private readonly db: PrismaClient) {}

  async list(firmId: number, query: AuditLogListQuery) {
    const where: Prisma.AuditLogWhereInput = {
      firmId,
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
      ...(query.userId === undefined ? {} : { userId: query.userId }),
      ...(query.dateFrom === undefined && query.dateTo === undefined
        ? {}
        : {
            createdAt: {
              ...(query.dateFrom === undefined ? {} : { gte: query.dateFrom }),
              ...(query.dateTo === undefined ? {} : { lte: query.dateTo }),
            },
          }),
    };
    const [auditLogs, total] = await this.db.$transaction([
      this.db.auditLog.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.auditLog.count({ where }),
    ]);
    return {
      auditLogs,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}

export const auditLogsRepository = new AuditLogsRepository(prisma);
