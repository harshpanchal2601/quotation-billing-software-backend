import { z } from 'zod';
import { AppError } from '../../core/errors/AppError.js';
import { parseCsv } from '../../core/serialization/csv.js';
import { companyImportSchema } from '../companies/index.js';
import { itemImportSchema } from '../items/index.js';
import type { ImportTarget } from './imports.schema.js';

const columns = {
  CUSTOMERS: ['externalId', 'name', 'legalName', 'gstin', 'pan', 'website', 'notes'],
  ITEMS: ['externalId', 'name', 'categoryId', 'measurementUnitId', 'defaultRate', 'gstRate', 'hsnCode', 'kind', 'shortDescription'],
} as const;
const externalId = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/);
const amount = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/);

export function normalizeImport(target: ImportTarget, raw: Record<string, string>) {
  const identifier = externalId.parse(raw.externalId);
  const values = Object.fromEntries(Object.entries(raw).filter(([key, value]) => key !== 'externalId' && value !== ''));
  if (target === 'CUSTOMERS') return { identifier, data: companyImportSchema.parse(values) };
  amount.parse(raw.defaultRate || '0');
  amount.parse(raw.gstRate || '18');
  return { identifier, data: itemImportSchema.parse(values) };
}

export function importRecords(target: ImportTarget, csv: string) {
  const [header, ...rows] = parseCsv(csv);
  if (!header || !rows.length || !header.includes('externalId') || !header.includes('name') ||
      (target === 'ITEMS' && !header.includes('measurementUnitId')) ||
      new Set(header).size !== header.length || header.some((name) => !(columns[target] as readonly string[]).includes(name))) throw new AppError('Use the documented CSV headers and at least one data row', 400);
  if (rows.some((row) => row.length !== header.length)) throw new AppError('CSV rows must match the header column count', 400);
  return rows.map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ''])));
}
