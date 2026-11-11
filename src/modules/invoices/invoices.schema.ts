import { z } from 'zod';
import { dateOnlySchema } from '../../core/validation/date-only.js';
export { dateOnlySchema } from '../../core/validation/date-only.js';

export const documentKinds = ['INVOICE', 'PROFORMA', 'CREDIT_NOTE', 'DEBIT_NOTE'] as const;
const amount = z.string().regex(/^\d{1,12}(?:\.\d{1,3})?$/, 'Use a non-negative decimal string with up to three decimal places');
const quantity = z.string().regex(/^\d{1,9}(?:\.\d{1,3})?$/).refine((v) => /[1-9]/.test(v), 'Quantity must be positive');
export const taxRateSchema = z.string().regex(/^(?:100(?:\.00?)?|\d{1,2}(?:\.\d{1,2})?)$/);
export const customFieldDefinitionSchema = z.object({
  key: z.string().regex(/^cf_[a-z][a-z0-9_]{0,44}$/, 'Use a stable cf_ key with lowercase letters, numbers and underscores'),
  label: z.string().trim().min(1).max(100),
  type: z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT']),
  required: z.boolean(),
  showOnPdf: z.boolean(),
  width: z.enum(['FULL', 'HALF']),
  options: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
}).strict().superRefine((field, ctx) => {
  if (field.type === 'SELECT' && (field.options.length < 1 || new Set(field.options).size !== field.options.length)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Select fields require unique options' });
  }
  if (field.type !== 'SELECT' && field.options.length !== 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Only select fields accept options' });
});
export const customFieldDefinitionsSchema = z.array(customFieldDefinitionSchema).max(50).superRefine((fields, ctx) => {
  if (new Set(fields.map((field) => field.key)).size !== fields.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Field keys must be unique' });
});
export const customFieldValuesSchema = z.record(z.union([z.string().max(4000), z.boolean(), z.null()]));
export const invoiceLineSchema = z.object({
  itemId: z.number().int().positive().nullable().optional(),
  itemName: z.string().trim().min(1).max(191).optional(),
  description: z.string().max(10000).nullable().optional(),
  hsnCode: z.string().regex(/^\d{4}(?:\d{2})?(?:\d{2})?$/).nullable().optional(),
  supplyType: z.enum(['GOODS', 'SERVICE']).default('GOODS'),
  measurementUnit: z.string().trim().min(1).max(50).default('NOS'),
  quantity,
  unitRate: amount,
  discountType: z.enum(['NONE', 'PERCENTAGE', 'FIXED']).default('NONE'),
  discountValue: amount.default('0'),
  taxRate: taxRateSchema,
  sourceLineNumber: z.number().int().positive().optional(),
}).strict().superRefine((line, ctx) => {
  if (!line.itemId && !line.itemName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['itemName'], message: 'Describe the goods or service' });
});
export const supplySchema = z.object({
  isExempt: z.boolean().default(false),
  placeOfSupplyStateCode: z.string().regex(/^\d{2}$/),
  placeOfSupplyBasis: z.enum(['GOODS_MOVEMENT', 'BILL_TO_SHIP_TO', 'SERVICES_GENERAL', 'MANUALLY_CONFIRMED']),
  explanation: z.string().trim().max(1000).default(''),
}).strict().superRefine((supply, ctx) => {
  if (supply.placeOfSupplyBasis === 'MANUALLY_CONFIRMED' && !supply.explanation) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['explanation'], message: 'Explain the applicable place-of-supply rule' });
});
const draftFields = {
  companyId: z.number().int().positive(),
  billingAddressId: z.number().int().positive(),
  shippingAddressId: z.number().int().positive().nullable().optional(),
  invoiceDate: dateOnlySchema,
  dueDate: dateOnlySchema.nullable().optional(),
  customerReference: z.string().trim().max(191).nullable().optional(),
  paymentTerms: z.string().max(10000).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  supply: supplySchema,
  customFieldValues: customFieldValuesSchema.default({}),
  lines: z.array(invoiceLineSchema).min(1).max(100),
};
export const invoiceDraftSchema = z.object({ ...draftFields, idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/) }).strict().superRefine((draft, ctx) => {
  if (draft.dueDate && draft.dueDate < draft.invoiceDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'Due date cannot precede document date' });
});
export const invoiceUpdateSchema = z.object({ ...draftFields, expectedVersion: z.number().int().positive(), refreshCustomFields: z.boolean().default(false) }).strict().superRefine((draft, ctx) => {
  if (draft.dueDate && draft.dueDate < draft.invoiceDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'Due date cannot precede document date' });
});
export const issueSchema = z.object({ expectedVersion: z.number().int().positive(), confirmedTotal: amount }).strict();
export const voidSchema = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(5).max(2000), notReportedAndSupplyCancelled: z.literal(true) }).strict();
export const conversionSchema = z.object({ sourceRevisionId: z.number().int().positive(), idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/), supply: supplySchema, customFieldValues: customFieldValuesSchema.default({}), lineMetadata: z.array(z.object({ lineNumber: z.number().int().positive(), hsnCode: z.string().regex(/^\d{4}(?:\d{2})?(?:\d{2})?$/).nullable(), supplyType: z.enum(['GOODS', 'SERVICE']) }).strict()).max(100) }).strict();
export const proformaConversionSchema = z.object({ idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/) }).strict();
export const adjustmentSchema = z.object({
  sourceInvoiceId: z.number().int().positive(), kind: z.enum(['CREDIT_NOTE', 'DEBIT_NOTE']),
  reason: z.string().trim().min(5).max(2000), idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
  // Credit-note issuance records the actor's eligibility confirmation; it never files a return.
  gstReductionEligible: z.boolean(), annualReturnFiledAt: dateOnlySchema.nullable(),
  recipientItcReversalConfirmed: z.boolean(),
  lines: z.array(z.object({ sourceLineNumber: z.number().int().positive(), quantity, unitRate: amount }).strict()).min(1).max(100),
  customFieldValues: customFieldValuesSchema.default({}),
}).strict();
export const invoiceListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(191).optional(), status: z.enum(['DRAFT', 'ISSUED', 'VOID']).optional(),
  companyId: z.coerce.number().int().positive().optional(), dateFrom: dateOnlySchema.optional(), dateTo: dateOnlySchema.optional(),
  sortBy: z.enum(['id', 'createdAt', 'invoiceDate', 'grandTotal', 'documentNumber']).default('createdAt'), sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export const idSchema = z.object({ id: z.coerce.number().int().positive(), documentId: z.coerce.number().int().positive().optional() });
export const optionQuerySchema = z.object({ search: z.string().trim().max(191).default(''), limit: z.coerce.number().int().min(1).max(100).default(30) });
export const customerOptionQuerySchema = optionQuerySchema.extend({ selectedId: z.coerce.number().int().positive().optional() });
export type CustomFieldDefinition = z.infer<typeof customFieldDefinitionSchema>;
export const orderInvoiceSchema = z.object({
  salesOrderId: z.number().int().positive(), idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
  supply: supplySchema, customFieldValues: customFieldValuesSchema.default({}),
  lines: z.array(z.object({ salesOrderLineId: z.number().int().positive(), quantity, hsnCode: z.string().regex(/^\d{4}(?:\d{2})?(?:\d{2})?$/).nullable(), supplyType: z.enum(['GOODS', 'SERVICE']) }).strict()).min(1).max(100),
}).strict().refine((input) => new Set(input.lines.map((line) => line.salesOrderLineId)).size === input.lines.length, { path: ['lines'], message: 'Each order line must occur once' });
export type InvoiceDraftInput = z.infer<typeof invoiceDraftSchema>;
export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;
export type SupplyInput = z.infer<typeof supplySchema>;
export type InvoiceListInput = z.infer<typeof invoiceListSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
