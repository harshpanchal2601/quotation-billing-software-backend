import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.PORT = '5000';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/buminex_quotation';
process.env.JWT_ACCESS_SECRET = 'access-secret';
process.env.JWT_REFRESH_SECRET = 'refresh-secret';
process.env.OUTBOX_WORKER_ENABLED = 'false';

const runtime = vi.hoisted(() => ({ isDraining: vi.fn(), workerReady: vi.fn() }));
vi.mock('../src/core/observability/runtime.js', () => ({ runtimeState: runtime }));

vi.mock('../src/core/database/prisma.js', () => ({
  prisma: {
    $disconnect: vi.fn(),
  },
}));

vi.mock('../src/core/database/database-health.js', () => ({
  checkDatabaseHealth: vi.fn(),
}));

type RouteLayer = {
  route?: {
    path: string | string[];
    stack: Array<{
      handle: RequestHandler;
    }>;
  };
};

type JsonResponse = {
  statusCode: number;
  body: unknown;
};

function getRouteHandler(path: string): RequestHandler {
  const router = healthRouter as unknown as { stack: RouteLayer[] };
  const layer = router.stack.find((candidate) => candidate.route?.path === path || (Array.isArray(candidate.route?.path) && candidate.route.path.includes(path)));
  const handler = layer?.route?.stack[0]?.handle;

  if (handler === undefined) {
    throw new Error(`Health route not found: ${path}`);
  }

  return handler;
}

async function callHandler(handler: RequestHandler): Promise<JsonResponse> {
  const jsonResponse: JsonResponse = {
    statusCode: 200,
    body: undefined,
  };

  await new Promise<void>((resolve, reject) => {
    const response = {
      status: vi.fn((statusCode: number) => {
        jsonResponse.statusCode = statusCode;
        return response;
      }),
      json: vi.fn((body: unknown) => {
        jsonResponse.body = body;
        resolve();
        return response;
      }),
    } as unknown as Response;
    const next: NextFunction = (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    const result: unknown = handler({} as Request, response, next);

    if (result instanceof Promise) {
      result.then(() => resolve()).catch(reject);
      return;
    }

    // asyncHandler intentionally returns void. Wait for json()/next(), rather
    // than treating that return as evidence the async route has completed.
  });

  return jsonResponse;
}

const { healthRouter } = await import('../src/routes/health.routes.js');
const { checkDatabaseHealth } = await import('../src/core/database/database-health.js');

describe('health endpoints', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    runtime.isDraining.mockReturnValue(false);
    runtime.workerReady.mockReturnValue(true);
  });

  it('returns the current API health response', async () => {
    const response = await callHandler(getRouteHandler('/'));

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'ERP API is running',
      data: {
        status: 'healthy',
      },
    });
  });

  it('returns a healthy database response when Prisma succeeds', async () => {
    vi.mocked(checkDatabaseHealth).mockResolvedValueOnce(undefined);

    const response = await callHandler(getRouteHandler('/database'));

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'Database connection is healthy',
      data: {
        status: 'healthy',
      },
    });
  });

  it('returns an unhealthy database response when Prisma fails', async () => {
    vi.mocked(checkDatabaseHealth).mockRejectedValueOnce(new Error('Connection failed'));

    const response = await callHandler(getRouteHandler('/database'));

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      success: false,
      message: 'Database connection is unavailable',
      data: {
        status: 'unhealthy',
      },
    });
  });

  it('keeps liveness independent of a failed database and worker', async () => {
    runtime.workerReady.mockReturnValue(false);
    vi.mocked(checkDatabaseHealth).mockRejectedValue(new Error('Unavailable'));
    expect((await callHandler(getRouteHandler('/live'))).statusCode).toBe(200);
    expect(checkDatabaseHealth).not.toHaveBeenCalled();
    expect((await callHandler(getRouteHandler('/ready'))).statusCode).toBe(503);
  });

  it('checks readiness again when shutdown starts during a database probe', async () => {
    vi.mocked(checkDatabaseHealth).mockImplementationOnce(async () => { runtime.isDraining.mockReturnValue(true); });
    const response = await callHandler(getRouteHandler('/ready'));
    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({ success: false, message: 'Service is not ready', data: { status: 'not_ready' } });
  });

  it('reports readiness without database or worker internals', async () => {
    vi.mocked(checkDatabaseHealth).mockResolvedValueOnce(undefined);
    expect((await callHandler(getRouteHandler('/ready'))).body).toEqual({ success: true, message: 'Service is ready', data: { status: 'ready' } });
    runtime.isDraining.mockReturnValue(true);
    expect((await callHandler(getRouteHandler('/ready'))).statusCode).toBe(503);
  });

  it('exposes only generic disabled or unavailable worker status', async () => {
    expect((await callHandler(getRouteHandler('/worker'))).body).toEqual({ success: true, message: 'Worker is available', data: { status: 'disabled' } });
    runtime.workerReady.mockReturnValue(false);
    expect(await callHandler(getRouteHandler('/worker'))).toEqual({ statusCode: 503, body: { success: false, message: 'Worker is unavailable', data: { status: 'unhealthy' } } });
    expect(checkDatabaseHealth).not.toHaveBeenCalled();
  });
});
