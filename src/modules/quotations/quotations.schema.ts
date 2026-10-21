import { DiscountType, QuotationStatus, TaxMode } from '@prisma/client';
import { z } from 'zod';

import {
  isValidDateOnly,
  isValidUntilBeforeQuotationDate,
  VALID_UNTIL_DATE_MESSAGE,
} from './quotation-dates.js';

const decimalNumberSchema = z.union([z.number(), z.string()]).refine(
  (val) => {
    if (val === '' || val === null || val === undefined) return true;
    const num = Number(val);
    return Number.isFinite(num);
  },
  { message: 'Must be a valid numeric value' },
);

const positiveDecimalNumberSchema = decimalNumberSchema.refine((val) => Number(val) > 0, {
  message: 'Must be greater than zero',
});

const nonNegativeDecimalNumberSchema = decimalNumberSchema.refine((val) => Number(val) >= 0, {
  message: 'Cannot be negative',
});

export const itemInputSchema = z.object({
  itemId: z.number().int().positive().optional().nullable(),
  lineNumber: z.number().int().positive().optional(),
  itemName: z.string().trim().max(191).optional(),
  description: z.string().max(20000).optional().nullable(),
  specifications: z.unknown().optional(),
  measurementUnit: z.string().trim().max(50).optional(),
  quantity: positiveDecimalNumberSchema.default(1),
  unitRate: positiveDecimalNumberSchema,
  discountType: z.nativeEnum(DiscountType).default(DiscountType.NONE),
  discountValue: nonNegativeDecimalNumberSchema.default(0),
  gstRate: nonNegativeDecimalNumberSchema
    .refine((val) => Number(val) <= 100, { message: 'GST rate must be between 0 and 100' })
    .default(18),
  sortOrder: z.number().int().min(0).default(0),
}).superRefine((item, ctx) => {
  if (!item.itemId && !item.itemName?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['itemName'],
      message: 'Item name is required when no master item is selected',
    });
  }

  if (item.discountType === DiscountType.PERCENTAGE && Number(item.discountValue) > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['discountValue'],
      message: 'Percentage discount cannot exceed 100',
    });
  }
});

export const calculationPreviewSchema = z.object({
  currency: z.string().trim().length(3).toUpperCase().default('INR'),
  taxMode: z.nativeEnum(TaxMode).default(TaxMode.CGST_SGST),
  quotationDiscountType: z.nativeEnum(DiscountType).default(DiscountType.NONE),
  quotationDiscountValue: nonNegativeDecimalNumberSchema.default(0),
  freightAmount: nonNegativeDecimalNumberSchema.default(0),
  otherCharges: nonNegativeDecimalNumberSchema.default(0),
  items: z
    .array(itemInputSchema)
    .min(1, 'At least 1 item is required')
    .max(100, 'Quotation cannot exceed 100 line items'),
});

const quotationBaseSchema = z.object({
  companyId: z.number().int().positive('Company is required'),
  companyContactId: z.number().int().positive().optional().nullable(),
  billingAddressId: z.number().int().positive().optional().nullable(),
  shippingAddressId: z.number().int().positive().optional().nullable(),
  quotationDate: z.string().refine(isValidDateOnly, { message: 'Valid quotation date is required' }),
  validUntil: z
    .string()
    .optional()
    .nullable()
    .refine((val) => val === null || val === undefined || isValidDateOnly(val), {
      message: 'ValidUntil must be a valid date',
    }),
  customerReference: z.string().trim().max(191).optional().nullable(),
  internalReference: z.string().trim().max(191).optional().nullable(),
  currency: z.string().trim().length(3).toUpperCase().default('INR'),
  taxMode: z.nativeEnum(TaxMode).default(TaxMode.CGST_SGST),
  quotationDiscountType: z.nativeEnum(DiscountType).default(DiscountType.NONE),
  quotationDiscountValue: nonNegativeDecimalNumberSchema.default(0),
  freightAmount: nonNegativeDecimalNumberSchema.default(0),
  otherCharges: nonNegativeDecimalNumberSchema.default(0),
  deliveryTerms: z.string().optional().nullable(),
  dispatchTerms: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  taxTerms: z.string().optional().nullable(),
  freightTerms: z.string().optional().nullable(),
  warrantyTerms: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  items: z
    .array(itemInputSchema)
    .min(1, 'At least 1 item is required')
    .max(100, 'Quotation cannot exceed 100 line items'),
});

export const quotationCreateSchema = quotationBaseSchema.superRefine((values, ctx) => {
  if (
    values.validUntil &&
    isValidDateOnly(values.quotationDate) &&
    isValidDateOnly(values.validUntil) &&
    isValidUntilBeforeQuotationDate(values.validUntil, values.quotationDate)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['validUntil'],
      message: VALID_UNTIL_DATE_MESSAGE,
    });
  }
});

export const quotationUpdateSchema = quotationBaseSchema.partial().extend({
  items: z
    .array(itemInputSchema)
    .min(1, 'At least 1 item is required')
    .max(100, 'Quotation cannot exceed 100 line items')
    .optional(),
});

export const quotationStatusSchema = z.object({
  status: z.nativeEnum(QuotationStatus, { required_error: 'Status is required' }),
  comment: z.string().trim().max(2000).optional().nullable(),
});

export const quotationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  companyId: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(QuotationStatus).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  minTotal: z.coerce.number().min(0).optional(),
  maxTotal: z.coerce.number().min(0).optional(),
  sortBy: z
    .enum(['quotationNumber', 'quotationDate', 'validUntil', 'grandTotal', 'createdAt', 'updatedAt'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive('Invalid quotation ID'),
});
