import { z } from 'zod';
import { AppError } from '../../core/errors/AppError.js';
import { dateOnlySchema, type CustomFieldDefinition } from './invoices.schema.js';

export function validateCustomFieldValues(fields: readonly CustomFieldDefinition[], input: Record<string, string | boolean | null>, requireComplete: boolean) {
  const known = new Set(fields.map((field) => field.key));
  const values: Record<string, string | boolean | null> = {};
  for (const key of Object.keys(input)) if (!known.has(key)) throw new AppError(`Unknown custom field: ${key}`, 400);
  for (const field of fields) {
    const value = input[field.key];
    if (value === undefined || value === null || value === '') {
      if (field.required && requireComplete) throw new AppError(`${field.label} is required`, 400);
      values[field.key] = null;
      continue;
    }
    let valid: boolean;
    switch (field.type) {
      case 'BOOLEAN': valid = typeof value === 'boolean'; break;
      case 'NUMBER': valid = typeof value === 'string' && /^-?\d{1,18}(?:\.\d{1,6})?$/.test(value); break;
      case 'DATE': valid = dateOnlySchema.safeParse(value).success; break;
      case 'SELECT': valid = typeof value === 'string' && field.options.includes(value); break;
      case 'TEXT': valid = z.string().max(4000).safeParse(value).success; break;
    }
    if (!valid) throw new AppError(`Invalid value for ${field.label}`, 400);
    values[field.key] = value;
  }
  return values;
}
