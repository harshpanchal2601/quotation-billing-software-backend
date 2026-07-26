import type { ItemCategory } from '@prisma/client';
import type { CategoryFormatted, CategoryOption } from './categories.types.js';

export type CategoryWithItemCount = ItemCategory & {
  _count?: {
    items: number;
  };
};

export function serialiseCategory(category: CategoryWithItemCount): CategoryFormatted {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    isActive: category.isActive,
    linkedItemCount: category._count?.items ?? 0,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

export function serialiseCategoryOption(category: ItemCategory): CategoryOption {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
  };
}
