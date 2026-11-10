import type { OutboxEvent, Prisma } from '@prisma/client';

export type PreparedJob = Readonly<{
  value: unknown;
  // Called after the database outcome is known. A failed attempt must remove
  // only its own reversible artifacts; committed resources must be retained.
  cleanup: (committed: boolean) => Promise<void>;
}>;

export type JobHandler = Readonly<{
  // TRANSACTIONAL handlers perform every effect with the supplied transaction.
  // IDEMPOTENT providers must deduplicate by event.id; SMTP does not qualify.
  retry: 'TRANSACTIONAL' | 'IDEMPOTENT' | 'RECONCILE';
  authorize: (tx: Prisma.TransactionClient, event: OutboxEvent) => Promise<void>;
  // Optional preparation is for reversible computation/artifacts, never for
  // charges, mail or other irreversible effects. Authorization runs both before
  // preparation and again in the lease-owning commit transaction.
  prepare?: (event: OutboxEvent) => Promise<PreparedJob>;
  execute: (tx: Prisma.TransactionClient, event: OutboxEvent, prepared?: unknown) => Promise<void>;
}>;
export type JobRegistry = Readonly<Record<string, JobHandler>>;
