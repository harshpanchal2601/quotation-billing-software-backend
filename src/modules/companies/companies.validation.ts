import { AddressType, QuotationStatus } from '@prisma/client';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

const optionalTrimmedString = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max).optional());

const nullableText = (max: number) => optionalTrimmedString(max);

const phoneSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d][+\d\s()/-]{5,29}$/, 'Invalid phone number')
    .optional(),
);

const websiteSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().url().regex(/^https?:\/\//, 'Website must use http or https').optional(),
);

const gstinSchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN')
    .optional(),
);

const panSchema = z.preprocess(
  emptyToUndefined,
  z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN').optional(),
);

const sortOrderSchema = z.enum(['asc', 'desc']);

const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}, z.boolean().optional());

const paginationSchema = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
};

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const companyChildParamSchema = z.object({
  companyId: z.coerce.number().int().positive(),
});

export const companyContactParamSchema = companyChildParamSchema.extend({
  contactId: z.coerce.number().int().positive(),
});

export const companyAddressParamSchema = companyChildParamSchema.extend({
  addressId: z.coerce.number().int().positive(),
});

export const companyListQuerySchema = z.object({
  ...paginationSchema,
  search: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  isActive: booleanQuerySchema,
  sortBy: z.enum(['companyCode', 'name', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: sortOrderSchema.default('desc'),
});

export const companyContactCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(191),
    designation: optionalTrimmedString(191),
    email: z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().email().optional()),
    phone: phoneSchema,
    alternatePhone: phoneSchema,
    isPrimary: z.boolean().default(false),
  })
  .strict();

export const companyContactUpdateSchema = companyContactCreateSchema.partial().strict();

export const companyAddressCreateSchema = z
  .object({
    addressType: z.nativeEnum(AddressType),
    addressLine1: z.string().trim().min(2).max(191),
    addressLine2: optionalTrimmedString(191),
    city: optionalTrimmedString(191),
    state: optionalTrimmedString(191),
    postalCode: optionalTrimmedString(20),
    country: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(191).default('India')),
    isPrimary: z.boolean().default(false),
  })
  .strict();

export const companyAddressUpdateSchema = companyAddressCreateSchema.partial().strict();

export const companyCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(191),
    legalName: optionalTrimmedString(191),
    gstin: gstinSchema,
    pan: panSchema,
    website: websiteSchema,
    notes: nullableText(5000),
    isActive: z.boolean().default(true),
    contacts: z.array(companyContactCreateSchema).optional(),
    addresses: z.array(companyAddressCreateSchema).optional(),
  })
  .strict();

export const companyUpdateSchema = companyCreateSchema
  .omit({ contacts: true, addresses: true })
  .partial()
  .strict();

export const companyStatusSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

export const quotationHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
    status: z.nativeEnum(QuotationStatus).optional(),
    dateFrom: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
    dateTo: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
    sortOrder: sortOrderSchema.default('desc'),
  })
  .refine(
    (value) =>
      value.dateFrom === undefined ||
      value.dateTo === undefined ||
      value.dateFrom.getTime() <= value.dateTo.getTime(),
    { message: 'dateFrom cannot be later than dateTo', path: ['dateFrom'] },
  );

export type CompanyCreateInput = z.infer<typeof companyCreateSchema>;
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;
export type CompanyListQuery = z.infer<typeof companyListQuerySchema>;
export type CompanyContactCreateInput = z.infer<typeof companyContactCreateSchema>;
export type CompanyContactUpdateInput = z.infer<typeof companyContactUpdateSchema>;
export type CompanyAddressCreateInput = z.infer<typeof companyAddressCreateSchema>;
export type CompanyAddressUpdateInput = z.infer<typeof companyAddressUpdateSchema>;
export type QuotationHistoryQuery = z.infer<typeof quotationHistoryQuerySchema>;
