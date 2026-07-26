import type { ItemCategory, PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CategoriesService } from '../src/modules/categories/categories.service.js';

type MockPrisma = {
  itemCategory: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  item: {
    count: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

function asPrisma(db: MockPrisma): PrismaClient {
  return db as unknown as PrismaClient;
}

function createMockPrisma(): MockPrisma {
  const db: MockPrisma = {
    itemCategory: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    item: {
      count: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (input: unknown) => {
    if (Array.isArray(input)) return Promise.all(input);
    if (typeof input === 'function') return input(db);
    return undefined;
  });
  return db;
}

const now = new Date('2026-01-01T00:00:00.000Z');

function category(overrides: Partial<ItemCategory> = {}): ItemCategory {
  return {
    id: 1,
    name: 'Vessels & Reactors',
    slug: 'vessels-reactors',
    description: 'Vessel category',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function categoryWithCount(overrides: Partial<ItemCategory> = {}, itemLimit = 0) {
  return {
    ...category(overrides),
    _count: { items: itemLimit },
  };
}

describe('category service', () => {
  let db: MockPrisma;

  beforeEach(() => {
    db = createMockPrisma();
    db.auditLog.create.mockResolvedValue({ id: 1 });
  });

  it('generates a unique URL-safe slug on category creation', async () => {
    db.itemCategory.findFirst
      .mockResolvedValueOnce(null) // Duplicate name check -> null
      .mockResolvedValueOnce({ id: 99 }) // First slug 'vessels-reactors' exists
      .mockResolvedValueOnce(null); // Second slug 'vessels-reactors-2' free

    db.itemCategory.create.mockResolvedValueOnce(category({ slug: 'vessels-reactors-2' }));

    const service = new CategoriesService(asPrisma(db));
    const result = await service.createCategory(
      { name: 'Vessels & Reactors', description: 'Vessel category', isActive: true },
      { userId: 1 },
    );

    expect(result.slug).toBe('vessels-reactors-2');
    expect(db.itemCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Vessels & Reactors',
        slug: 'vessels-reactors-2',
      }),
      include: expect.any(Object),
    });
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it('returns a 409 conflict when creating a category with a duplicate name', async () => {
    db.itemCategory.findFirst.mockResolvedValueOnce(category());

    const service = new CategoriesService(asPrisma(db));
    await expect(
      service.createCategory({ name: 'Vessels & Reactors', isActive: true }, { userId: 1 }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Category with this name already exists',
    });
  });

  it('prevents deletion or deactivation of the protected uncategorised category', async () => {
    const uncategorised = category({ id: 1, name: 'Uncategorised', slug: 'uncategorised' });
    db.itemCategory.findFirst.mockResolvedValue(categoryWithCount(uncategorised));

    const service = new CategoriesService(asPrisma(db));

    await expect(service.deleteCategory(1, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'The default Uncategorised category cannot be deactivated or deleted.',
    });

    await expect(service.updateCategoryStatus(1, false, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'The default Uncategorised category cannot be deactivated or deleted.',
    });

    await expect(service.updateCategory(1, { isActive: false }, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'The default Uncategorised category cannot be deactivated or deleted.',
    });
  });

  it('blocks category deletion when linked items exist', async () => {
    db.itemCategory.findFirst.mockResolvedValueOnce(categoryWithCount());
    db.item.count.mockResolvedValueOnce(3);

    const service = new CategoriesService(asPrisma(db));
    await expect(service.deleteCategory(1, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Category cannot be deleted because items are linked to it.',
    });
  });

  it('returns active non-deleted records only for options endpoint', async () => {
    db.itemCategory.findMany.mockResolvedValueOnce([category()]);

    const service = new CategoriesService(asPrisma(db));
    const result = await service.getCategoryOptions();

    expect(result.categories).toEqual([{ id: 1, name: 'Vessels & Reactors', slug: 'vessels-reactors' }]);
    expect(db.itemCategory.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
    });
  });

  it('filters and paginates category list correctly', async () => {
    db.itemCategory.findMany.mockResolvedValueOnce([categoryWithCount()]);
    db.itemCategory.count.mockResolvedValueOnce(1);

    const service = new CategoriesService(asPrisma(db));
    const result = await service.listCategories({
      page: 1,
      limit: 20,
      search: 'vessels',
      isActive: true,
      sortBy: 'name',
      sortOrder: 'asc',
    });

    expect(result.pagination.total).toBe(1);
    expect(result.categories[0]?.linkedItemCount).toBe(0);
    expect(db.itemCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          isActive: true,
        }),
        skip: 0,
        take: 20,
      }),
    );
  });

  it('handles uniqueness conflict on category restoration', async () => {
    db.itemCategory.findFirst
      .mockResolvedValueOnce(category({ deletedAt: now })) // Existing deleted category
      .mockResolvedValueOnce(category({ id: 2 })); // Conflict active category with same name/slug

    const service = new CategoriesService(asPrisma(db));
    await expect(service.restoreCategory(1, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot restore category because its name or slug conflicts with an existing category.',
    });
  });
});
