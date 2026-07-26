import { z } from 'zod';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}, z.boolean().optional());

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const measurementUnitListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  isActive: booleanQuerySchema,
  allowDecimal: booleanQuerySchema,
  sortBy: z.enum(['name', 'symbol', 'createdAt', 'updatedAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const measurementUnitCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(191),
    symbol: z.string().trim().min(1).max(20),
    allowDecimal: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .strict();

export const measurementUnitUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(191).optional(),
    symbol: z.string().trim().min(1).max(20).optional(),
    allowDecimal: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const measurementUnitStatusSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

export type MeasurementUnitListQuery = z.infer<typeof measurementUnitListQuerySchema>;
export type MeasurementUnitCreateInput = z.infer<typeof measurementUnitCreateSchema>;
export type MeasurementUnitUpdateInput = z.infer<typeof measurementUnitUpdateSchema>;
