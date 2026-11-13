import { listSortFields } from '../../core/validation/list-sort.js';
import { z } from 'zod';
import { reportQuerySchema } from './reports.schema.js';

export const exportFormatSchema = z.enum(['csv', 'xlsx', 'pdf']);
export const exportJobCreateSchema = z.object({ requestKey: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), format: exportFormatSchema, filters: reportQuerySchema }).strict();
export const exportJobIdSchema = z.string().uuid();
export const exportJobListSchema = z.object({ ...listSortFields(['id', 'createdAt', 'format', 'fileSize', 'completedAt']), page: z.coerce.number().int().min(1).max(10_000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
