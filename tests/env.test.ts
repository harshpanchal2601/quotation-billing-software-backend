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
  it('bounds operational probe, worker and shutdown configuration', () => {
    expect(parseEnv(validEnvironment)).toMatchObject({ HEALTH_PROBE_TIMEOUT_MS: 2000, WORKER_STALE_AFTER_MS: 300000, SHUTDOWN_TIMEOUT_MS: 60000 });
    for (const [key, value] of [['HEALTH_PROBE_TIMEOUT_MS', '0'], ['WORKER_STALE_AFTER_MS', '999'], ['SHUTDOWN_TIMEOUT_MS', '300001']] as const) {
      expect(() => parseEnv({ ...validEnvironment, [key]: value })).toThrow(key);
    }
    expect(() => parseEnv({ ...validEnvironment, OUTBOX_POLL_INTERVAL_MS: '60000', WORKER_STALE_AFTER_MS: '60000' })).toThrow('WORKER_STALE_AFTER_MS');
  });
  it('normalizes browser origins while rejecting embedded credentials, paths and non-HTTP protocols', () => {
    expect(parseEnv({ ...validEnvironment, FRONTEND_URL: 'https://app.example.com/' }).FRONTEND_URL).toBe('https://app.example.com');
    for (const value of ['not-a-url', 'https://user:private@example.com', 'https://example.com/app', 'https://example.com?token=private', 'ftp://example.com']) {
      expect(() => parseEnv({ ...validEnvironment, FRONTEND_URL: value })).toThrow('FRONTEND_URL');
    }
  });
  it('fails production startup for weak or shared signing secrets and non-HTTPS browser origins without exposing their values', () => {
    const production = { ...validEnvironment, NODE_ENV: 'production', FRONTEND_URL: 'https://app.example.com', JWT_ACCESS_SECRET: 'fixture-access-'.repeat(4), JWT_REFRESH_SECRET: 'fixture-refresh-'.repeat(4) };
    expect(parseEnv(production).NODE_ENV).toBe('production');
    expect(() => parseEnv({ ...production, FRONTEND_URL: 'http://app.example.com' })).toThrow('FRONTEND_URL');
    expect(() => parseEnv({ ...production, JWT_REFRESH_SECRET: production.JWT_ACCESS_SECRET })).toThrow('JWT_REFRESH_SECRET');
    expect(() => parseEnv({ ...production, JWT_ACCESS_SECRET: 'replace_with_secure_access_secret' })).toThrow('JWT_ACCESS_SECRET');
    try { parseEnv({ ...production, JWT_ACCESS_SECRET: 'private-weak-value' }); throw new Error('Expected production guard'); }
    catch (error) { expect(String(error)).toContain('JWT_ACCESS_SECRET'); expect(String(error)).not.toContain('private-weak-value'); }
  });
  it('keeps webhook delivery unconfigured by default and validates rotation configuration without exposing secrets', () => {
    expect(parseEnv(validEnvironment)).toMatchObject({ OUTBOX_WORKER_ENABLED: false, WEBHOOK_ALLOWED_HOSTS: [], WEBHOOK_ENCRYPTION_PREVIOUS_KEYS: [] });
    const key = Buffer.alloc(32, 1).toString('base64');
    expect(parseEnv({ ...validEnvironment, WEBHOOK_ENCRYPTION_KEY: key, WEBHOOK_ALLOWED_HOSTS: 'hooks.example.com, OTHER.example.com', WEBHOOK_ENCRYPTION_PREVIOUS_KEYS: Buffer.alloc(32, 2).toString('base64') })).toMatchObject({ WEBHOOK_ALLOWED_HOSTS: ['hooks.example.com', 'other.example.com'], WEBHOOK_ENCRYPTION_PREVIOUS_KEYS: [Buffer.alloc(32, 2).toString('base64')] });
    for (const hosts of ['*', '127.0.0.1', 'https://hooks.example.com', 'hooks.example.com:443']) expect(() => parseEnv({ ...validEnvironment, WEBHOOK_ALLOWED_HOSTS: hosts })).toThrow('WEBHOOK_ALLOWED_HOSTS');
    expect(() => parseEnv({ ...validEnvironment, WEBHOOK_ENCRYPTION_KEY: 'private-invalid-key' })).toThrow('WEBHOOK_ENCRYPTION_KEY');
    try { parseEnv({ ...validEnvironment, WEBHOOK_ENCRYPTION_KEY: 'private-invalid-key' }); }
    catch (error) { expect(String(error)).not.toContain('private-invalid-key'); }
  });
});
