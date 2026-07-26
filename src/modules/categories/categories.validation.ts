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

export const categoryListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  isActive: booleanQuerySchema,
  sortBy: z.enum(['name', 'slug', 'createdAt', 'updatedAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const categoryCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(191),
    description: z.preprocess(
      emptyToUndefined,
      z.string().transform((val) => val.trim()).pipe(z.string().max(5000)).optional(),
    ),
    isActive: z.boolean().default(true),
  })
  .strict();

export const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(191).optional(),
    description: z.preprocess(
      emptyToUndefined,
      z.string().transform((val) => val.trim()).pipe(z.string().max(5000)).nullable().optional(),
    ),
    isActive: z.boolean().optional(),
  })
  .strict();

export const categoryStatusSchema = z
  .object({
    isActive: z.boolean(),
  })
  .strict();

export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>;
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
