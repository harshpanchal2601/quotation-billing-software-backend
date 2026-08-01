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

export type BusinessProfileUpdateInput = z.infer<typeof businessProfileUpdateSchema>;
