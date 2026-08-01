import { z } from 'zod';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

const optionalTrimmedString = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

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

export type BankDetailCreateInput = z.infer<typeof bankDetailCreateSchema>;
export type BankDetailUpdateInput = z.infer<typeof bankDetailUpdateSchema>;
