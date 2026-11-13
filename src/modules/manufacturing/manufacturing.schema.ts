import { z } from 'zod';
import { listSortFields } from '../../core/validation/list-sort.js';
import { positiveQuantitySchema } from '../../core/validation/quantity.js';
import { commandKeySchema } from '../../core/idempotency/command-key.js';

const id = z.number().int().positive();
export const bomCreateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,49}$/),
  name: z.string().trim().min(1).max(191),
  outputItemId: id, outputQuantity: positiveQuantitySchema,
  components: z.array(z.object({ itemId: id, quantity: positiveQuantitySchema }).strict()).min(1).max(100),
  idempotencyKey: commandKeySchema,
}).strict().superRefine((input, ctx) => {
  if (new Set(input.components.map((line) => line.itemId)).size !== input.components.length) ctx.addIssue({ code: 'custom', path: ['components'], message: 'Each component item must appear once' });
  if (input.components.some((line) => line.itemId === input.outputItemId)) ctx.addIssue({ code: 'custom', path: ['components'], message: 'The output cannot consume itself' });
});
export const workOrderCreateSchema = z.object({ bomId: id, warehouseId: id, quantity: positiveQuantitySchema, idempotencyKey: commandKeySchema }).strict();
export const workOrderActionSchema = z.object({ expectedVersion: id, idempotencyKey: commandKeySchema, reason: z.string().trim().min(5).max(2000) }).strict();
export const manufacturingListSchema = z.object({ ...listSortFields(['id', 'code', 'name', 'revision', 'outputQuantity', 'status', 'quantity', 'createdAt']), page: z.coerce.number().int().positive().max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().max(191).default('') }).strict();
export const manufacturingIdSchema = z.coerce.number().int().positive();
const snapshotItem = z.object({ itemId: id, unitId: id, name: z.string(), unit: z.string(), quantity: positiveQuantitySchema }).strict();
export const workOrderSnapshotSchema = z.object({ bomCode: z.string(), bomRevision: id, output: snapshotItem, components: z.array(snapshotItem.extend({ lineId: id })).min(1).max(100) }).strict();
