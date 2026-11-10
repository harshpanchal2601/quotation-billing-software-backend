import type { OutboxRepository } from './outbox.repository.js';
import { logOperationalEvent } from '../observability/logger.js';

type WorkerObserver = { started(): void; finished(succeeded: boolean): void };

// One in-flight job per process; DB leases coordinate multiple processes.
export function startOutboxWorker(repository: Pick<OutboxRepository, 'runOne'>, workerId: string, intervalMs: number, observer?: WorkerObserver) {
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  const tick = () => {
    observer?.started();
    // Preserve immediate claiming while also handling a synchronous throw from
    // an adapter as a failed cycle rather than stopping the loop permanently.
    let cycle: Promise<boolean>;
    try { cycle = repository.runOne(workerId); }
    catch (error) { cycle = Promise.reject(error); }
    inFlight = cycle.then(() => { observer?.finished(true); }).catch(() => {
      observer?.finished(false);
      logOperationalEvent('error', { event: 'outbox.cycle.failed' });
    }).finally(() => {
      if (!stopping) timer = setTimeout(tick, intervalMs);
    });
  };
  tick();
  return { async stop() { stopping = true; if (timer !== undefined) clearTimeout(timer); await inFlight; } };
}
