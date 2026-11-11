import { z } from 'zod';
import { dateOnlySchema } from '../../core/validation/date-only.js';
import { listSortFields } from '../../core/validation/list-sort.js';
import { companyCreateSchema, companyContactCreateSchema } from '../companies/contract.js';

export const OPPORTUNITY_STAGES = { NEW: 10, QUALIFIED: 25, PROPOSAL: 50, NEGOTIATION: 75, WON: 100, LOST: 0 } as const;
export const opportunityStageSchema = z.enum(['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']);
const id = z.number().int().positive();
const text = z.string().trim().min(1).max(191);
const links = { companyId: id.nullable().default(null), leadId: id.nullable().default(null) };
export const crmIdSchema = z.object({ id: z.coerce.number().int().positive() });
export const crmListSchema = z.object({
  ...listSortFields(['id', 'name', 'title', 'status', 'stage', 'email', 'phone', 'source', 'value', 'currency', 'probability', 'expectedClose', 'dueAt', 'reminderAt', 'createdAt']),
  page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(191).default(''), companyId: z.coerce.number().int().positive().optional(),
  leadId: z.coerce.number().int().positive().optional(), ownerId: z.coerce.number().int().positive().optional(),
  status: z.string().max(30).optional(), reminders: z.enum(['true', 'false']).optional(),
});
export const customerTimelineListSchema = crmListSchema.extend(listSortFields(['id', 'createdAt', 'subject', 'kind']));
export type CustomerTimelineList = z.infer<typeof customerTimelineListSchema>;

export const leadCreateSchema = z.object({ name: companyContactCreateSchema.shape.name, email: z.string().trim().toLowerCase().email().max(191).nullable().default(null), phone: z.union([companyContactCreateSchema.shape.phone, z.null()]).default(null).transform((value) => value ?? null), source: text.nullable().default(null), ownerId: id }).strict();
export const leadUpdateSchema = leadCreateSchema.partial().extend({ expectedVersion: id, status: z.enum(['NEW', 'QUALIFIED', 'CLOSED']).optional() }).strict();
export const leadConversionSchema = z.object({
  expectedVersion: id, idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
  companyId: id.optional(), newCompany: companyCreateSchema.optional(), confirmNewCompany: z.boolean().default(false),
}).strict().superRefine((input, ctx) => {
  if (Boolean(input.companyId) === Boolean(input.newCompany)) ctx.addIssue({ code: 'custom', message: 'Choose an existing company or explicitly create a new company' });
  if (input.newCompany && !input.confirmNewCompany) ctx.addIssue({ code: 'custom', path: ['confirmNewCompany'], message: 'Review duplicate suggestions and confirm the new company' });
});
export const opportunityCreateSchema = z.object({
  title: text, ...links, quotationId: id.nullable().default(null), source: text.nullable().default(null), ownerId: id,
  stage: opportunityStageSchema.default('NEW'), probability: z.number().int().min(0).max(100).optional(),
  value: z.string().regex(/^\d{1,12}(?:\.\d{1,3})?$/), currency: z.string().regex(/^[A-Z]{3}$/), expectedClose: dateOnlySchema.nullable().default(null),
}).strict();
export const opportunityUpdateSchema = opportunityCreateSchema.omit({ companyId: true, leadId: true, quotationId: true }).partial().extend({ expectedVersion: id }).strict();
const taskFields = { title: text, notes: z.string().max(10000).nullable().default(null), assignedToId: id, dueAt: z.string().datetime(), reminderAt: z.string().datetime().nullable().default(null) };
export const taskCreateSchema = z.object({ ...taskFields, ...links, opportunityId: id.nullable().default(null) }).strict().refine((input) => !input.reminderAt || new Date(input.reminderAt).getTime() <= new Date(input.dueAt).getTime(), { path: ['reminderAt'], message: 'Reminder cannot follow the due date' });
export const taskUpdateSchema = z.object({ title: text.optional(), notes: taskFields.notes.optional(), assignedToId: id.optional(), dueAt: taskFields.dueAt.optional(), reminderAt: taskFields.reminderAt.optional(), status: z.enum(['OPEN', 'DONE', 'CANCELLED']).optional(), expectedVersion: id }).strict();
export const activityCreateSchema = z.object({ ...links, opportunityId: id.nullable().default(null), kind: z.enum(['NOTE', 'CALL', 'MEETING', 'EMAIL']), subject: text, notes: z.string().max(10000).nullable().default(null) }).strict().refine((input) => input.companyId || input.leadId || input.opportunityId, 'Choose a customer, lead or opportunity');
export type CrmList = z.infer<typeof crmListSchema>;
