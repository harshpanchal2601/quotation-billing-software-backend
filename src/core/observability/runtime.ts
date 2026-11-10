export function createRuntimeState(now: () => number = Date.now) {
  let draining = false;
  let workerEnabled = false;
  let workerInFlight = false;
  let workerSucceeded = false;
  let lastWorkerSuccess: number | undefined;
  let workerCycles = 0;
  let workerFailures = 0;
  let activeRequests = 0;
  let completedRequests = 0;
  let serverErrors = 0;
  let abortedRequests = 0;
  let durationTotalMs = 0;
  return {
    beginDrain() { draining = true; },
    isDraining: () => draining,
    configureWorker(enabled: boolean) {
      workerEnabled = enabled;
      workerSucceeded = false;
      lastWorkerSuccess = undefined;
    },
    workerStarted() { workerInFlight = true; },
    workerFinished(succeeded: boolean) {
      workerInFlight = false;
      workerCycles += 1;
      workerSucceeded = succeeded;
      if (succeeded) lastWorkerSuccess = now();
      else workerFailures += 1;
    },
    workerReady(expected: boolean, staleAfterMs: number) {
      return !draining && (!expected || (workerEnabled && workerSucceeded && lastWorkerSuccess !== undefined && now() - lastWorkerSuccess <= staleAfterMs));
    },
    requestStarted() { activeRequests += 1; },
    requestFinished(status: number, durationMs: number, aborted: boolean) {
      activeRequests = Math.max(0, activeRequests - 1);
      completedRequests += 1;
      if (status >= 500) serverErrors += 1;
      if (aborted) abortedRequests += 1;
      durationTotalMs += durationMs;
    },
    metrics() {
      return { activeRequests, completedRequests, serverErrors, abortedRequests, durationTotalMs, workerEnabled, workerInFlight, workerCycles, workerFailures };
    },
  };
}

export const runtimeState = createRuntimeState();
