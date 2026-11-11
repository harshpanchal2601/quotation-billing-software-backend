import { z } from 'zod';
import { dateOnlySchema } from '../../core/validation/date-only.js';
import { listSortFields } from '../../core/validation/list-sort.js';
import { inventoryKeySchema, inventoryReasonSchema, stockCostSchema, stockQuantitySchema } from '../inventory/contract.js';

const id = z.number().int().positive();
const taxRate = z.string().regex(/^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/).default('0');
const financialLine = { description: z.string().trim().min(2).max(2000), quantity: stockQuantitySchema, unitCost: stockCostSchema, taxRate, expenseCategory: z.string().trim().min(2).max(100).optional() };
const taxMode = z.enum(['NONE', 'CGST_SGST', 'IGST']).default('NONE');
export const purchaseIdSchema = z.object({ id: z.coerce.number().int().positive() });
export const purchaseListSchema = z.object({ ...listSortFields(['id', 'orderNumber', 'supplierReference', 'reference', 'status', 'currency', 'total', 'createdAt', 'expectedDate', 'billDate', 'dueDate', 'expenseDate', 'quantity']), page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), supplierId: z.coerce.number().int().positive().optional(), from: dateOnlySchema.optional(), to: dateOnlySchema.optional() }).refine((value) => !value.from || !value.to || value.from <= value.to, 'Invalid period');
export const purchaseOrderSchema = z.object({ supplierId: id, expectedDate: dateOnlySchema.optional(), taxMode, idempotencyKey: inventoryKeySchema, lines: z.array(z.object({ ...financialLine, itemId: id }).strict()).min(1).max(100) }).strict();
export const purchaseTransitionSchema = z.object({ expectedVersion: id, reason: inventoryReasonSchema }).strict();
export const goodsReceiptSchema = z.object({ purchaseOrderId: id, expectedVersion: id, warehouseId: id.optional(), reference: z.string().trim().min(1).max(191), idempotencyKey: inventoryKeySchema, lines: z.array(z.object({ purchaseOrderLineId: id, quantity: stockQuantitySchema }).strict()).min(1).max(100) }).strict().refine((value) => new Set(value.lines.map((line) => line.purchaseOrderLineId)).size === value.lines.length, 'Receipt lines must be unique');
export const receiptReturnSchema = z.object({ receiptLineId: id, quantity: stockQuantitySchema, reason: inventoryReasonSchema, idempotencyKey: inventoryKeySchema }).strict();
export const supplierBillSchema = z.object({ supplierId: id, supplierReference: z.string().trim().min(1).max(100), billDate: dateOnlySchema, dueDate: dateOnlySchema.optional(), taxMode, idempotencyKey: inventoryKeySchema, lines: z.array(z.object({ ...financialLine, purchaseOrderLineId: id.optional(), goodsReceiptLineId: id.optional() }).strict()).min(1).max(100) }).strict().refine((value) => !value.dueDate || value.dueDate >= value.billDate, { path: ['dueDate'], message: 'Due date cannot precede bill date' });
export const expenseSchema = z.object({ supplierId: id.optional(), reference: z.string().trim().min(1).max(191), expenseDate: dateOnlySchema, category: z.string().trim().min(2).max(100), description: financialLine.description, amount: stockCostSchema, taxRate, taxMode, idempotencyKey: inventoryKeySchema }).strict();
