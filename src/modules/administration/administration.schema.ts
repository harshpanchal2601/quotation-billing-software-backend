import { UserStatus } from '@prisma/client';
import { z } from 'zod';

import { passwordPolicySchema, usernameSchema } from '../auth/auth.schema.js';
import { ASSIGNABLE_PERMISSIONS, isAssignablePermission } from '../auth/permissions.js';

const uniquePermissionsSchema = z
  .array(z.string().refine(isAssignablePermission, 'Unknown or restricted permission'))
  .max(ASSIGNABLE_PERMISSIONS.length)
  .transform((permissions) => [...new Set(permissions)]);

export const administrationIdSchema = z.object({ id: z.coerce.number().int().positive() });

export const roleCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    permissions: uniquePermissionsSchema,
  })
  .strict();

export const roleUpdateSchema = roleCreateSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const firmUserCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(191),
    email: z.string().trim().toLowerCase().email(),
    username: usernameSchema.transform((value) => value.toLowerCase()),
    roleId: z.number().int().positive(),
    temporaryPassword: passwordPolicySchema,
  })
  .strict();

export const firmUserUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(191).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    username: usernameSchema.transform((value) => value.toLowerCase()).optional(),
    roleId: z.number().int().positive().optional(),
    status: z.nativeEnum(UserStatus).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const temporaryPasswordSchema = z.object({ temporaryPassword: passwordPolicySchema }).strict();

export type RoleCreateInput = z.infer<typeof roleCreateSchema>;
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;
export type FirmUserCreateInput = z.infer<typeof firmUserCreateSchema>;
export type FirmUserUpdateInput = z.infer<typeof firmUserUpdateSchema>;
