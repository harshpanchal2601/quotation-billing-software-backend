import { customFieldsSchema } from './automation.schema.js';

// Preserve the established billing schema and its PDF visibility semantics.
export function mapInvoiceFieldConfiguration(input: unknown) {
  const config = customFieldsSchema.parse(input);
  return config.enabled ? config.fields.map((field) => ({ key: field.key, label: field.label, type: field.type, required: field.required, options: field.options, showOnPdf: field.visibility === 'DOCUMENT', width: 'FULL' as const })) : [];
}
