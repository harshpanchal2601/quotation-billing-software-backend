import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const encryptionKeySchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/).refine((value) => Buffer.from(value, 'base64').toString('base64') === value);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173').superRefine((value, context) => {
    let url: URL;
    try { url = new URL(value); }
    catch { return; } // The URL schema already rejects this without echoing input.
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) context.addIssue({ code: z.ZodIssueCode.custom, message: 'FRONTEND_URL must be a browser origin' });
  }).transform((value) => new URL(value).origin),
  DATABASE_URL: z.string().trim().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET: z.string().trim().min(1, 'JWT_ACCESS_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().trim().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_ACCESS_EXPIRES_IN: z
    .string()
    .trim()
    .regex(/^\d+[smhd]$/, 'JWT_ACCESS_EXPIRES_IN must be a duration like 15m')
    .default('15m'),
  JWT_REFRESH_EXPIRES_IN: z
    .string()
    .trim()
    .regex(/^\d+[smhd]$/, 'JWT_REFRESH_EXPIRES_IN must be a duration like 7d')
    .default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  INITIAL_ADMIN_NAME: z.string().optional(),
  INITIAL_ADMIN_EMAIL: z.string().optional(),
  INITIAL_ADMIN_USERNAME: z.string().optional(),
  INITIAL_ADMIN_PASSWORD: z.string().optional(),
  PLATFORM_ADMIN_NAME: z.string().optional(),
  PLATFORM_ADMIN_EMAIL: z.string().optional(),
  PLATFORM_ADMIN_USERNAME: z.string().optional(),
  PLATFORM_ADMIN_PASSWORD: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: z.preprocess((val) => val === 'true' || val === true, z.boolean()).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().optional(),
  SMTP_FROM_NAME: z.string().optional(),
  OUTBOX_WORKER_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  HEALTH_PROBE_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2000),
  WORKER_STALE_AFTER_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(300_000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(60_000),
  WEBHOOK_ENCRYPTION_KEY: z.preprocess((value) => value === '' ? undefined : value, encryptionKeySchema.optional()),
  WEBHOOK_ENCRYPTION_PREVIOUS_KEYS: z.string().default('').transform((value) => value.split(',').map((key) => key.trim()).filter(Boolean)).refine((keys) => keys.length <= 5 && keys.every((key) => encryptionKeySchema.safeParse(key).success)),
  WEBHOOK_ALLOWED_HOSTS: z.string().default('').transform((value) => value.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)).refine((hosts) => hosts.every((host) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))),
}).superRefine((value, context) => {
  if (value.WORKER_STALE_AFTER_MS <= value.OUTBOX_POLL_INTERVAL_MS) context.addIssue({ code: z.ZodIssueCode.custom, path: ['WORKER_STALE_AFTER_MS'], message: 'Worker freshness must exceed its poll interval' });
  if (value.NODE_ENV !== 'production') return;
  if (!value.FRONTEND_URL.startsWith('https://')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['FRONTEND_URL'], message: 'Production browser origin requires HTTPS' });
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    if (Buffer.byteLength(value[key], 'utf8') < 32 || ['replace_with_secure_access_secret', 'replace_with_secure_refresh_secret'].includes(value[key])) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Production signing secrets require independent non-example values of at least 32 bytes' });
  }
  if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) context.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_REFRESH_SECRET'], message: 'Signing secrets must be distinct' });
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(environment: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(environment);

  if (!result.success) {
    const missingVariables = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${missingVariables}`);
  }

  return result.data;
}

export const env = parseEnv(process.env);
