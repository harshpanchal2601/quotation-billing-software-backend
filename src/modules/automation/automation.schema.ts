import { z } from 'zod';
import { listSortFields } from '../../core/validation/list-sort.js';
import { validateCustomFieldValues } from '../../core/validation/custom-field-values.js';
import { commandKeySchema } from '../../core/idempotency/command-key.js';
import { positiveQuantitySchema } from '../../core/validation/quantity.js';
import { validatePlaceholders } from '../../core/templates/placeholders.js';
import { APPROVAL_ACTIONS, TRIGGERS, TRIGGER_ENTITY } from './automation.contract.js';

const id = z.number().int().positive();
const amount = z.string().regex(/^\d{1,18}(?:\.\d{1,6})?$/);
const percentage = z.string().regex(/^(?:100(?:\.0{1,6})?|\d{1,2}(?:\.\d{1,6})?)$/);
const template = z.string().max(10000).superRefine((value, ctx) => {
  try { validatePlaceholders(value); } catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use supported plain-text placeholders only' }); }
});
export const definitionKindSchema = z.enum(['WORKFLOW', 'APPROVAL', 'TEMPLATE', 'CUSTOM_FIELDS', 'NOTIFICATION']);
export const definitionKeySchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
export const automationEventSchema = z.object({
  trigger: z.enum(TRIGGERS), entity: z.enum(['INVOICE', 'SALES_ORDER', 'STOCK_OPERATION', 'QUOTATION']), entityId: id,
  documentNumber: z.string().max(191), status: z.string().max(32), currency: z.string().regex(/^[A-Z]{3}$/),
  total: z.string().regex(/^\d{1,24}(?:\.\d{1,30})?$/), discountPercent: z.string().regex(/^\d{1,24}(?:\.\d{1,30})?$/), businessName: z.string().max(191),
  notice: z.object({ versionId: id, heading: template, footer: template }).strict().optional(),
}).strict().refine((event) => TRIGGER_ENTITY[event.trigger] === event.entity, 'Trigger and entity must agree');
export type AutomationEvent = z.infer<typeof automationEventSchema>;
export const predicateSchema = z.object({
  field: z.enum(['trigger', 'status', 'currency', 'total', 'discountPercent']),
  operator: z.enum(['EQ', 'NE', 'GTE', 'LTE']), value: z.string().max(191),
}).strict().superRefine((predicate, ctx) => {
  if (['GTE', 'LTE'].includes(predicate.operator) && !['total', 'discountPercent'].includes(predicate.field)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ordered comparison requires a numeric field' });
  if (['total', 'discountPercent'].includes(predicate.field) && !amount.safeParse(predicate.value).success) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Numeric predicates require decimal strings' });
});
const stepId = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const stepSchema = z.discriminatedUnion('type', [
  z.object({ id: stepId, type: z.literal('TEST'), predicate: predicateSchema, yes: stepId, no: stepId }).strict(),
  z.object({ id: stepId, type: z.literal('NOTIFY'), title: template.pipe(z.string().min(1).max(191)), body: template.pipe(z.string().min(1).max(5000)), recipientIds: z.array(id).min(1).max(20).refine((ids) => new Set(ids).size === ids.length), next: stepId }).strict(),
  z.object({ id: stepId, type: z.literal('STOP') }).strict(),
]);
export const workflowSchema = z.object({
  enabled: z.boolean(), name: z.string().trim().min(1).max(100), trigger: z.enum(TRIGGERS),
  delayMinutes: z.number().int().min(0).max(43200), expiresAfterMinutes: z.number().int().min(1).max(86400),
  entry: stepId, steps: z.array(stepSchema).min(1).max(32),
}).strict().superRefine((definition, ctx) => {
  const nodes = new Map(definition.steps.map((step) => [step.id, step]));
  if (nodes.size !== definition.steps.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Step IDs must be unique' });
  const visited = new Set<string>(); const active = new Set<string>();
  const visit = (key: string) => {
    if (active.has(key)) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Workflow cycles are forbidden' }); return; }
    if (visited.has(key)) return;
    const step = nodes.get(key);
    if (!step) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Workflow transition targets a missing step' }); return; }
    active.add(key); visited.add(key);
    for (const next of step.type === 'TEST' ? [step.yes, step.no] : step.type === 'NOTIFY' ? [step.next] : []) visit(next);
    active.delete(key);
  };
  visit(definition.entry);
  if (visited.size !== nodes.size) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Every step must be reachable' });
  if (definition.expiresAfterMinutes <= definition.delayMinutes) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expiry must follow the reminder delay' });
  if (definition.steps.filter((step) => step.type === 'NOTIFY').length > 4) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At most four notification actions are allowed per run' });
});
export type WorkflowDefinition = z.infer<typeof workflowSchema>;
export const approvalPolicySchema = z.object({
  enabled: z.boolean(), action: z.enum(APPROVAL_ACTIONS), expiresAfterHours: z.number().int().min(1).max(720),
  minimumAmount: amount.optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), discountPercent: percentage.optional(),
  authority: z.literal('OTHER_FIRM_ADMIN'),
}).strict().superRefine((policy, ctx) => {
  if ((policy.minimumAmount !== undefined) !== (policy.currency !== undefined)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount thresholds require a currency' });
  if (policy.discountPercent !== undefined && !['INVOICE_ISSUE', 'QUOTATION_SEND'].includes(policy.action)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Discount thresholds apply to quotation send or invoice issue' });
  if (policy.action === 'STOCK_ADJUST' && policy.minimumAmount !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Stock adjustments require unconditional approval; valuation stays in Inventory' });
});
export const documentTemplateSchema = z.object({
  enabled: z.boolean(), entity: z.enum(['QUOTATION', 'INVOICE', 'NOTICE']),
  heading: template, footer: template, primaryColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).strict();
export const customFieldSchema = z.object({
  key: z.string().regex(/^cf_[a-z][a-z0-9_]{0,44}$/), label: z.string().trim().min(1).max(100),
  type: z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT']), required: z.boolean(),
  searchable: z.boolean(), visibility: z.enum(['INTERNAL', 'DOCUMENT']), classification: z.literal('BUSINESS'),
  options: z.array(z.string().trim().min(1).max(100)).max(50),
}).strict().superRefine((field, ctx) => {
  if (field.type === 'SELECT' ? !field.options.length || new Set(field.options).size !== field.options.length : field.options.length !== 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only select fields accept unique nonempty options' });
  if (field.visibility === 'DOCUMENT' && field.searchable) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Document fields are excluded from search' });
});
export const customFieldsSchema = z.object({
  enabled: z.boolean(), entity: z.enum(['COMPANY', 'ITEM', 'QUOTATION', 'INVOICE']),
  fields: z.array(customFieldSchema).max(50).refine((fields) => new Set(fields.map((field) => field.key)).size === fields.length, 'Field keys must be unique'),
}).strict().superRefine((configuration, ctx) => {
  if (['COMPANY', 'ITEM'].includes(configuration.entity) && configuration.fields.some((field) => field.visibility === 'DOCUMENT')) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Company and item fields are internal; use quotation or invoice fields for document output' });
});
export const publishDefinitionSchema = z.object({ expectedVersion: z.number().int().nonnegative(), definition: z.unknown() }).strict();
export function parseDefinition(kind: z.infer<typeof definitionKindSchema>, key: string, input: unknown) {
  switch (kind) {
    case 'WORKFLOW': return workflowSchema.parse(input);
    case 'NOTIFICATION': {
      const rule = workflowSchema.parse(input);
      if (rule.steps.filter((step) => step.type === 'NOTIFY').length !== 1 || rule.steps.some((step) => step.type === 'TEST')) throw new Error('A notification rule requires exactly one notification and a stop');
      return rule;
    }
    case 'APPROVAL': {
      const policy = approvalPolicySchema.parse(input);
      if (key !== policy.action) throw new Error('Approval key must match its action');
      return policy;
    }
    case 'TEMPLATE': {
      const value = documentTemplateSchema.parse(input);
      if (key !== value.entity) throw new Error('Template key must match its entity');
      return value;
    }
    case 'CUSTOM_FIELDS': {
      const value = customFieldsSchema.parse(input);
      if (key !== value.entity) throw new Error('Custom-field key must match its entity');
      return value;
    }
  }
}
const invoiceCommand = { entityId: id, expectedVersion: id };
export const approvalCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('INVOICE_ISSUE'), ...invoiceCommand, confirmedTotal: amount }).strict(),
  z.object({ action: z.literal('CREDIT_NOTE_ISSUE'), ...invoiceCommand, confirmedTotal: amount }).strict(),
  z.object({ action: z.literal('INVOICE_VOID'), ...invoiceCommand, reason: z.string().trim().min(5).max(2000), notReportedAndSupplyCancelled: z.literal(true) }).strict(),
  z.object({ action: z.literal('ORDER_CONFIRM'), entityId: id, idempotencyKey: commandKeySchema }).strict(),
  z.object({ action: z.literal('QUOTATION_SEND'), entityId: id, status: z.enum(['SENT', 'ACCEPTED']).optional(), comment: z.string().max(2000).nullable().optional() }).strict(),
  z.object({ action: z.literal('STOCK_ADJUST'), entityId: id, warehouseId: id, direction: z.enum(['IN', 'OUT']), quantity: positiveQuantitySchema,
    unitCost: z.string().regex(/^\d{1,15}(?:\.\d{1,3})?$/).optional(), reason: z.string().trim().min(5).max(2000), idempotencyKey: commandKeySchema }).strict(),
]);
export type ApprovalCommand = z.infer<typeof approvalCommandSchema>;
export const decisionSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED', 'REVOKED', 'CANCELLED']), reason: z.string().trim().min(5).max(2000) }).strict();
export const preferenceSchema = z.object({
  enabled: z.boolean(), utcOffsetMinutes: z.number().int().min(-720).max(840),
  quietStartMinute: z.number().int().min(0).max(1439).nullable(), quietEndMinute: z.number().int().min(0).max(1439).nullable(),
}).strict().refine((value) => (value.quietStartMinute === null) === (value.quietEndMinute === null) && (value.quietStartMinute === null || value.quietStartMinute !== value.quietEndMinute), 'Select both distinct quiet-hour boundaries, or neither');
export const customValuesSchema = z.record(z.union([z.string().max(4000), z.boolean(), z.null()]));
export function validateFieldValues(fields: z.infer<typeof customFieldSchema>[], input: z.infer<typeof customValuesSchema>) {
  return validateCustomFieldValues(fields, input, true);
}

export const automationVersionListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  ...listSortFields(['id', 'version', 'publishedAt', 'publishedById']),
});
export const workflowRunListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  ...listSortFields(['id', 'createdAt', 'expiresAt', 'status', 'actorId']),
});

export const approvalListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  ...listSortFields(['id', 'createdAt', 'expiresAt', 'status', 'requesterId']),
});
