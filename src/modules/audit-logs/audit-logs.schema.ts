import { AuditAction } from '@prisma/client';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? undefined : value;

export const auditLogListSchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    action: z.nativeEnum(AuditAction).optional(),
    entityType: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
    userId: z.coerce.number().int().positive().optional(),
    dateFrom: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
    dateTo: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
  })
  .refine(
    (value) =>
      value.dateFrom === undefined ||
      value.dateTo === undefined ||
      value.dateFrom.getTime() <= value.dateTo.getTime(),
    { message: 'dateFrom cannot be later than dateTo', path: ['dateFrom'] },
  );

export type AuditLogListQuery = z.infer<typeof auditLogListSchema>;
