import { z } from 'zod';
import { approvalCommandSchema } from '../automation/contract.js';
import { dateOnlySchema } from '../../core/validation/date-only.js';
import { listSortFields } from '../../core/validation/list-sort.js';
import { CURRENCY_SCALES } from '../../core/money/index.js';

export const assistantIdSchema = z.string().uuid();
const id = z.number().int().positive();
const page = z.coerce.number().int().min(1).max(100000).default(1);
const currency = z.string().refine((value) => Object.hasOwn(CURRENCY_SCALES, value), 'Unsupported currency');
export const resourceSchema = z.enum(['CUSTOMERS', 'ITEMS', 'QUOTATIONS', 'INVOICES', 'ORDERS', 'PAYMENTS', 'AUDIT']);
export const searchToolSchema = z.object({ tool: z.literal('SEARCH'), resource: resourceSchema, query: z.string().trim().max(191).default(''), page, ...listSortFields(['id']) }).strict();
export const toolPlanSchema = z.discriminatedUnion('tool', [
  searchToolSchema,
  z.object({ tool: z.literal('OUTSTANDING'), companyId: id.optional(), currency: currency.optional(), page }).strict(),
  z.object({ tool: z.literal('SALES'), dateFrom: dateOnlySchema.optional(), dateTo: dateOnlySchema.optional(), currency: currency.optional() }).strict(),
  z.object({ tool: z.literal('DRAFT'), kind: z.enum(['QUOTATION', 'INVOICE', 'FOLLOW_UP', 'EMAIL']), companyId: id, itemIds: z.array(id).max(25).default([]) }).strict(),
  z.object({ tool: z.literal('CLARIFY'), message: z.string().min(1).max(500) }).strict(),
]).superRefine((input, context) => {
  if (input.tool === 'SALES' && input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Date range is reversed' });
});
export type ToolPlan = z.infer<typeof toolPlanSchema>;
export const chatSchema = z.object({ requestId: assistantIdSchema, conversationId: assistantIdSchema.optional(), message: z.string().trim().min(1).max(4000), mode: z.enum(['AUTO', 'LOCAL', 'LLM']).default('AUTO'), plan: toolPlanSchema.optional() }).strict();
export type ChatInput = z.infer<typeof chatSchema>;
export const settingsSchema = z.object({ expectedVersion: z.number().int().nonnegative(), llmEnabled: z.boolean(), dailyLlmRequests: z.number().int().min(1).max(1000000).nullable(), retainContentDays: z.number().int().min(1).max(365).nullable(), consent: z.literal(true) }).strict().refine((input) => !input.llmEnabled || input.dailyLlmRequests !== null, 'Set a daily LLM request limit before enabling it');
export const proposalSchema = z.object({ conversationId: assistantIdSchema, mode: z.enum(['LOCAL', 'LLM']), command: approvalCommandSchema }).strict().refine((input) => input.command.action !== 'QUOTATION_SEND' || input.command.status !== undefined, 'Send emails from the normal quotation screen');
export const confirmationSchema = z.object({ confirm: z.literal(true), nonce: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const historyQuerySchema = z.object({ page, ...listSortFields(['createdAt', 'id']) }).strict();
export const extractionSchema = z.object({ source: z.enum(['PDF_TEXT', 'EMAIL_TEXT']), text: z.string().trim().min(1).max(30000) }).strict();
