import { z } from 'zod';
import { dateOnlySchema } from '../../core/validation/date-only.js';
import { dateWindow } from '../../core/validation/date-window.js';
const account = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/);
export const accountingMappingSchema = z.object({ receivables: account, sales: account, outputTax: account, rounding: account }).strict();
export const accountingMappingCommandSchema = z.object({ expectedVersion: z.number().int().min(0), mapping: accountingMappingSchema }).strict();
export const accountingExportSchema = z.object({ dateFrom: dateOnlySchema, dateTo: dateOnlySchema, mappingVersion: z.coerce.number().int().positive() }).strict().superRefine((value, context) => {
  const window = dateWindow(value.dateFrom, value.dateTo);
  if (window.from >= window.until || window.until.getTime() - window.from.getTime() > 366 * 86_400_000) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a valid period of at most 366 days', path: ['dateTo'] });
});
export type AccountingMapping = z.infer<typeof accountingMappingSchema>;
