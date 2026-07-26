import type { ItemCategory, Prisma, PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { AppError } from '../../utils/AppError.js';
import { createAuditLog, pickChangedFields, type RequestMetadata } from '../../utils/auditLog.js';
import {
  serialiseCategory,
  serialiseCategoryOption,
  type CategoryWithItemCount,
} from './categories.serializer.js';
import { createPaginationMetadata } from './categories.types.js';
import type {
  CategoryCreateInput,
  CategoryListQuery,
  CategoryUpdateInput,
} from './categories.validation.js';

const UNCATEGORISED_SLUG = 'uncategorised';

const categoryAuditFields = ['name', 'description', 'isActive'] as const;

const categoryDetailInclude = {
  _count: {
    select: {
      items: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.ItemCategoryInclude;

export function generateBaseSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug.length > 0 ? slug : 'category';
}

export class CategoriesService {
  constructor(private readonly db: PrismaClient) {}

  async listCategories(query: CategoryListQuery) {
    const where: Prisma.ItemCategoryWhereInput = {
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search === undefined ? {} : createCategorySearchFilter(query.search)),
    };

    const [categories, total] = await this.db.$transaction([
      this.db.itemCategory.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: categoryDetailInclude,
      }),
      this.db.itemCategory.count({ where }),
    ]);

    return {
      categories: categories.map(serialiseCategory),
      pagination: createPaginationMetadata(query.page, query.limit, total),
    };
  }

  async getCategoryOptions() {
    const categories = await this.db.itemCategory.findMany({
      where: {
        deletedAt: null,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });

    return {
      categories: categories.map(serialiseCategoryOption),
    };
  }

  async createCategory(input: CategoryCreateInput, metadata: RequestMetadata) {
    const existingName = await this.db.itemCategory.findFirst({
      where: { name: input.name },
    });

    if (existingName !== null) {
      throw new AppError('Category with this name already exists', 409);
    }

    const slug = await this.generateUniqueSlug(input.name);

    const category = await this.db.itemCategory.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        isActive: input.isActive,
      },
      include: categoryDetailInclude,
    });

    await this.auditCategory(AuditAction.CREATE, category, metadata);
    return serialiseCategory(category);
  }

  async getCategory(id: number) {
    const category = await this.getExistingCategoryRecord(id);
    return serialiseCategory(category);
  }

  async updateCategory(id: number, input: CategoryUpdateInput, metadata: RequestMetadata) {
    const existing = await this.getExistingCategoryRecord(id);

    if (existing.slug === UNCATEGORISED_SLUG && input.isActive === false) {
      throw new AppError('The default Uncategorised category cannot be deactivated or deleted.', 409);
    }

    if (input.name !== undefined && input.name !== existing.name) {
      const duplicate = await this.db.itemCategory.findFirst({
        where: { name: input.name, NOT: { id } },
      });
      if (duplicate !== null) {
        throw new AppError('Category with this name already exists', 409);
      }
    }

    const updateData: Prisma.ItemCategoryUpdateInput = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description ?? null }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    };

    if (Object.keys(updateData).length === 0 || !hasCategoryChanges(existing, updateData)) {
      return serialiseCategory(existing);
    }

    const updated = await this.db.itemCategory.update({
      where: { id },
      data: updateData,
      include: categoryDetailInclude,
    });

    await this.auditCategory(AuditAction.UPDATE, updated, metadata, existing);
    return serialiseCategory(updated);
  }

  async updateCategoryStatus(id: number, isActive: boolean, metadata: RequestMetadata) {
    const existing = await this.getExistingCategoryRecord(id);

    if (existing.slug === UNCATEGORISED_SLUG && isActive === false) {
      throw new AppError('The default Uncategorised category cannot be deactivated or deleted.', 409);
    }

    if (existing.isActive === isActive) {
      return serialiseCategory(existing);
    }

    const updated = await this.db.itemCategory.update({
      where: { id },
      data: { isActive },
      include: categoryDetailInclude,
    });

    await this.auditCategory(AuditAction.STATUS_CHANGE, updated, metadata, existing);
    return serialiseCategory(updated);
  }

  async deleteCategory(id: number, metadata: RequestMetadata) {
    const existing = await this.getExistingCategoryRecord(id);

    if (existing.slug === UNCATEGORISED_SLUG) {
      throw new AppError('The default Uncategorised category cannot be deactivated or deleted.', 409);
    }

    const linkedItemsCount = await this.db.item.count({
      where: { categoryId: id, deletedAt: null },
    });

    if (linkedItemsCount > 0) {
      throw new AppError('Category cannot be deleted because items are linked to it.', 409);
    }

    await this.db.itemCategory.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    await this.auditCategory(AuditAction.DELETE, existing, metadata);
  }

  async restoreCategory(id: number, metadata: RequestMetadata) {
    const existing = await this.db.itemCategory.findFirst({
      where: { id, deletedAt: { not: null } },
    });

    if (existing === null) {
      throw new AppError('Category not found', 404);
    }

    const conflict = await this.db.itemCategory.findFirst({
      where: {
        OR: [{ name: existing.name }, { slug: existing.slug }],
        deletedAt: null,
        NOT: { id },
      },
    });

    if (conflict !== null) {
      throw new AppError('Cannot restore category because its name or slug conflicts with an existing category.', 409);
    }

    const restored = await this.db.itemCategory.update({
      where: { id },
      data: {
        deletedAt: null,
        isActive: true,
      },
      include: categoryDetailInclude,
    });

    await this.auditCategory(AuditAction.RESTORE, restored, metadata, existing);
    return serialiseCategory(restored);
  }

  private async getExistingCategoryRecord(id: number): Promise<CategoryWithItemCount> {
    const category = await this.db.itemCategory.findFirst({
      where: { id, deletedAt: null },
      include: categoryDetailInclude,
    });

    if (category === null) {
      throw new AppError('Category not found', 404);
    }

    return category;
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const baseSlug = generateBaseSlug(name);
    let candidate = baseSlug;
    let suffix = 2;

    while (suffix <= 100) {
      const existing = await this.db.itemCategory.findFirst({
        where: { slug: candidate },
        select: { id: true },
      });

      if (existing === null) {
        return candidate;
      }

      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    return `${baseSlug}-${Date.now()}`;
  }

  private async auditCategory(
    action: AuditAction,
    category: ItemCategory,
    metadata: RequestMetadata,
    previous?: ItemCategory,
  ) {
    const changed = previous
      ? pickChangedFields(
          previous as unknown as Record<string, unknown>,
          category as unknown as Record<string, unknown>,
          [...categoryAuditFields],
        )
      : undefined;

    await createAuditLog(this.db, {
      metadata,
      entityType: 'ItemCategory',
      entityId: String(category.id),
      action,
      oldValues: changed?.oldValues,
      newValues: changed?.newValues ?? {
        name: category.name,
        slug: category.slug,
        isActive: category.isActive,
      },
    });
  }
}

function createCategorySearchFilter(search: string): Prisma.ItemCategoryWhereInput {
  return {
    OR: [
      { name: { contains: search } },
      { slug: { contains: search.toLowerCase() } },
      { description: { contains: search } },
    ],
  };
}

function hasCategoryChanges(existing: ItemCategory, data: Prisma.ItemCategoryUpdateInput) {
  return Object.entries(data).some(([key, value]) => existing[key as keyof ItemCategory] !== value);
}
