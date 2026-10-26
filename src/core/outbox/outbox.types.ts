import type { OutboxEvent, Prisma } from '@prisma/client';

export type JobHandler = Readonly<{
  // TRANSACTIONAL handlers perform every effect with the supplied transaction.
  // IDEMPOTENT providers must deduplicate by event.id; SMTP does not qualify.
  retry: 'TRANSACTIONAL' | 'IDEMPOTENT' | 'RECONCILE';
  authorize: (tx: Prisma.TransactionClient, event: OutboxEvent) => Promise<void>;
  execute: (tx: Prisma.TransactionClient, event: OutboxEvent) => Promise<void>;
}>;
export type JobRegistry = Readonly<Record<string, JobHandler>>;
