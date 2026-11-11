import { z } from 'zod';
import { listSortFields } from '../../core/validation/list-sort.js';
const id = z.number().int().positive();
export const PORTAL_CONSENT = 'I am authorized to record this decision for this company on the quotation revision shown.';
export const portalInviteSchema = z.object({ companyId: id, contactId: id, expiresAt: z.string().datetime() }).strict();
export const portalGrantSchema = z.object({ identityId: id, quotationId: id.optional(), invoiceId: id.optional(), salesOrderId: id.optional(), allowDecision: z.boolean().default(false), expiresAt: z.string().datetime() }).strict().superRefine((input, ctx) => {
  if ([input.quotationId, input.invoiceId, input.salesOrderId].filter(Boolean).length !== 1) ctx.addIssue({ code: 'custom', message: 'Share exactly one document' });
  if (input.allowDecision && !input.quotationId) ctx.addIssue({ code: 'custom', message: 'Only quotations support decisions' });
});
export const portalExchangeSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const portalDecisionSchema = z.object({ grantId: id, snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), decision: z.enum(['ACCEPTED', 'REJECTED']), consent: z.literal(PORTAL_CONSENT), idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/) }).strict();
export const portalListSchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), historyPage: z.coerce.number().int().min(1).max(100000).default(1), companyId: z.coerce.number().int().positive().optional() });
export const portalDocumentListSchema = portalListSchema.pick({ page: true }).extend(listSortFields(['id']));
export const portalAccessListSchema = portalListSchema.extend({
  ...listSortFields(['id', 'name', 'email']),
  identityId: z.coerce.number().int().positive().optional(),
  historySortBy: z.enum(['id', 'expiresAt']).optional(),
  historySortOrder: z.enum(['asc', 'desc']).optional(),
});
const search = z.string().trim().max(191).default('');
export const portalCompanyOptionsSchema = z.object({ search, id: z.coerce.number().int().positive().optional() }).strict();
export const portalContactOptionsSchema = z.object({ search, companyId: z.coerce.number().int().positive() }).strict();
export const portalDocumentOptionsSchema = z.object({ search, identityId: z.coerce.number().int().positive(), kind: z.enum(['quotationId', 'invoiceId', 'salesOrderId']) }).strict();
