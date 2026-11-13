import { app } from './app.js';
import { env } from '../config/env.js';
import { prisma } from '../core/database/prisma.js';
import { startConfiguredOutboxWorker } from './outbox-worker.js';
import { createGracefulShutdown } from './graceful-shutdown.js';
import { runtimeState } from '../core/observability/runtime.js';
import { logOperationalEvent } from '../core/observability/logger.js';

let worker: ReturnType<typeof startConfiguredOutboxWorker> | undefined;
let metricsTimer: ReturnType<typeof setInterval> | undefined;
const server = app.listen(env.PORT, () => {
  if (runtimeState.isDraining()) return;
  try {
    worker = startConfiguredOutboxWorker();
    logOperationalEvent('info', { event: 'server.listening', port: env.PORT });
    metricsTimer = setInterval(() => {
      const memory = process.memoryUsage();
      logOperationalEvent('info', { event: 'process.metrics', uptimeSeconds: Math.floor(process.uptime()), rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, ...runtimeState.metrics() });
    }, 60_000);
    metricsTimer.unref();
  } catch { void shutdown('STARTUP_FAILURE'); }
});
const shutdown = createGracefulShutdown({
  beginDrain() {
    runtimeState.beginDrain();
    if (metricsTimer !== undefined) clearInterval(metricsTimer);
  },
  closeHttp: () => new Promise<void>((resolve, reject) => {
    server.close((error?: NodeJS.ErrnoException) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
      else resolve();
    });
    server.closeIdleConnections();
  }),
  stopWorker: async () => { await worker?.stop(); },
  disconnect: () => prisma.$disconnect(),
  forceClose: () => server.closeAllConnections(),
  exit: (code) => { process.exit(code); },
  deadlineMs: env.SHUTDOWN_TIMEOUT_MS,
});

server.on('error', () => { void shutdown('STARTUP_FAILURE'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
