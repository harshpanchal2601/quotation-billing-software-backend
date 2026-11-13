import { z } from 'zod';

// Exact wire quantities shared by order, stock and purchasing commands.
export const positiveQuantitySchema = z.string().regex(/^\d{1,9}(?:\.\d{1,3})?$/).refine((value) => /[1-9]/.test(value), 'Quantity must be positive');
