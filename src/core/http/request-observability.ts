import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { logOperationalEvent } from '../observability/logger.js';
import { runtimeState } from '../observability/runtime.js';

export const requestObservability: RequestHandler = (req, res, next) => {
  // Generate locally rather than trusting a client-controlled log/correlation ID.
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  const started = process.hrtime.bigint();
  runtimeState.requestStarted();
  let recorded = false;
  const record = (aborted: boolean) => {
    if (recorded) return;
    recorded = true;
    const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1_000_000);
    const status = aborted ? 499 : res.statusCode;
    runtimeState.requestFinished(status, durationMs, aborted);
    // Express route patterns are code-owned. Never log baseUrl/originalUrl:
    // mounted router prefixes and unmatched paths can contain private values.
    const route: unknown = req.route?.path;
    logOperationalEvent(status >= 500 ? 'error' : 'info', { event: 'http.completed', requestId, method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method) ? req.method : 'OTHER', group: req.routeGroup ?? 'unmatched', route: typeof route === 'string' ? route : 'unmatched', status, durationMs, aborted });
  };
  res.once('finish', () => record(false));
  res.once('close', () => record(!res.writableFinished));
  next();
};

export const rejectDuringDrain: RequestHandler = (req, res, next) => {
  if (!runtimeState.isDraining() || ['/api/v1/health', '/api/v1/health/', '/api/v1/health/live', '/api/v1/health/ready', '/api/v1/health/database', '/api/v1/health/worker'].includes(req.path)) return next();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'close');
  res.setHeader('Retry-After', '1');
  return res.status(503).json({ success: false, message: 'Service is shutting down' });
};
