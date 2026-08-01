import { SequenceResetRule, TaxMode } from '@prisma/client';
import { z } from 'zod';

const decimalPercentSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^(?:100(?:\.00?)?|\d{1,2}(?:\.\d{1,2})?)$/.test(value), 'GST rate must be 0 to 100 with up to two decimals');

const emptyToNull = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? null : value;

const termSchema = z.preprocess(emptyToNull, z.string().trim().max(5000).nullable().optional());

export const quotationSettingsUpdateSchema = z
  .object({
    quotationPrefix: z
      .string()
      .trim()
      .toUpperCase()
      .min(2)
      .max(30)
      .regex(/^[A-Z0-9_-]+$/)
      .optional(),
    financialYearFormat: z.literal('YYYY-YY').optional(),
    nextSequenceNumber: z.number().int().positive().optional(),
    sequenceResetRule: z.nativeEnum(SequenceResetRule).optional(),
    defaultValidityDays: z.number().int().min(1).max(365).optional(),
    defaultTaxMode: z.nativeEnum(TaxMode).optional(),
    defaultGstRate: decimalPercentSchema.optional(),
    defaultDeliveryTerms: termSchema,
    defaultDispatchTerms: termSchema,
    defaultPaymentTerms: termSchema,
    defaultFreightTerms: termSchema,
    defaultWarrantyTerms: termSchema,
    defaultRemarks: termSchema,
    defaultTermsAndConditions: termSchema,
    showBankDetails: z.boolean().optional(),
    showAmountInWords: z.boolean().optional(),
  })
  .strict();

export type QuotationSettingsUpdateInput = z.infer<typeof quotationSettingsUpdateSchema>;
