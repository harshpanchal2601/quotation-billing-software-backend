import { listSortFields } from '../../core/validation/list-sort.js';
import { z } from 'zod';
import { dateOnlySchema } from '../../core/validation/date-only.js';
import { invoiceDraftSchema } from '../invoices/index.js';

export const scheduleConfigSchema = z.object({ template: invoiceDraftSchema, sourceDraftId: z.number().int().positive(), startDate: dateOnlySchema, endDate: dateOnlySchema.nullable(), intervalMonths: z.union([z.literal(1), z.literal(3), z.literal(12)]), dueDays: z.number().int().min(0).max(3650) }).strict();
export type ScheduleConfig = z.infer<typeof scheduleConfigSchema>;

export const scheduleIdSchema = z.object({ id: z.coerce.number().int().positive(), runId: z.coerce.number().int().positive().optional() });
export const scheduleVersionSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const scheduleCreateSchema = z.object({
  name: z.string().trim().min(1).max(191), sourceDraftId: z.number().int().positive(),
  startDate: dateOnlySchema, endDate: dateOnlySchema.nullable().default(null), intervalMonths: z.union([z.literal(1), z.literal(3), z.literal(12)]),
  dueDays: z.number().int().min(0).max(3650), idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
}).strict().refine((input) => !input.endDate || input.endDate >= input.startDate, 'End date must follow start date');
export const scheduleUpdateSchema = z.object({ expectedVersion: z.number().int().positive(), sourceDraftId: z.number().int().positive(), dueDays: z.number().int().min(0).max(3650), endDate: dateOnlySchema.nullable() }).strict();
export const scheduleApproveSchema = scheduleVersionSchema.extend({ previewToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const scheduleRetrySchema = z.object({ expectedRetryCount: z.number().int().min(0) }).strict();
export const scheduleListSchema = z.object({ ...listSortFields(['id', 'name', 'status', 'version', 'nextPeriod']), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
export type ScheduleCreateInput = z.infer<typeof scheduleCreateSchema>;
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>;
