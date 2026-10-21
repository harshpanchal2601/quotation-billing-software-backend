import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.PORT = '5000';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/buminex_quotation';
process.env.JWT_ACCESS_SECRET = 'access-secret';
process.env.JWT_REFRESH_SECRET = 'refresh-secret';

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
    path: string;
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
  const layer = router.stack.find((candidate) => candidate.route?.path === path);
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

  const response = {
    status: vi.fn((statusCode: number) => {
      jsonResponse.statusCode = statusCode;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      jsonResponse.body = body;
      return response;
    }),
  } as unknown as Response;

  await new Promise<void>((resolve, reject) => {
    const next: NextFunction = (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    const result = handler({} as Request, response, next);

    if (result instanceof Promise) {
      result.then(() => resolve()).catch(reject);
      return;
    }

    resolve();
  });

  return jsonResponse;
}

const { healthRouter } = await import('../src/routes/health.routes.js');
const { checkDatabaseHealth } = await import('../src/core/database/database-health.js');

describe('health endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the original API health response', async () => {
    const response = await callHandler(getRouteHandler('/'));

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'Buminex API is running',
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
});
