import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const measurementUnitsRepositoryMock = {
  listMeasurementUnits: vi.fn(),
  getMeasurementUnitOptions: vi.fn(),
  findDuplicateMeasurementUnit: vi.fn(),
  createMeasurementUnit: vi.fn(),
  findMeasurementUnitById: vi.fn(),
  findDeletedMeasurementUnitById: vi.fn(),
  findRestoreConflict: vi.fn(),
  countLinkedItems: vi.fn(),
  updateMeasurementUnit: vi.fn(),
  updateMeasurementUnitStatus: vi.fn(),
  deleteMeasurementUnit: vi.fn(),
  restoreMeasurementUnit: vi.fn(),
};

vi.mock('../src/modules/measurement-units/measurement-units.repository.js', () => ({
  measurementUnitsRepository: measurementUnitsRepositoryMock,
}));

const { createMeasurementUnit, listMeasurementUnits, measurementUnitsRepository } = await import(
  '../src/modules/measurement-units/measurement-units.routes.js',
);

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('measurement units routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a measurement unit through the repository and keeps the success payload shape', async () => {
    vi.mocked(measurementUnitsRepository.findDuplicateMeasurementUnit).mockResolvedValueOnce(null as never);
    vi.mocked(measurementUnitsRepository.createMeasurementUnit).mockResolvedValueOnce({ id: 1, name: 'Kilogram' } as never);

    const req = {
      body: { name: 'Kilogram', symbol: 'kg', allowDecimal: true, isActive: true },
      user: { id: 7 },
      ip: '127.0.0.1',
      get: vi.fn().mockReturnValue('vitest'),
    } as unknown as Request;
    const res = createRes();

    await createMeasurementUnit(req, res);

    expect(measurementUnitsRepository.createMeasurementUnit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Kilogram', symbol: 'kg' }),
      expect.objectContaining({ userId: 7 }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: 'Measurement unit created successfully',
      }),
    );
  });

  it('rejects a duplicate measurement unit name or symbol before create', async () => {
    vi.mocked(measurementUnitsRepository.findDuplicateMeasurementUnit).mockResolvedValueOnce({ id: 1 } as never);

    const req = {
      body: { name: 'Kilogram', symbol: 'kg', allowDecimal: true, isActive: true },
      user: { id: 7 },
      ip: '127.0.0.1',
      get: vi.fn(),
    } as unknown as Request;
    const res = createRes();

    await expect(createMeasurementUnit(req, res)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Measurement unit name or symbol already exists',
    });
  });

  it('returns the measurement unit list payload from the repository', async () => {
    vi.mocked(measurementUnitsRepository.listMeasurementUnits).mockResolvedValueOnce({
      measurementUnits: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
    } as never);

    const req = { query: {} } as Request;
    const res = createRes();

    await listMeasurementUnits(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Measurement units retrieved successfully',
      }),
    );
  });
});