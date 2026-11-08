import { z } from 'zod';
import { dateOnlySchema as calendarDateSchema } from '../../core/validation/date-only.js';
import { commandKeySchema as inventoryKeySchema } from '../../core/idempotency/command-key.js';
import { positiveQuantitySchema as stockQuantitySchema } from '../../core/validation/quantity.js';
export { inventoryKeySchema, stockQuantitySchema };

const id = z.number().int().positive();
export const inventoryIdSchema = z.object({ id: z.coerce.number().int().positive() });
const nonnegativeQuantity = z.string().regex(/^\d{1,9}(?:\.\d{1,3})?$/);
export const stockCostSchema = z.string().regex(/^\d{1,15}(?:\.\d{1,3})?$/);
export const inventoryReasonSchema = z.string().trim().min(5).max(2000);
export const inventoryListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  warehouseId: z.coerce.number().int().positive().optional(), itemId: z.coerce.number().int().positive().optional(),
  salesOrderId: z.coerce.number().int().positive().optional(),
  from: calendarDateSchema.optional(), to: calendarDateSchema.optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, 'Invalid period');
export const warehouseSchema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,50}$/), name: z.string().trim().min(2).max(191) }).strict();
export const warehouseSearchSchema = z.object({ search: z.string().trim().max(191).default('') });
export const stockAdjustmentSchema = z.object({ warehouseId: id, itemId: id, direction: z.enum(['IN', 'OUT']), quantity: stockQuantitySchema, unitCost: stockCostSchema.optional(), reason: inventoryReasonSchema, idempotencyKey: inventoryKeySchema }).strict().refine((value) => value.direction !== 'IN' || value.unitCost !== undefined, { path: ['unitCost'], message: 'Inbound adjustments require an explicit cost' });
export const stockTransferSchema = z.object({ fromWarehouseId: id, toWarehouseId: id, itemId: id, quantity: stockQuantitySchema, reason: inventoryReasonSchema, idempotencyKey: inventoryKeySchema }).strict().refine((value) => value.fromWarehouseId !== value.toWarehouseId, 'Warehouses must differ');
export const stockReturnSchema = z.object({ originalMovementId: id, quantity: stockQuantitySchema, reason: inventoryReasonSchema, idempotencyKey: inventoryKeySchema }).strict();
export const stockReservationSchema = z.object({ salesOrderId: id, salesOrderLineId: id, warehouseId: id, quantity: stockQuantitySchema, idempotencyKey: inventoryKeySchema }).strict();
export const stockReleaseSchema = z.object({ reason: inventoryReasonSchema }).strict();
export const reorderSchema = z.object({ warehouseId: id, itemId: id, quantity: nonnegativeQuantity }).strict();
