import { z } from 'zod';

export const apiScopeSchema = z.enum(['reports.read', 'reports.export']);
export type ApiScope = z.infer<typeof apiScopeSchema>;
export const keyCreateSchema = z.object({ name: z.string().trim().min(1).max(100), scopes: z.array(apiScopeSchema).min(1).max(2).refine((scopes) => new Set(scopes).size === scopes.length), lifetimeDays: z.number().int().min(1).max(365) }).strict();
export const connectionIdSchema = z.string().uuid();
export const connectionPageSchema = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export const webhookCreateSchema = z.object({ name: z.string().trim().min(1).max(100), url: z.string().url().max(1000) }).strict();
export const webhookToggleSchema = z.object({ enabled: z.boolean() }).strict();
