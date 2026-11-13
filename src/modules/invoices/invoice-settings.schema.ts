import { z } from 'zod';
import { customFieldDefinitionsSchema } from './invoices.schema.js';

export const invoiceSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  registration: z.enum(['UNCONFIGURED', 'REGULAR', 'COMPOSITION', 'UNREGISTERED']),
  sellerStateCode: z.string().regex(/^\d{2}$/).nullable(),
  einvoiceRequired: z.boolean().nullable(),
  prefixes: z.object({ INVOICE: z.string().regex(/^[A-Z0-9]{1,4}$/), PROFORMA: z.string().regex(/^[A-Z0-9]{1,4}$/), CREDIT_NOTE: z.string().regex(/^[A-Z0-9]{1,4}$/), DEBIT_NOTE: z.string().regex(/^[A-Z0-9]{1,4}$/) }).strict().refine((prefixes) => new Set(Object.values(prefixes)).size === 4, 'Document prefixes must be distinct'),
  template: z.enum(['STANDARD', 'COMPACT']),
  primaryColour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  paymentInstructions: z.string().max(10000),
  termsAndConditions: z.string().max(20000),
  customFields: customFieldDefinitionsSchema,
}).strict();
export const fiscalSettingsUpdateSchema = z.object({ expectedVersion: z.number().int().nonnegative(), config: invoiceSettingsSchema.omit({ customFields: true }) }).strict();
export const invoiceFieldsUpdateSchema = z.object({ expectedVersion: z.number().int().nonnegative(), customFields: customFieldDefinitionsSchema }).strict();
export type InvoiceSettings = z.infer<typeof invoiceSettingsSchema>;
