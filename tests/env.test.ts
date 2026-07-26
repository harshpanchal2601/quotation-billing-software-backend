import { describe, expect, it } from 'vitest';

import { parseEnv } from '../src/config/env.js';

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '5050',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'mysql://user:password@localhost:3306/buminex_quotation',
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
};

describe('parseEnv', () => {
  it('validates and coerces backend environment variables', () => {
    const env = parseEnv(validEnvironment);

    expect(env).toMatchObject({
      NODE_ENV: 'test',
      PORT: 5050,
      FRONTEND_URL: 'http://localhost:5173',
      DATABASE_URL: validEnvironment.DATABASE_URL,
      JWT_ACCESS_SECRET: validEnvironment.JWT_ACCESS_SECRET,
      JWT_REFRESH_SECRET: validEnvironment.JWT_REFRESH_SECRET,
    });
  });

  it('fails clearly when required variables are missing', () => {
    expect(() => parseEnv({ NODE_ENV: 'test' })).toThrow(
      'Invalid environment configuration',
    );
  });
});
