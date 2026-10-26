import { z } from 'zod';
import { isFeatureKey, QUOTA_KEYS, subscriptionPolicySchema } from '../entitlements/contract.js';

const reason = z.string().trim().min(10).max(500);
const integerLimitPattern = /^(0|[1-9]\d{0,18})$/;
const limit = z.string().regex(integerLimitPattern, 'Limit must be a nonnegative integer string')
  .refine((value) => !integerLimitPattern.test(value) || BigInt(value) <= 9223372036854775807n, 'Limit is too large');
function isValidUserLimit(value: string | null) {
  // Zod may run object refinements after a field has a validation issue.
  // Validate the integer contract before either field or object conversion.
  return value !== null && limit.safeParse(value).success && BigInt(value) >= 1n && BigInt(value) <= 2147483647n;
}
const money = z.string().regex(/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const identifier = z.string().trim().min(8).max(191);
export const platformPageSchema = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
export const platformAuditQuerySchema = platformPageSchema.extend({ firmId: z.coerce.number().int().positive().optional() });
export const platformUsageQuerySchema = z.object({ firmId: z.coerce.number().int().positive() }).strict();
export const platformFirmSubscriptionQuerySchema = z.object({
  subscriptions: z.coerce.number().int().positive().default(1),
  overrides: z.coerce.number().int().positive().default(1),
  charges: z.coerce.number().int().positive().default(1),
}).strict();
export const platformVersionIdSchema = z.object({ id: z.coerce.number().int().positive(), versionId: z.coerce.number().int().positive() });
export const platformOverrideIdSchema = z.object({ id: z.coerce.number().int().positive(), overrideId: z.coerce.number().int().positive() });
export const platformChargeIdSchema = z.object({ id: z.coerce.number().int().positive(), chargeId: z.coerce.number().int().positive() });
export const platformFeatureKeySchema = z.object({ key: z.string().refine(isFeatureKey, 'Unknown feature') });
export const featureSwitchSchema = z.object({ hardDisabled: z.boolean(), reason }).strict();
export const planCreateSchema = z.object({ name: z.string().trim().min(2).max(191), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(100), reason }).strict();
export const planUpdateSchema = z.object({ name: z.string().trim().min(2).max(191), archived: z.boolean(), reason }).strict();
export const planVersionSchema = z.object({
  features: z.array(z.string().min(1).max(100)).max(100),
  quotas: z.object({ users: limit, documents: limit.nullable(), storageBytes: limit.nullable(), aiCredits: limit.nullable() }).strict(),
  policy: subscriptionPolicySchema.nullable(),
  price: money.nullable(), currency: currency.nullable(), reason,
}).strict().superRefine((input, context) => {
  if ((input.price === null) !== (input.currency === null)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Price and currency must be supplied together' });
  if (!isValidUserLimit(input.quotas.users)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['quotas', 'users'], message: 'User quota must be between 1 and 2147483647' });
});
export const reasonSchema = z.object({ reason }).strict();
export const planPublishSchema = z.object({ reason, previewToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const subscriptionAssignmentSchema = z.object({
  planVersionId: z.number().int().positive(), expectedSubscriptionId: z.number().int().positive().nullable(),
  status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'SUSPENDED']),
  effectiveFrom: z.coerce.date(), effectiveUntil: z.coerce.date().nullable(),
  trialEndsAt: z.coerce.date().nullable(), graceEndsAt: z.coerce.date().nullable(),
  currentPeriodEndsAt: z.coerce.date().nullable(), renewalAt: z.coerce.date().nullable(), reason,
}).strict().refine((input) => input.effectiveUntil === null || input.effectiveUntil > input.effectiveFrom, 'Access end must follow its start');
export const firmOverrideSchema = z.object({
  target: z.string().refine((value) => value.startsWith('feature:') ? isFeatureKey(value.slice(8)) :
    value.startsWith('quota:') && (QUOTA_KEYS as readonly string[]).includes(value.slice(6)), 'Unknown override target'),
  effect: z.enum(['ALLOW', 'DENY', 'LIMIT']), limit: limit.nullable(),
  startsAt: z.coerce.date(), expiresAt: z.coerce.date().nullable(), reason,
}).strict().superRefine((input, context) => {
  if ((input.target.startsWith('quota:')) !== (input.effect === 'LIMIT')) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Quota overrides require LIMIT; feature overrides require ALLOW or DENY' });
  if (input.effect !== 'LIMIT' && input.limit !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Feature overrides cannot set a quota' });
  if (input.target === 'quota:users' && !isValidUserLimit(input.limit)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'User overrides require a finite positive user quota' });
  if (input.expiresAt !== null && input.expiresAt <= input.startsAt) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Override expiry must follow its start' });
});
export const platformChargeSchema = z.object({ idempotencyKey: identifier, amount: money.refine((value) => !/^0(?:\.0{1,2})?$/.test(value), 'Amount must be positive'), currency, reason }).strict();
export const platformPaymentSchema = z.object({ idempotencyKey: identifier, kind: z.enum(['PAYMENT', 'REFUND']), amount: money.refine((value) => !/^0(?:\.0{1,2})?$/.test(value), 'Amount must be positive'), reference: z.string().trim().min(1).max(191), reason }).strict();

export type PlanVersionInput = z.infer<typeof planVersionSchema>;
export type SubscriptionAssignmentInput = z.infer<typeof subscriptionAssignmentSchema>;
export type FirmOverrideInput = z.infer<typeof firmOverrideSchema>;
export type PlatformChargeInput = z.infer<typeof platformChargeSchema>;
export type PlatformPaymentInput = z.infer<typeof platformPaymentSchema>;
