import { Prisma, type Item, type ItemCategory, type MeasurementUnit, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ItemsRepository } from '../src/modules/items/items.repository.js';

type MockPrisma = {
  item: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  itemCategory: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  measurementUnit: {
    findFirst: ReturnType<typeof vi.fn>;
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
    item: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    itemCategory: {
      findFirst: vi.fn(),
    },
    measurementUnit: {
      findFirst: vi.fn(),
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

function mockCategory(overrides: Partial<ItemCategory> = {}): ItemCategory {
  return {
    id: 1,
    name: 'Vessels & Reactors',
    slug: 'vessels-reactors',
    description: 'Vessels description',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function mockUnit(overrides: Partial<MeasurementUnit> = {}): MeasurementUnit {
  return {
    id: 1,
    name: 'Kilogram',
    symbol: 'kg',
    allowDecimal: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function mockItem(overrides: Partial<Item> = {}) {
  return {
    id: 1,
    itemCode: 'ITEM-000001',
    categoryId: 1,
    name: 'SS Tank 500L',
    shortDescription: '500L Stainless Steel Tank',
    detailedDescription: 'Grade 316L SS Tank with jacket',
    specifications: [{ label: 'Capacity', value: '500L' }],
    measurementUnitId: 1,
    defaultRate: new Prisma.Decimal('4500.00'),
    hsnCode: '730900',
    gstRate: new Prisma.Decimal('18.00'),
    imagePath: null,
    sourceType: 'MANUAL',
    sourceUrl: null,
    sourceExternalId: null,
    isActive: true,
    createdById: 1,
    updatedById: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    category: mockCategory(),
    measurementUnit: mockUnit(),
    _count: { quotationItems: 0 },
    ...overrides,
  };
}

describe('items repository', () => {
  let db: MockPrisma;

  beforeEach(() => {
    db = createMockPrisma();
    db.auditLog.create.mockResolvedValue({ id: 1 });
    db.item.findFirst.mockResolvedValue(null);
  });

  it('generates item code and defaults category to uncategorised when categoryId is omitted', async () => {
    const uncategorisedCat = mockCategory({ id: 10, name: 'Uncategorised', slug: 'uncategorised' });
    db.itemCategory.findFirst.mockResolvedValueOnce(uncategorisedCat);
    db.measurementUnit.findFirst.mockResolvedValueOnce(mockUnit());

    db.item.findFirst.mockResolvedValueOnce(null);
    db.item.findMany.mockResolvedValueOnce([]);

    const createdRecord = mockItem({
      itemCode: 'ITEM-000001',
      categoryId: 10,
      category: uncategorisedCat,
    });
    db.item.create.mockResolvedValueOnce(createdRecord);

    const repository = new ItemsRepository(asPrisma(db));
    const result = await repository.createItem(
      {
        name: 'SS Tank 500L',
        measurementUnitId: 1,
        defaultRate: '4500.00',
      },
      { userId: 1 },
    );

    expect(result.itemCode).toBe('ITEM-000001');
    expect(result.category?.slug).toBe('uncategorised');
    expect(db.item.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemCode: 'ITEM-000001',
        categoryId: 10,
        name: 'SS Tank 500L',
        sourceType: 'MANUAL',
      }),
      include: expect.any(Object),
    });
  });

  it('rejects item creation when category or measurement unit is inactive', async () => {
    const inactiveCategory = mockCategory({ isActive: false });
    db.itemCategory.findFirst.mockResolvedValueOnce(inactiveCategory);

    const repository = new ItemsRepository(asPrisma(db));
    await expect(
      repository.createItem(
        { categoryId: 1, name: 'SS Tank', measurementUnitId: 1 },
        { userId: 1 },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Category is inactive or unavailable.',
    });
  });

  it('serialises default rate and GST rate consistently as decimal strings', async () => {
    db.item.findFirst.mockResolvedValueOnce(mockItem());

    const repository = new ItemsRepository(asPrisma(db));
    const result = await repository.getItem(1);

    expect(result.defaultRate).toBe('4500.00');
    expect(result.gstRate).toBe('18.00');
  });

  it('returns active usable items only for options endpoint', async () => {
    db.item.findMany.mockResolvedValueOnce([mockItem()]);

    const repository = new ItemsRepository(asPrisma(db));
    const result = await repository.getItemOptions({ limit: 20 });

    expect(result.items.length).toBe(1);
    expect(result.items[0]?.itemCode).toBe('ITEM-000001');
    expect(db.item.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        deletedAt: null,
        isActive: true,
        category: { deletedAt: null, isActive: true },
        measurementUnit: { deletedAt: null, isActive: true },
      }),
      orderBy: { name: 'asc' },
      take: 20,
      include: expect.any(Object),
    });
  });

  it('rejects item activation when category or measurement unit is inactive', async () => {
    const inactiveCatItem = mockItem({
      isActive: false,
      category: mockCategory({ isActive: false }),
    });
    db.item.findFirst.mockResolvedValueOnce(inactiveCatItem);

    const repository = new ItemsRepository(asPrisma(db));
    await expect(repository.updateItemStatus(1, true, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Item cannot be activated because its category is inactive or unavailable.',
    });
  });

  it('soft-deletes item while retaining imagePath', async () => {
    const itemWithImage = mockItem({ imagePath: 'items/item-uuid.jpg' });
    db.item.findFirst.mockResolvedValueOnce(itemWithImage);
    db.item.update.mockResolvedValueOnce({ ...itemWithImage, deletedAt: now, isActive: false });

    const repository = new ItemsRepository(asPrisma(db));
    await repository.deleteItem(1, { userId: 1 });

    expect(db.item.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        deletedAt: expect.any(Date),
        isActive: false,
      }),
    });
  });

  it('handles deleted category dependency on item restoration', async () => {
    const deletedCatItem = mockItem({
      deletedAt: now,
      category: mockCategory({ deletedAt: now }),
    });
    db.item.findFirst.mockResolvedValueOnce(deletedCatItem);

    const repository = new ItemsRepository(asPrisma(db));
    await expect(repository.restoreItem(1, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot restore item because its category is deleted.',
    });
  });

  it('filters and paginates item list correctly', async () => {
    db.item.findMany.mockResolvedValueOnce([mockItem()]);
    db.item.count.mockResolvedValueOnce(1);

    const repository = new ItemsRepository(asPrisma(db));
    const result = await repository.listItems({
      page: 1,
      limit: 20,
      search: 'SS Tank',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(result.pagination.total).toBe(1);
    expect(result.items[0]?.name).toBe('SS Tank 500L');
    expect(db.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
        }),
        skip: 0,
        take: 20,
      }),
    );
  });

  it('retries item code generation when a duplicate code already exists', async () => {
    const uncategorisedCat = mockCategory({ id: 10, name: 'Uncategorised', slug: 'uncategorised' });
    db.itemCategory.findFirst.mockResolvedValueOnce(uncategorisedCat);
    db.measurementUnit.findFirst.mockResolvedValueOnce(mockUnit());

    db.item.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 99 })
      .mockResolvedValueOnce(null);
    db.item.findMany.mockResolvedValueOnce([]);

    const createdRecord = mockItem({
      itemCode: 'ITEM-000002',
      categoryId: 10,
      category: uncategorisedCat,
    });
    db.item.create.mockResolvedValueOnce(createdRecord);

    const repository = new ItemsRepository(asPrisma(db));
    const result = await repository.createItem(
      {
        name: 'Retry Item',
        measurementUnitId: 1,
      },
      { userId: 1 },
    );

    expect(result.itemCode).toBe('ITEM-000002');
    expect(db.item.findFirst).toHaveBeenCalledTimes(3);
  });
});
