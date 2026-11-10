import { logOperationalEvent } from '../core/observability/logger.js';

type ShutdownReason = 'SIGINT' | 'SIGTERM' | 'STARTUP_FAILURE';
type ShutdownDependencies = {
  beginDrain(): void;
  closeHttp(): Promise<void>;
  stopWorker(): Promise<void>;
  disconnect(): Promise<void>;
  forceClose(): void;
  exit(code: number): void;
  deadlineMs: number;
};

export function createGracefulShutdown(dependencies: ShutdownDependencies) {
  let pending: Promise<void> | undefined;
  return (reason: ShutdownReason): Promise<void> => {
    if (pending) return pending;
    dependencies.beginDrain();
    logOperationalEvent('info', { event: 'server.shutdown', phase: 'started', reason });
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      logOperationalEvent('error', { event: 'server.shutdown', phase: 'deadline', reason });
      try { dependencies.forceClose(); }
      catch { /* Exit remains mandatory if closing sockets itself fails. */ }
      finally { dependencies.exit(1); }
    }, dependencies.deadlineMs);
    pending = (async () => {
      let failed = reason === 'STARTUP_FAILURE';
      // Stop claiming jobs immediately while existing HTTP and worker work drain.
      const results = await Promise.allSettled([
        Promise.resolve().then(() => dependencies.closeHttp()),
        Promise.resolve().then(() => dependencies.stopWorker()),
      ]);
      if (expired) return;
      if (results.some((result) => result.status === 'rejected')) {
        // A failed drain cannot prove that no work still uses the database.
        clearTimeout(deadline);
        logOperationalEvent('error', { event: 'server.shutdown', phase: 'failed', reason });
        dependencies.exit(1);
        return;
      }
      try { await dependencies.disconnect(); }
      catch { failed = true; }
      if (expired) return;
      clearTimeout(deadline);
      logOperationalEvent(failed ? 'error' : 'info', { event: 'server.shutdown', phase: failed ? 'failed' : 'completed', reason });
      dependencies.exit(failed ? 1 : 0);
    })();
    return pending;
  };
}
