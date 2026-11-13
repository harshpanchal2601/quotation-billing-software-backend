import { z } from 'zod';

export const subscriptionPolicySchema = z.object({
  trialDays: z.number().int().min(0).max(365),
  graceDays: z.number().int().min(0).max(365),
  billingCycle: z.enum(['MANUAL', 'MONTHLY', 'ANNUAL']),
  cancellationAccess: z.enum(['IMMEDIATE', 'END_OF_TERM']),
  downgradeTiming: z.enum(['IMMEDIATE', 'AT_RENEWAL']),
  retention: z.literal('RETAIN'),
  overridePrecedence: z.literal('LATEST_EFFECTIVE_REPLACEMENT'),
}).strict();

// Internal adapter for ACTIVE/SUSPENDED legacy access, never seeded as a
// commercial lifecycle policy. Tests may explicitly opt into these terms.
export const LEGACY_POLICY = {
  trialDays: 0, graceDays: 0, billingCycle: 'MANUAL', cancellationAccess: 'IMMEDIATE',
  downgradeTiming: 'IMMEDIATE', retention: 'RETAIN',
  overridePrecedence: 'LATEST_EFFECTIVE_REPLACEMENT',
} as const;
