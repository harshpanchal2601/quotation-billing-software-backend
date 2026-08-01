import type { MeasurementUnit, PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeasurementUnitsService } from '../src/modules/measurement-units/measurement-units.service.js';
import { measurementUnitCreateSchema } from '../src/modules/measurement-units/measurement-units.schema.js';

type MockPrisma = {
  measurementUnit: {
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
    measurementUnit: {
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

function unit(overrides: Partial<MeasurementUnit> = {}): MeasurementUnit {
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

function unitWithCount(overrides: Partial<MeasurementUnit> = {}, itemLimit = 0) {
  return {
    ...unit(overrides),
    _count: { items: itemLimit },
  };
}

describe('measurement units service', () => {
  let db: MockPrisma;

  beforeEach(() => {
    db = createMockPrisma();
    db.auditLog.create.mockResolvedValue({ id: 1 });
  });

  it('preserves the symbol as a string without numeric conversion or casing mutation', async () => {
    db.measurementUnit.findFirst.mockResolvedValueOnce(null);
    db.measurementUnit.create.mockResolvedValueOnce(unit({ symbol: 'm²' }));

    const service = new MeasurementUnitsService(asPrisma(db));
    const result = await service.createMeasurementUnit(
      { name: 'Square Meter', symbol: 'm²', allowDecimal: true, isActive: true },
      { userId: 1 },
    );

    expect(result.symbol).toBe('m²');
    expect(db.measurementUnit.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Square Meter', symbol: 'm²' }),
      include: expect.any(Object),
    });
  });

  it('validates measurement unit symbols against the database length contract', () => {
    const fiftyCharacterSymbol = 'A'.repeat(50);

    expect(measurementUnitCreateSchema.parse({
      name: 'Long Symbol Unit',
      symbol: fiftyCharacterSymbol,
      allowDecimal: true,
      isActive: true,
    }).symbol).toBe(fiftyCharacterSymbol);

    expect(() => measurementUnitCreateSchema.parse({
      name: 'Too Long Symbol Unit',
      symbol: 'A'.repeat(51),
      allowDecimal: true,
      isActive: true,
    })).toThrow();
  });

  it('returns a 409 conflict when creating a duplicate unit name or symbol', async () => {
    db.measurementUnit.findFirst.mockResolvedValueOnce(unit({ symbol: 'kg' }));

    const service = new MeasurementUnitsService(asPrisma(db));
    await expect(
      service.createMeasurementUnit(
        { name: 'Kilogram Dual', symbol: 'kg', allowDecimal: true, isActive: true },
        { userId: 1 },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Measurement unit name or symbol already exists',
    });
  });

  it('blocks unit deletion when linked items exist', async () => {
    db.measurementUnit.findFirst.mockResolvedValueOnce(unitWithCount());
    db.item.count.mockResolvedValueOnce(5);

    const service = new MeasurementUnitsService(asPrisma(db));
    await expect(service.deleteMeasurementUnit(1, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Measurement unit cannot be deleted because items are linked to it.',
    });
  });

  it('returns active non-deleted unit options only', async () => {
    db.measurementUnit.findMany.mockResolvedValueOnce([unit()]);

    const service = new MeasurementUnitsService(asPrisma(db));
    const result = await service.getMeasurementUnitOptions();

    expect(result.measurementUnits).toEqual([
      { id: 1, name: 'Kilogram', symbol: 'kg', allowDecimal: true },
    ]);
    expect(db.measurementUnit.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
    });
  });

  it('filters and paginates measurement unit list correctly', async () => {
    db.measurementUnit.findMany.mockResolvedValueOnce([unitWithCount()]);
    db.measurementUnit.count.mockResolvedValueOnce(1);

    const service = new MeasurementUnitsService(asPrisma(db));
    const result = await service.listMeasurementUnits({
      page: 1,
      limit: 20,
      search: 'kg',
      isActive: true,
      allowDecimal: true,
      sortBy: 'name',
      sortOrder: 'asc',
    });

    expect(result.pagination.total).toBe(1);
    expect(result.measurementUnits[0]?.linkedItemCount).toBe(0);
    expect(db.measurementUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: null,
          isActive: true,
          allowDecimal: true,
        }),
        skip: 0,
        take: 20,
      }),
    );
  });

  it('handles uniqueness conflict on measurement unit restoration', async () => {
    db.measurementUnit.findFirst
      .mockResolvedValueOnce(unit({ deletedAt: now })) // Soft-deleted record
      .mockResolvedValueOnce(unit({ id: 2 })); // Conflict active record with same symbol

    const service = new MeasurementUnitsService(asPrisma(db));
    await expect(service.restoreMeasurementUnit(1, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot restore measurement unit because its name or symbol conflicts with an existing unit.',
    });
  });
});
