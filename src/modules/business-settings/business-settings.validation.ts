import { SequenceResetRule, TaxMode } from '@prisma/client';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

const optionalTrimmedString = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const phoneSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .regex(/^[+\d][+\d\s-]{5,29}$/, 'Invalid phone number')
    .optional(),
);

const hexColourSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Colour must be a six-digit hexadecimal value')
  .transform((value) => value.toUpperCase());

export const businessProfileUpdateSchema = z
  .object({
    legalName: z.string().trim().min(2).max(191).optional(),
    displayName: z.string().trim().min(2).max(191).optional(),
    gstin: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN')
        .optional(),
    ),
    pan: z.preprocess(
      emptyToUndefined,
      z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN').optional(),
    ),
    cin: optionalTrimmedString(30).transform((value) => value?.toUpperCase()),
    addressLine1: z.string().trim().min(1).max(191).optional(),
    addressLine2: optionalTrimmedString(191),
    city: z.string().trim().min(1).max(191).optional(),
    state: z.string().trim().min(1).max(191).optional(),
    postalCode: z.string().trim().min(1).max(20).optional(),
    country: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(191).optional()),
    primaryPhone: phoneSchema,
    secondaryPhone: phoneSchema,
    primaryEmail: z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().email().optional()),
    secondaryEmail: z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().email().optional()),
    website: z.preprocess(
      emptyToUndefined,
      z.string().trim().url().regex(/^https?:\/\//, 'Website must use http or https').optional(),
    ),
    primaryColour: hexColourSchema.optional(),
    secondaryColour: hexColourSchema.optional(),
    defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  })
  .strict();

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

const bankAccountSchema = z
  .string()
  .trim()
  .min(3)
  .max(50)
  .regex(/^[A-Za-z0-9 -]+$/, 'Invalid account number');

const ifscMessage = 'Enter a valid 11-character IFSC code, for example BARB0AHMEDA.';

export const bankDetailCreateSchema = z
  .object({
    bankName: z.string().trim().min(2).max(191),
    accountName: z.string().trim().min(2).max(191),
    accountNumber: bankAccountSchema,
    accountType: optionalTrimmedString(50),
    ifscCode: z.preprocess(
      emptyToUndefined,
      z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, ifscMessage).optional(),
    ),
    branchName: optionalTrimmedString(191),
    swiftCode: z.preprocess(
      emptyToUndefined,
      z.string().trim().toUpperCase().regex(/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/, 'Invalid SWIFT code').optional(),
    ),
    upiId: z.preprocess(
      emptyToUndefined,
      z.string().trim().toLowerCase().regex(/^[a-z0-9.\-_]{2,}@[a-z][a-z0-9.\-_]{2,}$/, 'Invalid UPI ID').optional(),
    ),
    isDefault: z.boolean().default(false),
  })
  .strict();

export const bankDetailUpdateSchema = bankDetailCreateSchema.partial().strict();

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export type BusinessProfileUpdateInput = z.infer<typeof businessProfileUpdateSchema>;
export type QuotationSettingsUpdateInput = z.infer<typeof quotationSettingsUpdateSchema>;
export type BankDetailCreateInput = z.infer<typeof bankDetailCreateSchema>;
export type BankDetailUpdateInput = z.infer<typeof bankDetailUpdateSchema>;
