import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const newPortalToken = () => randomBytes(32).toString('base64url');
export const portalTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const portalCsrfToken = (sessionToken: string) => createHash('sha256').update('portal-csrf-v1:').update(sessionToken).digest('base64url');
export function matchesPortalToken(token: string, hash: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token) && /^[a-f0-9]{64}$/.test(hash) && timingSafeEqual(Buffer.from(portalTokenHash(token), 'hex'), Buffer.from(hash, 'hex'));
}
