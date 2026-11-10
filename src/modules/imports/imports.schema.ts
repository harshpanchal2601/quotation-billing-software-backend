import { z } from 'zod';

export const importTargetSchema = z.enum(['CUSTOMERS', 'ITEMS']);
export type ImportTarget = z.infer<typeof importTargetSchema>;
export const importPreviewSchema = z.object({ target: importTargetSchema, csv: z.string().min(1).max(512_000) }).strict();
export const importCommandSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const importIdSchema = z.coerce.number().int().positive();
export const importListSchema = z.object({ page: z.coerce.number().int().positive().max(10_000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
