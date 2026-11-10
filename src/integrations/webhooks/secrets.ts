import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';

function key() {
  if (!env.WEBHOOK_ENCRYPTION_KEY) throw new AppError('Webhook encryption is not configured', 503);
  const bytes = Buffer.from(env.WEBHOOK_ENCRYPTION_KEY, 'base64');
  if (bytes.length !== 32) throw new AppError('Webhook encryption is not configured', 503);
  return bytes;
}
export function encryptWebhookSecret(secret: string, identity: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(identity));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function decryptWebhookSecret(encrypted: string, identity: string): string {
  const bytes = Buffer.from(encrypted, 'base64');
  for (const candidate of [key(), ...env.WEBHOOK_ENCRYPTION_PREVIOUS_KEYS.map((value) => Buffer.from(value, 'base64'))]) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', candidate, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(identity));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    } catch { /* Try retained rotation keys without exposing decryption details. */ }
  }
  throw new AppError('Webhook signing secret cannot be decrypted', 503);
}
export function signWebhook(secret: string, timestamp: number, deliveryId: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${deliveryId}.${body}`).digest('hex');
}
// Receiver helper: verify exact bytes before parsing, then durably deduplicate
// deliveryId. An authentic duplicate must not repeat its business effect.
export function verifyWebhook(secret: string, timestamp: number, deliveryId: string, body: string, signature: string, now = Date.now()): boolean {
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(now / 1000) - timestamp) > 300 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signWebhook(secret, timestamp, deliveryId, body), 'hex'), Buffer.from(signature, 'hex'));
}
