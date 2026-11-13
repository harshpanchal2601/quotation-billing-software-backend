import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rejectDuringDrain, requestObservability } from '../src/core/http/request-observability.js';
import { runtimeState } from '../src/core/observability/runtime.js';
import { errorHandler } from '../src/core/http/errorHandler.js';
import { notFoundHandler } from '../src/core/http/notFoundHandler.js';
import { createAuditLog } from '../src/core/audit/audit-log.service.js';
import type { PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';
import { AppError } from '../src/core/errors/AppError.js';

vi.mock('../src/config/env.js', () => ({ env: { NODE_ENV: 'production', FRONTEND_URL: 'https://erp.example.invalid' } }));

describe('Wave 11 safe HTTP diagnostics', () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server) {
      const current = server; server = undefined;
      await new Promise<void>((resolve, reject) => { current.close((error) => error ? reject(error) : resolve()); current.closeIdleConnections(); });
    }
    vi.restoreAllMocks();
  });

  async function listen() {
    const app = express();
    app.use(requestObservability);
    app.use(rejectDuringDrain);
    app.use(express.json({ limit: '128b' }));
    app.get('/records/:id', () => { throw new Error('provider-password-and-private-record'); });
    app.get('/forbidden', () => { throw new AppError('You are not authorised to perform this action', 403); });
    app.post('/forbidden', () => { throw new AppError('You are not authorised to perform this action', 403); });
    app.get('/unauthenticated', () => { throw new AppError('Authentication required', 401); });
    app.get('/api/v1/health/live', (_req, res) => res.json({ status: 'healthy' }));
    app.use(notFoundHandler);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Listener unavailable');
    return `http://127.0.0.1:${address.port}`;
  }

  it('logs route patterns and local request IDs without bodies, credentials, query values or provider exceptions', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const base = await listen();
    const response = await fetch(`${base}/records/private-company?token=private-token`, { headers: { Cookie: 'session=private-cookie', Authorization: 'Bearer private-bearer', 'X-Request-Id': 'private-client-id', Referer: 'https://example.com/private-referrer' } });
    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/);
    expect(await response.json()).toEqual({ success: false, message: 'Internal server error' });
    const logs = JSON.stringify([...info.mock.calls, ...error.mock.calls]);
    for (const value of ['private-company', 'private-token', 'private-cookie', 'private-bearer', 'private-client-id', 'private-referrer', 'provider-password-and-private-record']) expect(logs).not.toContain(value);
    const completed = error.mock.calls.map(([entry]) => JSON.parse(String(entry)) as { event: string; route?: string; requestId?: string }).find((entry) => entry.event === 'http.completed');
    expect(completed).toMatchObject({ route: '/records/:id', requestId: response.headers.get('x-request-id') });
    const missing = await fetch(`${base}/private-missing?secret=private-query`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ success: false, message: 'Route not found' });
    expect(JSON.stringify(info.mock.calls)).not.toContain('private-missing');
    expect(JSON.stringify(info.mock.calls)).not.toContain('private-query');
  });

  it('classifies malformed and oversized JSON as client errors without echoing the body', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const base = await listen();
    const malformed = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"private-body"' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ success: false, message: 'Request body contains invalid JSON' });
    const large = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'x'.repeat(200) }) });
    expect(large.status).toBe(413);
    expect(await large.json()).toEqual({ success: false, message: 'Request body is too large' });
  });

  it.each([['/forbidden', '/access-denied'], ['/unauthenticated', '/login']])('takes HTML navigation at %s to the configured application page', async (route, page) => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const base = await listen();
    for (const accept of ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Text/HTML']) {
      const response = await fetch(`${base}${route}?private=do-not-copy`, { headers: { Accept: accept, Host: 'untrusted.example.invalid' }, redirect: 'manual' });
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`https://erp.example.invalid${page}`);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('vary')).toContain('Accept');
    }
  });

  it('retains JSON authorization failures for API clients and mutation requests', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const base = await listen();
    for (const headers of [{}, { Accept: '*/*' }, { Accept: 'application/json' }, { Accept: 'application/json,text/html;q=0.5' }]) {
      const response = await fetch(`${base}/forbidden`, { headers, redirect: 'manual' });
      expect(response.status).toBe(403);
      expect(response.headers.get('location')).toBeNull();
      expect(await response.json()).toEqual({ success: false, message: 'You are not authorised to perform this action' });
    }
    const mutation = await fetch(`${base}/forbidden`, { method: 'POST', headers: { Accept: 'text/html' }, redirect: 'manual' });
    expect(mutation.status).toBe(403);
    expect(await mutation.json()).toEqual({ success: false, message: 'You are not authorised to perform this action' });
  });

  it('delegates errors after headers have been sent instead of writing a second response', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const next = vi.fn(); const json = vi.fn(); const failure = new Error('private-provider-message');
    errorHandler(failure, { requestId: 'local-id' } as express.Request, { headersSent: true, json } as unknown as express.Response, next);
    expect(next).toHaveBeenCalledWith(failure);
    expect(json).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain('private-provider-message');
  });

  it('refuses new business work while preserving the liveness probe during drain', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(runtimeState, 'isDraining').mockReturnValue(true);
    const base = await listen();
    const response = await fetch(`${base}/records/1`);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: false, message: 'Service is shutting down' });
    expect((await fetch(`${base}/api/v1/health/live`)).status).toBe(200);
  });

  it('retains required audit atomicity and redacts best effort database failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('INSERT private-customer-and-password');
    const db = { auditLog: { create: vi.fn().mockRejectedValue(failure) } } as unknown as PrismaClient;
    const input = { metadata: { firmId: 1, userId: 1 }, entityType: 'Quotation', entityId: '1', action: AuditAction.CREATE };
    await expect(createAuditLog(db, input)).resolves.toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private-customer-and-password');
    await expect(createAuditLog(db, { ...input, policy: 'REQUIRED' })).rejects.toBe(failure);
  });
});
