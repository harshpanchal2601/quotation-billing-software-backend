import { randomUUID } from 'node:crypto';
import { type OutboxEvent, type PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enqueueOutbox, OutboxRepository, startOutboxWorker, type JobHandler } from '../src/core/outbox/index.js';
import { AppError } from '../src/core/errors/AppError.js';

// A rollback-capable persistence fixture. Effects live in the transaction state,
// so an execution/audit crash actually undoes its business effect in these tests.
function memoryDatabase(overrides: Partial<OutboxEvent> = {}) {
  let state = { event: { id: randomUUID(), firmId: 1, actorId: 10, kind: 'fixture.v1', sourceEventId: 'source-1', idempotencyKey: 'effect-1', payload: { resourceId: 11 }, status: 'PENDING', attempts: 0, maxAttempts: 3, availableAt: new Date(), lockedUntil: null, lockToken: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), ...overrides } as OutboxEvent,
    attempts: [] as Array<Record<string, unknown>>, audits: [] as unknown[], effects: 0 };
  let queue = Promise.resolve();
  function matches(where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'OR') return (value as Array<Record<string, unknown>>).some(matches);
      const actual = state.event[key as keyof OutboxEvent];
      if (value && typeof value === 'object' && 'lte' in value) return actual instanceof Date && actual <= (value.lte as Date);
      return actual === value;
    });
  }
  function update(data: Record<string, unknown>) {
    for (const [key, value] of Object.entries(data)) {
      if (key === 'attempts' && typeof value === 'object') state.event.attempts += (value as { increment: number }).increment;
      else Object.assign(state.event, { [key]: value });
    }
  }
  const tx = {
    outboxEvent: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => matches(where) ? structuredClone(state.event) : null,
      findUnique: vi.fn(async () => structuredClone(state.event)),
      create: vi.fn(async ({ data }: { data: OutboxEvent }) => { state.event = { ...state.event, ...data }; return structuredClone(state.event); }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => { if (!matches(where)) return { count: 0 }; update(data); return { count: 1 }; },
      update: async ({ data }: { data: Record<string, unknown> }) => { update(data); return structuredClone(state.event); },
    },
    jobAttempt: {
      create: async ({ data }: { data: Record<string, unknown> }) => { state.attempts.push(data); },
      update: async ({ where, data }: { where: { eventId_attempt: { attempt: number } }; data: Record<string, unknown> }) => { Object.assign(state.attempts.find((attempt) => attempt.attempt === where.eventId_attempt.attempt)!, data); },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { for (const attempt of state.attempts.filter((entry) => !entry.finishedAt)) Object.assign(attempt, data); },
    },
    auditLog: { create: vi.fn(async ({ data }: { data: unknown }) => { state.audits.push(data); }) },
    $queryRaw: vi.fn(async () => [{ id: 1 }]),
  };
  const db = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
    const previous = queue; let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = structuredClone(state);
    try { return await callback(tx); } catch (error) { state = snapshot; throw error; } finally { release(); }
  } } as unknown as PrismaClient;
  return { db, tx, get state() { return state; }, effect: () => { state.effects++; } };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('durable outbox dispatch', () => {
  it('rolls back a failed effect, retries and commits it exactly once', async () => {
    const fixture = memoryDatabase(); let crash = true;
    const handler: JobHandler = { retry: 'TRANSACTIONAL', authorize: async () => {}, execute: async () => { fixture.effect(); if (crash) { crash = false; throw new Error('injected provider crash with private content'); } } };
    const worker = new OutboxRepository(fixture.db, { 'fixture.v1': handler });
    await worker.runOne('worker-a');
    expect(fixture.state.effects).toBe(0);
    expect(fixture.state.event.status).toBe('PENDING');
    expect(fixture.state.attempts[0]).toMatchObject({ outcome: 'PENDING', errorCode: 'EXECUTION_FAILED' });
    vi.setSystemTime(new Date(Date.now() + 2000));
    await worker.runOne('worker-b');
    await worker.runOne('worker-c');
    expect(fixture.state.effects).toBe(1);
    expect(fixture.state.event.status).toBe('SUCCEEDED');
    expect(fixture.state.attempts).toHaveLength(2);
    expect(JSON.stringify(fixture.state.attempts)).not.toContain('private content');
  });

  it('prevents concurrent workers from dispatching the same live lease', async () => {
    const fixture = memoryDatabase();
    const worker = new OutboxRepository(fixture.db, { 'fixture.v1': { retry: 'TRANSACTIONAL', authorize: async () => {}, execute: async () => fixture.effect() } });
    await Promise.all([worker.runOne('worker-a'), worker.runOne('worker-b')]);
    expect(fixture.state.effects).toBe(1);
    expect(fixture.state.attempts).toHaveLength(1);
  });

  it('revalidates revoked tenant/role/entitlement access before the effect', async () => {
    const fixture = memoryDatabase();
    const execute = vi.fn();
    const worker = new OutboxRepository(fixture.db, { 'fixture.v1': { retry: 'TRANSACTIONAL', authorize: async () => { throw new AppError('Access revoked', 403); }, execute } });
    await worker.runOne('worker-a');
    expect(execute).not.toHaveBeenCalled();
    expect(fixture.state.event.status).toBe('DEAD');
    expect(fixture.state.audits).toHaveLength(2);
  });

  it('dead-letters unknown/poison events and exhausted retries', async () => {
    const poison = memoryDatabase({ kind: 'unknown.v1' });
    await new OutboxRepository(poison.db, {}).runOne('worker-a');
    expect(poison.state.event.status).toBe('DEAD');
    const exhausted = memoryDatabase({ attempts: 2 });
    await new OutboxRepository(exhausted.db, { 'fixture.v1': { retry: 'TRANSACTIONAL', authorize: async () => {}, execute: async () => { throw new Error('permanent fault'); } } }).runOne('worker-a');
    expect(exhausted.state.event.status).toBe('DEAD');
  });

  it('recovers expired transactional leases without dispatching unsafe providers', async () => {
    for (const retry of ['TRANSACTIONAL', 'RECONCILE'] as const) {
      const fixture = memoryDatabase({ status: 'PROCESSING', attempts: 1, lockedUntil: new Date(Date.now() - 1000), lockToken: randomUUID() });
      fixture.state.attempts.push({ attempt: 1 });
      await new OutboxRepository(fixture.db, { 'fixture.v1': { retry, authorize: async () => {}, execute: async () => fixture.effect() } }).runOne('worker-a');
      expect(fixture.state.effects).toBe(retry === 'TRANSACTIONAL' ? 1 : 0);
      expect(fixture.state.event.status).toBe(retry === 'TRANSACTIONAL' ? 'SUCCEEDED' : 'RECONCILE');
      expect(fixture.state.attempts[0]).toMatchObject({ outcome: 'LEASE_EXPIRED' });
    }
  });

  it('does not automatically repeat an uncertain SMTP-style delivery', async () => {
    const fixture = memoryDatabase(); const send = vi.fn(async () => { throw new Error('uncertain acceptance'); });
    const worker = new OutboxRepository(fixture.db, { 'fixture.v1': { retry: 'RECONCILE', authorize: async () => {}, execute: send } });
    await worker.runOne('worker-a'); vi.setSystemTime(new Date(Date.now() + 100_000)); await worker.runOne('worker-b');
    expect(send).toHaveBeenCalledTimes(1);
    expect(fixture.state.event.status).toBe('RECONCILE');
  });

  it('fails closed and rolls back the effect when its completion audit cannot commit', async () => {
    const fixture = memoryDatabase();
    fixture.tx.auditLog.create.mockImplementation(async ({ data }: { data: unknown }) => {
      if ((data as { newValues: { decision: string } }).newValues.decision === 'SUCCEEDED') throw new Error('audit storage failed');
    });
    await new OutboxRepository(fixture.db, { 'fixture.v1': { retry: 'TRANSACTIONAL', authorize: async () => {}, execute: async () => fixture.effect() } }).runOne('worker-a');
    expect(fixture.state.effects).toBe(0); expect(fixture.state.event.status).toBe('PENDING');
  });

  it('reuses the same provider idempotency key after an accepted effect and failed DB commit', async () => {
    const fixture = memoryDatabase();
    const accepted = new Set<string>(); const keys: string[] = []; let failAudit = true;
    fixture.tx.auditLog.create.mockImplementation(async ({ data }: { data: unknown }) => {
      if (failAudit && (data as { newValues: { decision: string } }).newValues.decision === 'SUCCEEDED') { failAudit = false; throw new Error('commit fault'); }
    });
    const worker = new OutboxRepository(fixture.db, { 'fixture.v1': { retry: 'IDEMPOTENT', authorize: async () => {}, execute: async (_tx, current) => { keys.push(current.id); accepted.add(current.id); } } });
    await worker.runOne('worker-a');
    expect(fixture.state.event.status).toBe('PENDING');
    vi.setSystemTime(new Date(Date.now() + 2000)); await worker.runOne('worker-b');
    expect(keys).toEqual([fixture.state.event.id, fixture.state.event.id]);
    expect(accepted.size).toBe(1);
    expect(fixture.state.event.status).toBe('SUCCEEDED');
  });

  it('rejects conflicting idempotency envelopes and returns an identical event', async () => {
    const fixture = memoryDatabase();
    const input = { firmId: 1, actorId: 10, kind: 'fixture.v1', sourceEventId: 'source-1', idempotencyKey: 'effect-1', payload: { resourceId: 11 } };
    const tx = fixture.tx as unknown as Parameters<typeof enqueueOutbox>[0];
    await expect(enqueueOutbox(tx, input)).resolves.toMatchObject({ id: fixture.state.event.id });
    await expect(enqueueOutbox(tx, { ...input, payload: { resourceId: 22 } })).rejects.toMatchObject({ statusCode: 409 });
    expect(fixture.tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('drains the in-flight cycle on shutdown and schedules no more work', async () => {
    let resolve!: (value: boolean) => void;
    const runOne = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    const worker = startOutboxWorker({ runOne }, 'worker-a', 100);
    const stopping = worker.stop(); resolve(true); await stopping;
    await vi.advanceTimersByTimeAsync(1000);
    expect(runOne).toHaveBeenCalledTimes(1);
  });
});
