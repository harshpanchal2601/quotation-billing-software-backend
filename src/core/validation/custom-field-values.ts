import { AppError } from '../errors/AppError.js';
import { dateOnlySchema } from './date-only.js';

type Field = { key: string; label: string; type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT'; required: boolean; options: readonly string[] };
export function validateCustomFieldValues(fields: readonly Field[], input: Record<string, string | boolean | null>, requireComplete: boolean) {
  const known = new Set(fields.map((field) => field.key));
  const values: Record<string, string | boolean | null> = {};
  for (const key of Object.keys(input)) if (!known.has(key)) throw new AppError(`Unknown custom field: ${key}`, 400);
  for (const field of fields) {
    const value = input[field.key];
    if (value === undefined || value === null || value === '') {
      if (field.required && requireComplete) throw new AppError(`${field.label} is required`, 400);
      values[field.key] = null; continue;
    }
    const valid = field.type === 'BOOLEAN' ? typeof value === 'boolean' : typeof value === 'string' && (
      field.type === 'TEXT' && value.length <= 4000 || field.type === 'NUMBER' && /^-?\d{1,18}(?:\.\d{1,6})?$/.test(value) ||
      field.type === 'DATE' && dateOnlySchema.safeParse(value).success || field.type === 'SELECT' && field.options.includes(value));
    if (!valid) throw new AppError(`Invalid value for ${field.label}`, 400);
    values[field.key] = value;
  }
  return values;
}
