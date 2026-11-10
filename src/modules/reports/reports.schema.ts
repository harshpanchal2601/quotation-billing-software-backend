import { z } from 'zod';
import { dateOnlySchema } from '../../core/validation/date-only.js';
import { dateWindow } from '../../core/validation/date-window.js';
import { localeSchema, languageSchema, timezoneSchema } from '../../core/localization/presentation.js';

export const REPORT_SECTIONS = ['quotations', 'sales', 'receivables', 'pipeline', 'stock', 'purchaseOrders', 'supplierBills', 'expenses'] as const;
export const reportSectionSchema = z.enum(REPORT_SECTIONS);
export const reportQuerySchema = z.object({
  dateFrom: dateOnlySchema,
  dateTo: dateOnlySchema,
  locale: localeSchema.optional(),
  language: languageSchema.optional(),
  timezone: timezoneSchema.optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).toUpperCase().optional(),
  sections: z.preprocess((value) => typeof value === 'string' ? value.split(',') : value,
    z.array(reportSectionSchema).min(1).max(REPORT_SECTIONS.length).refine((values) => new Set(values).size === values.length, 'Duplicate report section').default([...REPORT_SECTIONS])),
}).strict().superRefine((input, ctx) => {
  const { from, through } = dateWindow(input.dateFrom, input.dateTo);
  if (from > through) ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'End date must be on or after start date' });
  if (through.getTime() - from.getTime() > 731 * 86_400_000) ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'Report range cannot exceed two years' });
});
export const savedViewCreateSchema = z.object({
  name: z.string().trim().min(1).max(100), filters: reportQuerySchema,
}).strict();
export const savedViewUpdateSchema = savedViewCreateSchema.extend({ expectedVersion: z.number().int().positive() });
export const savedViewIdSchema = z.string().uuid();
export const savedViewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportSectionKey = z.infer<typeof reportSectionSchema>;
