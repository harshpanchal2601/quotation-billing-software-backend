import type { OutboxRepository } from './outbox.repository.js';

// One in-flight job per process; DB leases coordinate multiple processes.
export function startOutboxWorker(repository: Pick<OutboxRepository, 'runOne'>, workerId: string, intervalMs: number) {
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  const tick = () => {
    inFlight = repository.runOne(workerId).then(() => undefined).catch(() => {
      console.error('Outbox worker cycle failed; durable state retained for recovery.');
    }).finally(() => {
      if (!stopping) timer = setTimeout(tick, intervalMs);
    });
  };
  tick();
  return { async stop() { stopping = true; if (timer !== undefined) clearTimeout(timer); await inFlight; } };
}
