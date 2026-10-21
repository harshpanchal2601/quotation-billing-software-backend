import type { ItemCategory, PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CategoriesRepository } from '../src/modules/categories/categories.repository.js';

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
    firmId: 1,
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

describe('category repository', () => {
  let db: MockPrisma;

  beforeEach(() => {
    db = createMockPrisma();
    db.auditLog.create.mockResolvedValue({ id: 1 });
  });

  it('generates a unique URL-safe slug on category creation', async () => {
    db.itemCategory.findFirst.mockResolvedValueOnce(null);

    db.itemCategory.create.mockResolvedValueOnce(category({ slug: 'vessels-reactors' }));

    const repository = new CategoriesRepository(asPrisma(db));
    const slug = await repository.generateUniqueSlug(1, 'Vessels & Reactors');
    const result = await repository.createCategory(
      1,
      { name: 'Vessels & Reactors', description: 'Vessel category', isActive: true, slug },
      { userId: 1, firmId: 1 },
    );

    expect(slug).toBe('vessels-reactors');
    expect(result.slug).toBe('vessels-reactors');
    expect(db.itemCategory.create).toHaveBeenCalledWith({
      data: {
        firmId: 1,
        name: 'Vessels & Reactors',
        slug: 'vessels-reactors',
        description: 'Vessel category',
        isActive: true,
      },
      include: expect.any(Object),
    });
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it('returns a 409 conflict when creating a category with a duplicate name', async () => {
    db.itemCategory.findFirst.mockResolvedValueOnce(category());

    const repository = new CategoriesRepository(asPrisma(db));
    await expect(repository.findCategoryByName(1, 'Vessels & Reactors')).resolves.toEqual(category());
  });

  it('returns active non-deleted records only for options endpoint', async () => {
    db.itemCategory.findMany.mockResolvedValueOnce([category()]);

    const repository = new CategoriesRepository(asPrisma(db));
    const result = await repository.getCategoryOptions(1);

    expect(result.categories).toEqual([{ id: 1, name: 'Vessels & Reactors', slug: 'vessels-reactors' }]);
    expect(db.itemCategory.findMany).toHaveBeenCalledWith({
      where: { firmId: 1, deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
    });
  });

  it('filters and paginates category list correctly', async () => {
    db.itemCategory.findMany.mockResolvedValueOnce([categoryWithCount()]);
    db.itemCategory.count.mockResolvedValueOnce(1);

    const repository = new CategoriesRepository(asPrisma(db));
    const result = await repository.listCategories(1, {
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
          firmId: 1,
          deletedAt: null,
          isActive: true,
        }),
        skip: 0,
        take: 20,
      }),
    );
  });

  it('handles uniqueness conflict on category restoration', async () => {
    db.itemCategory.findFirst.mockResolvedValueOnce(category({ id: 2 }));

    const repository = new CategoriesRepository(asPrisma(db));
    await expect(repository.findRestoreConflict(1, 1, 'Vessels & Reactors', 'vessels-reactors')).resolves.toEqual(
      category({ id: 2 }),
    );
  });
});
