import { z } from 'zod';

export const businessPolicySchema = z.object({
  schemaVersion: z.literal(1),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'JPY', 'KWD', 'BHD']),
  rounding: z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN']),
  grandTotal: z.enum(['MINOR_UNIT', 'WHOLE_UNIT']),
  tax: z.discriminatedUnion('id', [
    z.object({ id: z.literal('none'), version: z.literal(1) }).strict(),
    z.object({ id: z.literal('india-gst'), version: z.literal(1), country: z.literal('IN'), mode: z.enum(['CGST_SGST', 'IGST']),
      rate: z.string().regex(/^(?:100(?:\.00?)?|\d{1,2}(?:\.\d{1,2})?)$/) }).strict(),
  ]),
  inAppNotifications: z.boolean(),
}).strict().superRefine((policy, context) => {
  if (policy.tax.id === 'india-gst' && policy.currency !== 'INR') context.addIssue({ code: z.ZodIssueCode.custom, path: ['currency'], message: 'The India GST adapter currently supports INR only' });
});

export type BusinessPolicy = z.infer<typeof businessPolicySchema>;
export const businessPolicyUpdateSchema = z.object({ expectedVersion: z.number().int().nonnegative(), policy: businessPolicySchema }).strict();
