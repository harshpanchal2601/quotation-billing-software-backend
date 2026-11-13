import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const config = vi.hoisted(() => ({ WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), WEBHOOK_ENCRYPTION_PREVIOUS_KEYS: [] as string[], WEBHOOK_ALLOWED_HOSTS: ['hooks.example.com'] }));
vi.mock('../src/config/env.js', () => ({ env: config }));
import { decryptWebhookSecret, encryptWebhookSecret, signWebhook, verifyWebhook } from '../src/integrations/webhooks/secrets.js';
import { publicIpv4, webhookUrl } from '../src/integrations/webhooks/transport.js';
beforeEach(() => { config.WEBHOOK_ALLOWED_HOSTS = ['hooks.example.com']; config.WEBHOOK_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); config.WEBHOOK_ENCRYPTION_PREVIOUS_KEYS = []; });
describe('Wave 10 webhook signing and transport boundaries', () => {
  it('authenticates exact bytes, timestamp and stable delivery ID', () => {
    const now = Date.parse('2026-11-09T12:00:00Z'); const timestamp = Math.floor(now / 1000); const id = randomUUID(); const body = '{"firmId":1}';
    const signature = signWebhook('fixture-secret', timestamp, id, body);
    expect(verifyWebhook('fixture-secret', timestamp, id, body, signature, now)).toBe(true);
    expect(verifyWebhook('fixture-secret', timestamp, id, '{"firmId":2}', signature, now)).toBe(false);
    expect(verifyWebhook('fixture-secret', timestamp, randomUUID(), body, signature, now)).toBe(false);
    expect(verifyWebhook('fixture-secret', timestamp, id, body, signature, now + 301000)).toBe(false);
    expect(verifyWebhook('fixture-secret', timestamp, id, body, 'invalid', now)).toBe(false);
  });
  it('binds encrypted secrets to firm, endpoint and signing version', () => {
    const id = randomUUID(); const encrypted = encryptWebhookSecret('fixture-signing-secret', `1:${id}:1`);
    expect(encrypted).not.toContain('fixture-signing-secret');
    expect(decryptWebhookSecret(encrypted, `1:${id}:1`)).toBe('fixture-signing-secret');
    expect(() => decryptWebhookSecret(encrypted, `2:${id}:1`)).toThrow();
    expect(() => decryptWebhookSecret(encrypted, `1:${id}:2`)).toThrow();
  });
  it('requires an exact approved HTTPS host without credentials, queries or alternate ports', () => {
    expect(webhookUrl('https://hooks.example.com/events').hostname).toBe('hooks.example.com');
    for (const url of ['http://hooks.example.com', 'https://user:secret@hooks.example.com', 'https://hooks.example.com:8080', 'https://hooks.example.com?token=x', 'https://hooks.example.com.attacker.invalid', 'https://127.0.0.1', 'https://[::1]']) expect(() => webhookUrl(url)).toThrow();
  });
  it('retains old ciphertext during encryption-key rotation while writing with the current key', () => {
    const encrypted = encryptWebhookSecret('old-secret', '1:endpoint:1');
    config.WEBHOOK_ENCRYPTION_PREVIOUS_KEYS = [config.WEBHOOK_ENCRYPTION_KEY];
    config.WEBHOOK_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
    expect(decryptWebhookSecret(encrypted, '1:endpoint:1')).toBe('old-secret');
    const current = encryptWebhookSecret('new-secret', '1:endpoint:2');
    config.WEBHOOK_ENCRYPTION_PREVIOUS_KEYS = [];
    expect(decryptWebhookSecret(current, '1:endpoint:2')).toBe('new-secret');
    expect(() => decryptWebhookSecret(encrypted, '1:endpoint:1')).toThrow();
  });
  it('refuses internal, metadata, loopback, documentation, multicast and benchmark destinations', () => {
    for (const address of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1']) expect(publicIpv4(address), address).toBe(false);
    expect(publicIpv4('8.8.8.8')).toBe(true);
  });
});
