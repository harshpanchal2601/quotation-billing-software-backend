type OperationalEvent =
  | { event: 'http.completed'; requestId: string; method: string; group: string; route: string; status: number; durationMs: number; aborted: boolean }
  | { event: 'http.failed'; requestId: string | undefined; kind: 'unexpected' | 'response_started' }
  | { event: 'server.listening'; port: number }
  | { event: 'server.shutdown'; phase: 'started' | 'completed' | 'failed' | 'deadline'; reason: 'SIGINT' | 'SIGTERM' | 'STARTUP_FAILURE' }
  | { event: 'outbox.cycle.failed' | 'outbox.artifact_cleanup.failed' | 'outbox.discovery.failed' | 'assistant.retention.failed' | 'audit.best_effort.failed' | 'pdf.failed' | 'smtp.failed' | 'database.client.failed' | 'database.client.warning' }
  | { event: 'process.metrics'; uptimeSeconds: number; rssBytes: number; heapUsedBytes: number; activeRequests: number; completedRequests: number; serverErrors: number; abortedRequests: number; durationTotalMs: number; workerEnabled: boolean; workerInFlight: boolean; workerCycles: number; workerFailures: number };

// A closed metadata contract deliberately has no request bodies, URLs, headers,
// error objects, database parameters, identities or customer data.
export function logOperationalEvent(level: 'info' | 'warn' | 'error', event: OperationalEvent): void {
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), level, ...event }));
}
