import { randomUUID } from 'node:crypto';
import { AuditAction, Prisma, type OutboxEvent, type PrismaClient } from '@prisma/client';

import { createAuditLog } from '../audit/audit-log.service.js';
import { AppError } from '../errors/AppError.js';
import type { JobRegistry } from './outbox.types.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new AppError('Invalid outbox payload', 400);
  return encoded;
}

export async function enqueueOutbox(tx: Prisma.TransactionClient, input: {
  firmId: number; actorId: number; kind: string; sourceEventId: string; idempotencyKey: string;
  payload: Prisma.InputJsonObject; maxAttempts?: number;
}) {
  if (![input.firmId, input.actorId].every((id) => Number.isSafeInteger(id) && id > 0) ||
      !/^[a-z][a-z0-9.-]{0,99}$/.test(input.kind) || !input.sourceEventId.trim() || input.sourceEventId.length > 191 ||
      !input.idempotencyKey.trim() || input.idempotencyKey.length > 191 ||
      !Number.isInteger(input.maxAttempts ?? 5) || (input.maxAttempts ?? 5) < 1 || (input.maxAttempts ?? 5) > 20 ||
      Buffer.byteLength(canonical(input.payload)) > 64 * 1024) throw new AppError('Invalid outbox envelope', 400);
  const where = { firmId_idempotencyKey: { firmId: input.firmId, idempotencyKey: input.idempotencyKey } };
  // Caller holds its firm's lock and commits the originating business write here.
  const existing = await tx.outboxEvent.findUnique({ where });
  if (existing !== null) {
    if (existing.kind !== input.kind || existing.actorId !== input.actorId || existing.sourceEventId !== input.sourceEventId || canonical(existing.payload) !== canonical(input.payload)) throw new AppError('Outbox idempotency conflict', 409);
    return existing;
  }
  const event = await tx.outboxEvent.create({ data: { ...input, id: randomUUID() } });
  await audit(tx, event, 'ENQUEUED');
  return event;
}

async function audit(tx: Prisma.TransactionClient, event: OutboxEvent, decision: string) {
  await createAuditLog(tx, {
    metadata: { firmId: event.firmId, userId: event.actorId }, entityType: 'OutboxEvent', entityId: event.id,
    action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: { decision, kind: event.kind, sourceEventId: event.sourceEventId, attempt: event.attempts },
  });
}

export class OutboxRepository {
  constructor(private readonly db: PrismaClient, private readonly registry: JobRegistry, private readonly leaseMs = 60_000) {}

  async runOne(workerId: string, now = new Date()): Promise<boolean> {
    if (!/^[a-zA-Z0-9:._-]{1,100}$/.test(workerId) || this.leaseMs < 1000 || !Number.isFinite(now.getTime())) throw new Error('Invalid worker configuration');
    const event = await this.claim(workerId, now);
    if (event === null) return false;
    const handler = Object.hasOwn(this.registry, event.kind) ? this.registry[event.kind] : undefined;
    let effectStarted = false;
    try {
      if (handler === undefined) throw new AppError('Unknown job kind', 400, { code: 'UNKNOWN_KIND' });
      await this.db.$transaction(async (tx) => {
        // Hold the lease row through execution. A claimant cannot reclaim an
        // expired lease while its owner still holds this transaction's lock.
        const locked = await tx.outboxEvent.updateMany({
          where: { id: event.id, status: 'PROCESSING', lockToken: event.lockToken },
          data: { lockedUntil: new Date(Date.now() + this.leaseMs) },
        });
        if (locked.count !== 1) throw new AppError('Job lease lost', 409, { code: 'LEASE_LOST' });
        await tx.$queryRaw`SELECT id FROM firms WHERE id = ${event.firmId} FOR UPDATE`;
        // Identity, entitlements, quota and resource ownership are revalidated
        // by the owning module, using durable columns, not payload path names.
        await handler.authorize(tx, event);
        effectStarted = true;
        await handler.execute(tx, event);
        await tx.outboxEvent.update({ where: { id: event.id }, data: { status: 'SUCCEEDED', completedAt: new Date(), lockToken: null, lockedUntil: null } });
        await tx.jobAttempt.update({ where: { eventId_attempt: { eventId: event.id, attempt: event.attempts } }, data: { finishedAt: new Date(), outcome: 'SUCCEEDED' } });
        await audit(tx, event, 'SUCCEEDED');
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 });
    } catch (error) {
      // Never store exception messages: providers may embed credentials or PII.
      const terminal = error instanceof AppError && [400, 401, 403, 404].includes(error.statusCode);
      const code = error instanceof AppError ? `HTTP_${error.statusCode}` : 'EXECUTION_FAILED';
      const status = handler?.retry === 'RECONCILE' && effectStarted ? 'RECONCILE' : terminal || handler === undefined || event.attempts >= event.maxAttempts ? 'DEAD' : 'PENDING';
      await this.db.$transaction(async (tx) => {
        const settled = await tx.outboxEvent.updateMany({
          where: { id: event.id, status: 'PROCESSING', lockToken: event.lockToken },
          data: { status, lockToken: null, lockedUntil: null, availableAt: new Date(Date.now() + Math.min(3600_000, 1000 * 2 ** (event.attempts - 1))) },
        });
        if (settled.count === 0) return;
        await tx.jobAttempt.update({ where: { eventId_attempt: { eventId: event.id, attempt: event.attempts } }, data: { finishedAt: new Date(), outcome: status, errorCode: code } });
        await audit(tx, event, status);
      });
    }
    return true;
  }

  private async claim(workerId: string, now: Date) {
    return this.db.$transaction(async (tx) => {
      const eligible = { OR: [{ status: 'PENDING' as const, availableAt: { lte: now } }, { status: 'PROCESSING' as const, lockedUntil: { lte: now } }] };
      const candidate = await tx.outboxEvent.findFirst({ where: eligible, orderBy: [{ availableAt: 'asc' }, { id: 'asc' }] });
      if (candidate === null) return null;
      const lockToken = randomUUID();
      const claimed = await tx.outboxEvent.updateMany({ where: { id: candidate.id, ...eligible, attempts: candidate.attempts }, data: { status: 'PROCESSING', lockToken, lockedUntil: new Date(now.getTime() + this.leaseMs), attempts: { increment: 1 } } });
      if (claimed.count !== 1) return null;
      if (candidate.status === 'PROCESSING') {
        await tx.jobAttempt.updateMany({ where: { eventId: candidate.id, finishedAt: null }, data: { finishedAt: now, outcome: 'LEASE_EXPIRED', errorCode: 'WORKER_LOST' } });
      }
      const event = { ...candidate, status: 'PROCESSING' as const, lockToken, attempts: candidate.attempts + 1 };
      await tx.jobAttempt.create({ data: { eventId: event.id, attempt: event.attempts, workerId, startedAt: now } });
      const registered = Object.hasOwn(this.registry, event.kind) ? this.registry[event.kind] : undefined;
      const unsafeRecovery = candidate.status === 'PROCESSING' && registered?.retry === 'RECONCILE';
      if (unsafeRecovery || event.attempts > event.maxAttempts) {
        const status = unsafeRecovery ? 'RECONCILE' : 'DEAD';
        await tx.outboxEvent.update({ where: { id: event.id }, data: { status, lockToken: null, lockedUntil: null } });
        await tx.jobAttempt.update({ where: { eventId_attempt: { eventId: event.id, attempt: event.attempts } }, data: { finishedAt: now, outcome: status, errorCode: 'WORKER_LOST' } });
        await audit(tx, event, status);
        return null;
      }
      await audit(tx, event, 'CLAIMED');
      return event;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}

