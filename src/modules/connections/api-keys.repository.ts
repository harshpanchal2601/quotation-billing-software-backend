import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AuditAction, type Prisma, type PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { apiScopeSchema, type ApiScope, type keyCreateSchema } from './connections.schema.js';

const summary = { id: true, name: true, scopes: true, expiresAt: true, revokedAt: true, createdAt: true } as const;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export class ApiKeysRepository {
  constructor(private readonly db: PrismaClient) {}
  private async access(tx: Prisma.TransactionClient, firmId: number, actorId: number) {
    await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.API_KEYS_MANAGE);
    await assertTransactionFeature(tx, firmId, 'integrations.api');
  }
  private async issue(tx: Prisma.TransactionClient, firmId: number, actorId: number, input: z.infer<typeof keyCreateSchema>, metadata: RequestMetadata) {
    for (const scope of input.scopes) {
      await authorizeFirmJobActor(tx, firmId, actorId, scope === 'reports.export' ? PERMISSIONS.REPORTS_EXPORT : PERMISSIONS.REPORTS_VIEW);
      await assertTransactionFeature(tx, firmId, scope === 'reports.export' ? 'reports.exports' : 'reports');
    }
    if (await tx.apiKey.count({ where: { firmId, actorId, revokedAt: null, expiresAt: { gt: new Date() } } }) >= 100) throw new AppError('Active API key capacity reached', 409);
    const token = `bnx_${randomBytes(32).toString('hex')}`;
    const key = await tx.apiKey.create({ data: { id: randomUUID(), firmId, actorId, name: input.name, scopes: input.scopes, tokenHash: hash(token), expiresAt: new Date(Date.now() + input.lifetimeDays * 86_400_000) }, select: summary });
    await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'ApiKey', entityId: key.id, action: AuditAction.CREATE, policy: 'REQUIRED', newValues: { scopes: input.scopes, expiresAt: key.expiresAt.toISOString() } });
    return { key, token };
  }
  async create(firmId: number, actorId: number, input: z.infer<typeof keyCreateSchema>, metadata: RequestMetadata, replacing?: string) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId);
      if (replacing) await this.revokeInTransaction(tx, firmId, actorId, replacing, metadata);
      return this.issue(tx, firmId, actorId, input, metadata);
    });
  }
  async list(firmId: number, actorId: number, page: number, limit: number) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId);
      const where = { firmId, actorId };
      const [keys, total] = await Promise.all([tx.apiKey.findMany({ where, select: summary, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }), tx.apiKey.count({ where })]);
      return { keys, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
  }
  private async revokeInTransaction(tx: Prisma.TransactionClient, firmId: number, actorId: number, id: string, metadata: RequestMetadata) {
    const key = await tx.apiKey.findFirst({ where: { id, firmId, actorId } });
    if (!key) throw new AppError('API key not found', 404);
    if (key.revokedAt) return;
    await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'ApiKey', entityId: id, action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: { revoked: true } });
  }
  async revoke(firmId: number, actorId: number, id: string, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => { await this.access(tx, firmId, actorId); await this.revokeInTransaction(tx, firmId, actorId, id, metadata); });
  }
  async authenticate(token: string | undefined, scope: ApiScope) {
    if (!token || !/^bnx_[a-f0-9]{64}$/.test(token)) throw new AppError('API credential is unavailable', 401);
    return this.db.$transaction(async (tx) => {
      const key = await tx.apiKey.findUnique({ where: { tokenHash: hash(token) } });
      if (!key || key.revokedAt || key.expiresAt.getTime() <= Date.now()) throw new AppError('API credential is unavailable', 401);
      const scopes = apiScopeSchema.array().safeParse(key.scopes);
      if (!scopes.success || !scopes.data.includes(scope)) throw new AppError('API scope is unavailable', 403);
      await this.access(tx, key.firmId, key.actorId);
      await authorizeFirmJobActor(tx, key.firmId, key.actorId, scope === 'reports.export' ? PERMISSIONS.REPORTS_EXPORT : PERMISSIONS.REPORTS_VIEW);
      await assertTransactionFeature(tx, key.firmId, scope === 'reports.export' ? 'reports.exports' : 'reports');
      return { id: key.id, firmId: key.firmId, actorId: key.actorId };
    });
  }
}
export const apiKeysRepository = new ApiKeysRepository(prisma);
