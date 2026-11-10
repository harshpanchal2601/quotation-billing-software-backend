import { Resolver } from 'node:dns/promises';
import { request } from 'node:https';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';

export function webhookUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || (url.port && url.port !== '443') || !env.WEBHOOK_ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) throw new AppError('Webhook destination is not in the deployment HTTPS allowlist', 400);
  return url;
}
export function publicIpv4(address: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a! >= 224 ||
    (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export async function sendWebhook(destination: string, body: string, headers: Readonly<Record<string, string>>): Promise<void> {
  const url = webhookUrl(destination);
  const addresses = await new Resolver({ timeout: 2000, tries: 1 }).resolve4(url.hostname);
  // Pin a validated public IPv4 address for this connection; no redirect or
  // second DNS lookup can move it to an internal service. IPv6-only is excluded.
  if (!addresses.length || addresses.some((address) => !publicIpv4(address))) throw new AppError('Webhook destination does not resolve to public IPv4', 400);
  const address = addresses[0]!;
  await new Promise<void>((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, lookup: (_hostname, _options, callback) => callback(null, address, 4) }, (res) => {
      let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 64_000) req.destroy(new Error('Webhook response exceeds limit')); });
      res.on('end', () => res.statusCode && res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error('Webhook destination did not acknowledge delivery')));
      res.on('error', () => reject(new Error('Webhook response failed')));
    });
    const deadline = setTimeout(() => req.destroy(new Error('Webhook deadline exceeded')), 10_000);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', () => reject(new Error('Webhook delivery failed')));
    req.end(body);
  });
}
