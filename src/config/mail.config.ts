import { env } from './env.js';

export const mailConfig = {
  smtpHost: env.SMTP_HOST ?? null,
  smtpPort: env.SMTP_PORT ?? null,
  smtpSecure: env.SMTP_SECURE ?? null,
  smtpUser: env.SMTP_USER ?? null,
  smtpPassword: env.SMTP_PASSWORD ?? null,
  fromEmail: env.SMTP_FROM_EMAIL ?? null,
  fromName: env.SMTP_FROM_NAME ?? null,
  connectionTimeoutMs: 10_000,
  greetingTimeoutMs: 10_000,
  socketTimeoutMs: 15_000,
} as const;
