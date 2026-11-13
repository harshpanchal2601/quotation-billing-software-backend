import { z } from 'zod';
import { AppError } from '../errors/AppError.js';

export type ListSort<Field extends string = string> = { sortBy?: Field; sortOrder?: 'asc' | 'desc' };

export function listSortFields<const Fields extends [string, ...string[]]>(fields: Fields) {
  return { sortBy: z.enum(fields).optional(), sortOrder: z.enum(['asc', 'desc']).optional() };
}

// Validate before using a field name and add an ID tie-breaker before pagination.
export function listOrderBy(query: ListSort, allowed: readonly string[], fallback = 'id', defaultOrder: 'asc' | 'desc' = 'desc'): Record<string, 'asc' | 'desc'>[] {
  const field = query.sortBy ?? fallback;
  if (!allowed.includes(field)) throw new AppError('This list does not support the selected sort field', 400);
  const direction = query.sortOrder ?? defaultOrder;
  return field === 'id' ? [{ id: direction }] : [{ [field]: direction }, { id: direction }];
}
