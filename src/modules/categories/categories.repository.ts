import type { ItemCategory, Prisma, PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { createAuditLog, pickChangedFields, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { createPaginationMetadata } from './categories.types.js';
import {
  serialiseCategory,
  serialiseCategoryOption,
  type CategoryWithItemCount,
} from './categories.serializer.js';
import type {
  CategoryCreateInput,
  CategoryListQuery,
  CategoryUpdateInput,
} from './categories.schema.js';

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

export class CategoriesRepository {
  constructor(private readonly db: PrismaClient) {}

  async listCategories(firmId: number, query: CategoryListQuery) {
    const where: Prisma.ItemCategoryWhereInput = {
      firmId,
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

  async getCategoryOptions(firmId: number) {
    const categories = await this.db.itemCategory.findMany({
      where: {
        firmId,
        deletedAt: null,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });

    return {
      categories: categories.map(serialiseCategoryOption),
    };
  }

  async findCategoryByName(firmId: number, name: string) {
    return this.db.itemCategory.findFirst({
      where: { firmId, name },
    });
  }

  async findCategoryById(firmId: number, id: number): Promise<CategoryWithItemCount | null> {
    return this.db.itemCategory.findFirst({
      where: { id, firmId, deletedAt: null },
      include: categoryDetailInclude,
    });
  }

  async findDeletedCategoryById(firmId: number, id: number) {
    return this.db.itemCategory.findFirst({
      where: { id, firmId, deletedAt: { not: null } },
    });
  }

  async findRestoreConflict(firmId: number, id: number, name: string, slug: string) {
    return this.db.itemCategory.findFirst({
      where: {
        firmId,
        OR: [{ name }, { slug }],
        deletedAt: null,
        NOT: { id },
      },
    });
  }

  async countLinkedItems(firmId: number, id: number) {
    return this.db.item.count({
      where: { firmId, categoryId: id, deletedAt: null },
    });
  }

  async generateUniqueSlug(firmId: number, name: string): Promise<string> {
    const baseSlug = generateBaseSlug(name);
    let candidate = baseSlug;
    let suffix = 2;

    while (suffix <= 100) {
      const existing = await this.db.itemCategory.findFirst({
        where: { firmId, slug: candidate },
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

  async createCategory(
    firmId: number,
    input: CategoryCreateInput & { slug: string },
    metadata: RequestMetadata,
  ) {
    const category = await this.db.itemCategory.create({
      data: {
        firmId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        isActive: input.isActive,
      },
      include: categoryDetailInclude,
    });

    await this.auditCategory(AuditAction.CREATE, category, metadata);
    return serialiseCategory(category);
  }

  async updateCategory(
    id: number,
    input: CategoryUpdateInput,
    metadata: RequestMetadata,
    previous: ItemCategory,
  ) {
    const updateData: Prisma.ItemCategoryUpdateInput = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description ?? null }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    };

    const updated = await this.db.itemCategory.update({
      where: { id },
      data: updateData,
      include: categoryDetailInclude,
    });

    await this.auditCategory(AuditAction.UPDATE, updated, metadata, previous);
    return serialiseCategory(updated);
  }

  async updateCategoryStatus(
    id: number,
    isActive: boolean,
    metadata: RequestMetadata,
    previous: ItemCategory,
  ) {
    const updated = await this.db.itemCategory.update({
      where: { id },
      data: { isActive },
      include: categoryDetailInclude,
    });

    await this.auditCategory(AuditAction.STATUS_CHANGE, updated, metadata, previous);
    return serialiseCategory(updated);
  }

  async deleteCategory(id: number, metadata: RequestMetadata, previous: ItemCategory) {
    await this.db.itemCategory.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    await this.auditCategory(AuditAction.DELETE, previous, metadata);
  }

  async restoreCategory(
    id: number,
    metadata: RequestMetadata,
    previous: ItemCategory,
  ) {
    const restored = await this.db.itemCategory.update({
      where: { id },
      data: {
        deletedAt: null,
        isActive: true,
      },
      include: categoryDetailInclude,
    });

    await this.auditCategory(AuditAction.RESTORE, restored, metadata, previous);
    return serialiseCategory(restored);
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

export const categoriesRepository = new CategoriesRepository(prisma);

function createCategorySearchFilter(search: string): Prisma.ItemCategoryWhereInput {
  return {
    OR: [
      { name: { contains: search } },
      { slug: { contains: search.toLowerCase() } },
      { description: { contains: search } },
    ],
  };
}
