import { z } from 'zod';
import { listSortFields } from '../../core/validation/list-sort.js';
import { commandKeySchema } from '../../core/idempotency/command-key.js';
import { positiveQuantitySchema as quantitySchema } from '../../core/validation/quantity.js';
export { commandKeySchema, quantitySchema };
export const salesIdSchema = z.object({ id: z.coerce.number().int().positive() });
export const salesListSchema = z.object({ ...listSortFields(['id', 'orderNumber', 'status', 'currency', 'createdAt']), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), companyId: z.coerce.number().int().positive().optional(), search: z.string().trim().max(191).default('') });
const detailPage = z.coerce.number().int().min(1).max(100000);
const detailSortOrder = z.enum(['asc', 'desc']).optional();
export const salesDetailSchema = z.object({
  historyPage: detailPage.default(1), historySortBy: z.enum(['id', 'version', 'status', 'actorId', 'createdAt']).optional(), historySortOrder: detailSortOrder,
  completionPage: detailPage.optional(), completionSortBy: z.enum(['id', 'reference', 'occurredAt', 'cancelledAt']).optional(), completionSortOrder: detailSortOrder,
  invoicePage: detailPage.optional(), invoiceSortBy: z.enum(['id', 'documentNumber', 'status']).optional(), invoiceSortOrder: detailSortOrder,
});
export const orderConversionSchema = z.object({ sourceRevisionId: z.number().int().positive(), idempotencyKey: commandKeySchema }).strict();
export const fulfillmentSchema = z.object({
  salesOrderId: z.number().int().positive(), expectedVersion: z.number().int().positive(), idempotencyKey: commandKeySchema,
  reference: z.string().trim().min(1).max(191), occurredAt: z.string().datetime(),
  lines: z.array(z.object({ salesOrderLineId: z.number().int().positive(), quantity: quantitySchema, warehouseId: z.number().int().positive().optional() }).strict()).min(1).max(100),
}).strict().refine((value) => new Set(value.lines.map((line) => line.salesOrderLineId)).size === value.lines.length, { path: ['lines'], message: 'Each order line must occur once' });
export const cancelSalesSchema = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(5).max(2000) }).strict();
