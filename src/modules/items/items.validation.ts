import { ItemSourceType } from '@prisma/client';
import { z } from 'zod';

import { validateAndCleanSpecifications } from './item-specifications.js';

const decimalRegex = /^\d+(\.\d{1,2})?$/;
const hsnRegex = /^\d{4,8}$/;

export const createItemSchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(191, 'Name must not exceed 191 characters'),
  shortDescription: z
    .string()
    .trim()
    .max(500, 'Short description must not exceed 500 characters')
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
  detailedDescription: z
    .string()
    .max(20000, 'Detailed description must not exceed 20,000 characters')
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val : null)),
  specifications: z
    .unknown()
    .optional()
    .transform((val) => validateAndCleanSpecifications(val)),
  measurementUnitId: z.coerce.number().int().positive('Measurement unit ID is required'),
  defaultRate: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return '0.00';
      const numStr = String(val).trim();
      const num = Number(numStr);
      if (!Number.isFinite(num) || num < 0 || num > 999999999999.99 || !decimalRegex.test(numStr)) {
        throw new Error('Default rate must be a non-negative number with at most 2 decimal places');
      }
      return num.toFixed(2);
    }),
  hsnCode: z
    .string()
    .trim()
    .optional()
    .transform((val) => {
      if (!val || val.length === 0) return null;
      if (!hsnRegex.test(val)) {
        throw new Error('HSN code must contain between 4 and 8 numeric digits');
      }
      return val;
    }),
  gstRate: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (val === undefined || val === null || val === '') return '18.00';
      const numStr = String(val).trim();
      const num = Number(numStr);
      if (!Number.isFinite(num) || num < 0 || num > 100 || !decimalRegex.test(numStr)) {
        throw new Error('GST rate must be between 0 and 100 with at most 2 decimal places');
      }
      return num.toFixed(2);
    }),
  isActive: z.boolean().default(true),
});

export const updateItemSchema = createItemSchema.partial();

export const itemListQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    search: z
      .string()
      .trim()
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined)),
    categoryId: z.coerce.number().int().positive().optional(),
    measurementUnitId: z.coerce.number().int().positive().optional(),
    isActive: z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((val) => {
        if (val === undefined || val === '') return undefined;
        if (typeof val === 'boolean') return val;
        if (val === 'true') return true;
        if (val === 'false') return false;
        throw new Error('isActive must be a boolean');
      }),
    sourceType: z.nativeEnum(ItemSourceType).optional(),
    minRate: z.coerce.number().min(0).optional(),
    maxRate: z.coerce.number().min(0).optional(),
    sortBy: z
      .enum(['itemCode', 'name', 'defaultRate', 'gstRate', 'createdAt', 'updatedAt'])
      .default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine(
    (data) => {
      if (data.minRate !== undefined && data.maxRate !== undefined) {
        return data.minRate <= data.maxRate;
      }
      return true;
    },
    {
      message: 'minRate cannot be greater than maxRate',
      path: ['minRate'],
    },
  );

export const itemOptionsQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  categoryId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const itemStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive must be a boolean' }),
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive('Invalid item ID'),
});

export type ItemCreateInput = z.infer<typeof createItemSchema>;
export type ItemUpdateInput = z.infer<typeof updateItemSchema>;
export type ItemListQuery = z.infer<typeof itemListQuerySchema>;
export type ItemOptionsQuery = z.infer<typeof itemOptionsQuerySchema>;
export type ItemStatusInput = z.infer<typeof itemStatusSchema>;
