import { FirmStatus } from '@prisma/client';
import { z } from 'zod';

import { passwordPolicySchema, usernameSchema } from '../auth/auth.schema.js';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

export const platformFirmIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const platformFirmListSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.preprocess(emptyToUndefined, z.string().trim().max(191).optional()),
  status: z.nativeEnum(FirmStatus).optional(),
});

export const platformFirmCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(191),
    slug: z.string().trim().toLowerCase().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    legalName: z.string().trim().min(2).max(191),
    displayName: z.string().trim().min(2).max(191),
    addressLine1: z.string().trim().min(1).max(191),
    addressLine2: z.preprocess(emptyToUndefined, z.string().trim().max(191).optional()),
    city: z.string().trim().min(1).max(191),
    state: z.string().trim().min(1).max(191),
    postalCode: z.string().trim().min(1).max(20),
    country: z.string().trim().min(1).max(191).default('India'),
    primaryEmail: z.string().trim().toLowerCase().email(),
    primaryPhone: z.preprocess(emptyToUndefined, z.string().trim().max(30).optional()),
    quotationPrefix: z.string().trim().toUpperCase().min(2).max(30).regex(/^[A-Z0-9_-]+$/).optional(),
    adminName: z.string().trim().min(2).max(191),
    adminEmail: z.string().trim().toLowerCase().email(),
    adminUsername: usernameSchema.transform((value) => value.toLowerCase()),
    temporaryPassword: passwordPolicySchema,
  })
  .strict();

export const platformFirmUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(191).optional(),
    slug: z.string().trim().toLowerCase().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const platformFirmStatusSchema = z.object({ status: z.nativeEnum(FirmStatus) }).strict();

export const platformAdminPasswordSchema = z.object({ temporaryPassword: passwordPolicySchema }).strict();

export type PlatformFirmCreateInput = z.infer<typeof platformFirmCreateSchema>;
export type PlatformFirmUpdateInput = z.infer<typeof platformFirmUpdateSchema>;
export type PlatformFirmListQuery = z.infer<typeof platformFirmListSchema>;
