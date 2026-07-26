import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9._-]+$/, 'Username may contain letters, numbers, dots, underscores and hyphens');

export const passwordPolicySchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((password) => password === password.trim(), 'Password must not contain leading or trailing spaces')
  .refine((password) => /[A-Z]/.test(password), 'Password must contain an uppercase letter')
  .refine((password) => /[a-z]/.test(password), 'Password must contain a lowercase letter')
  .refine((password) => /\d/.test(password), 'Password must contain a number')
  .refine((password) => /[^A-Za-z0-9]/.test(password), 'Password must contain a special character');

export const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordPolicySchema,
    confirmPassword: z.string().min(1),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'New password and confirmation do not match',
    path: ['confirmPassword'],
  });

export const initialAdminSeedSchema = z.object({
  name: z.string().trim().min(1, 'INITIAL_ADMIN_NAME is required'),
  email: z.string().trim().email('INITIAL_ADMIN_EMAIL must be a valid email'),
  username: usernameSchema,
  password: passwordPolicySchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type InitialAdminSeedInput = z.infer<typeof initialAdminSeedSchema>;
