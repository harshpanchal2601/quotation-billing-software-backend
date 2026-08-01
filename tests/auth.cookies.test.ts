import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.PORT = '5000';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.DATABASE_URL = 'mysql://user:password@localhost:3306/buminex_quotation';
process.env.JWT_ACCESS_SECRET = 'access-secret';
process.env.JWT_REFRESH_SECRET = 'refresh-secret';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';

const { clearAuthCookies, setAuthCookies } = await import('../src/modules/auth/security/auth.cookies.js');
const { ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME } = await import('../src/modules/auth/auth.constants.js');

function createResponse() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response;
}

describe('auth cookies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets HTTP-only access and refresh cookies with separate paths', () => {
    const res = createResponse();

    setAuthCookies(res, {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    expect(res.cookie).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE_NAME,
      'access-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: 15 * 60 * 1000,
      }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/api/v1/auth',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      }),
    );
  });

  it('clears cookies with matching names and paths', () => {
    const res = createResponse();

    clearAuthCookies(res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE_NAME,
      expect.objectContaining({ path: '/', httpOnly: true }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE_NAME,
      expect.objectContaining({ path: '/api/v1/auth', httpOnly: true }),
    );
  });
});
