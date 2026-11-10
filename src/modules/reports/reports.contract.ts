import { z } from 'zod';
import { presentationSchema } from '../../core/localization/presentation.js';
import { reportSectionSchema } from './reports.schema.js';

const metric = z.object({ key: z.string().max(100), label: z.string().max(300), currency: z.string().max(3).nullable(), dimension: z.string().max(300).nullable(), value: z.string().regex(/^-?\d+(?:\.\d+)?$/), unit: z.enum(['MONEY', 'COUNT', 'PERCENT', 'VALUATION']) }).strict();
const section = z.discriminatedUnion('status', [
  z.object({ key: reportSectionSchema, status: z.literal('UNAVAILABLE') }).strict(),
  z.object({ key: reportSectionSchema, status: z.literal('AVAILABLE'), data: z.object({ source: z.string().max(300), basis: z.string().max(2000), dateBasis: z.enum(['PERIOD', 'CURRENT', 'CLOSING']), asOf: z.string().max(100), timezone: z.string().max(100), scope: z.enum(['FIRM', 'OWNED_OR_CREATED']), metrics: z.array(metric).max(10_000) }).strict() }).strict(),
]);
export const reportSnapshotSchema = z.object({ schemaVersion: z.literal(1), firmId: z.number().int().positive(), generatedAt: z.string().datetime(), dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), currency: z.string().max(3).nullable(), currencyPolicy: z.literal('SEGMENTED_NO_CONVERSION'), sections: z.array(section).min(1).max(8), localizationSnapshot: presentationSchema.optional() }).strict();
