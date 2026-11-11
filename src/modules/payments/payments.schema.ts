import { z } from 'zod';
import { dateOnlySchema } from '../../core/validation/date-only.js';
import { listSortFields } from '../../core/validation/list-sort.js';

export const requestKeySchema = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
export const paymentAmountSchema = z.string().regex(/^\d{1,21}(?:\.\d{1,3})?$/).refine((value) => /[1-9]/.test(value), 'Amount must be positive');
export const paymentCurrencySchema = z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'JPY', 'KWD', 'BHD']);
const allocations = z.array(z.object({ invoiceId: z.number().int().positive(), amount: paymentAmountSchema }).strict()).max(100).refine((rows) => new Set(rows.map((row) => row.invoiceId)).size === rows.length, 'Select each invoice once');
export const recordPaymentSchema = z.object({
  companyId: z.number().int().positive(), amount: paymentAmountSchema, currency: paymentCurrencySchema,
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'EXTERNAL_CONFIRMED']), reference: z.string().trim().max(191).nullable().default(null),
  receivedDate: dateOnlySchema, confirmed: z.literal(true), idempotencyKey: requestKeySchema, allocations: allocations.default([]),
}).strict().superRefine((value, ctx) => {
  if (value.method !== 'CASH' && !value.reference) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reference'], message: 'A confirmed external receipt requires its reference' });
});
export const allocatePaymentSchema = z.object({ idempotencyKey: requestKeySchema, allocations: allocations.refine((rows) => rows.length > 0, 'Select an invoice') }).strict();
export const reversePaymentSchema = z.object({ idempotencyKey: requestKeySchema, reason: z.string().trim().min(5).max(2000) }).strict();
export const refundPaymentSchema = z.object({ idempotencyKey: requestKeySchema, amount: paymentAmountSchema, paidDate: dateOnlySchema, reference: z.string().trim().min(1).max(191), reason: z.string().trim().min(5).max(2000), confirmed: z.literal(true) }).strict();
export const paymentListSchema = z.object({ ...listSortFields(['id', 'reference', 'receivedDate', 'amount', 'currency', 'createdAt', 'documentNumber', 'dueDate', 'grandTotal']), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), companyId: z.coerce.number().int().positive().optional(), currency: paymentCurrencySchema.optional(), search: z.string().trim().max(191).optional() });
export const receivablesQuerySchema = paymentListSchema.extend({ ...listSortFields(['id', 'documentNumber', 'companyName', 'dueDate', 'currency', 'outstanding']), overdueOnly: z.enum(['true', 'false']).default('false') });
export const paymentIdSchema = z.object({ id: z.coerce.number().int().positive() });
export const paymentCustomerQuerySchema = z.object({ search: z.string().trim().max(191).default(''), id: z.coerce.number().int().positive().optional() });
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type AllocatePaymentInput = z.infer<typeof allocatePaymentSchema>;
export type ReversePaymentInput = z.infer<typeof reversePaymentSchema>;
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
export type PaymentListInput = z.infer<typeof paymentListSchema>;
export type ReceivablesQuery = z.infer<typeof receivablesQuerySchema>;
