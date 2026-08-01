import type { MeasurementUnit, Prisma, PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { AppError } from '../../core/errors/AppError.js';
import { createAuditLog, pickChangedFields, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import {
  serialiseMeasurementUnit,
  serialiseMeasurementUnitOption,
  type MeasurementUnitWithItemCount,
} from './measurement-units.serializer.js';
import { createPaginationMetadata } from './measurement-units.types.js';
import type {
  MeasurementUnitCreateInput,
  MeasurementUnitListQuery,
  MeasurementUnitUpdateInput,
} from './measurement-units.schema.js';

const unitAuditFields = ['name', 'symbol', 'allowDecimal', 'isActive'] as const;

const unitDetailInclude = {
  _count: {
    select: {
      items: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.MeasurementUnitInclude;

export class MeasurementUnitsService {
  constructor(private readonly db: PrismaClient) {}

  async listMeasurementUnits(query: MeasurementUnitListQuery) {
    const where: Prisma.MeasurementUnitWhereInput = {
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.allowDecimal === undefined ? {} : { allowDecimal: query.allowDecimal }),
      ...(query.search === undefined ? {} : createMeasurementUnitSearchFilter(query.search)),
    };

    const [measurementUnits, total] = await this.db.$transaction([
      this.db.measurementUnit.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: unitDetailInclude,
      }),
      this.db.measurementUnit.count({ where }),
    ]);

    return {
      measurementUnits: measurementUnits.map(serialiseMeasurementUnit),
      pagination: createPaginationMetadata(query.page, query.limit, total),
    };
  }

  async getMeasurementUnitOptions() {
    const measurementUnits = await this.db.measurementUnit.findMany({
      where: {
        deletedAt: null,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });

    return {
      measurementUnits: measurementUnits.map(serialiseMeasurementUnitOption),
    };
  }

  async createMeasurementUnit(input: MeasurementUnitCreateInput, metadata: RequestMetadata) {
    const existing = await this.db.measurementUnit.findFirst({
      where: {
        OR: [{ name: input.name }, { symbol: input.symbol }],
      },
    });

    if (existing !== null) {
      throw new AppError('Measurement unit name or symbol already exists', 409);
    }

    const unit = await this.db.measurementUnit.create({
      data: {
        name: input.name,
        symbol: input.symbol,
        allowDecimal: input.allowDecimal,
        isActive: input.isActive,
      },
      include: unitDetailInclude,
    });

    await this.auditUnit(AuditAction.CREATE, unit, metadata);
    return serialiseMeasurementUnit(unit);
  }

  async getMeasurementUnit(id: number) {
    const unit = await this.getExistingUnitRecord(id);
    return serialiseMeasurementUnit(unit);
  }

  async updateMeasurementUnit(
    id: number,
    input: MeasurementUnitUpdateInput,
    metadata: RequestMetadata,
  ) {
    const existing = await this.getExistingUnitRecord(id);

    const conditions: Prisma.MeasurementUnitWhereInput[] = [];
    if (input.name !== undefined && input.name !== existing.name) {
      conditions.push({ name: input.name });
    }
    if (input.symbol !== undefined && input.symbol !== existing.symbol) {
      conditions.push({ symbol: input.symbol });
    }

    if (conditions.length > 0) {
      const duplicate = await this.db.measurementUnit.findFirst({
        where: {
          OR: conditions,
          NOT: { id },
        },
      });
      if (duplicate !== null) {
        throw new AppError('Measurement unit name or symbol already exists', 409);
      }
    }

    const updateData: Prisma.MeasurementUnitUpdateInput = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
      ...(input.allowDecimal === undefined ? {} : { allowDecimal: input.allowDecimal }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    };

    if (Object.keys(updateData).length === 0 || !hasUnitChanges(existing, updateData)) {
      return serialiseMeasurementUnit(existing);
    }

    const updated = await this.db.measurementUnit.update({
      where: { id },
      data: updateData,
      include: unitDetailInclude,
    });

    await this.auditUnit(AuditAction.UPDATE, updated, metadata, existing);
    return serialiseMeasurementUnit(updated);
  }

  async updateMeasurementUnitStatus(id: number, isActive: boolean, metadata: RequestMetadata) {
    const existing = await this.getExistingUnitRecord(id);

    if (existing.isActive === isActive) {
      return serialiseMeasurementUnit(existing);
    }

    const updated = await this.db.measurementUnit.update({
      where: { id },
      data: { isActive },
      include: unitDetailInclude,
    });

    await this.auditUnit(AuditAction.STATUS_CHANGE, updated, metadata, existing);
    return serialiseMeasurementUnit(updated);
  }

  async deleteMeasurementUnit(id: number, metadata: RequestMetadata) {
    const existing = await this.getExistingUnitRecord(id);

    const linkedItemsCount = await this.db.item.count({
      where: { measurementUnitId: id, deletedAt: null },
    });

    if (linkedItemsCount > 0) {
      throw new AppError('Measurement unit cannot be deleted because items are linked to it.', 409);
    }

    await this.db.measurementUnit.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    await this.auditUnit(AuditAction.DELETE, existing, metadata);
  }

  async restoreMeasurementUnit(id: number, metadata: RequestMetadata) {
    const existing = await this.db.measurementUnit.findFirst({
      where: { id, deletedAt: { not: null } },
    });

    if (existing === null) {
      throw new AppError('Measurement unit not found', 404);
    }

    const conflict = await this.db.measurementUnit.findFirst({
      where: {
        OR: [{ name: existing.name }, { symbol: existing.symbol }],
        deletedAt: null,
        NOT: { id },
      },
    });

    if (conflict !== null) {
      throw new AppError('Cannot restore measurement unit because its name or symbol conflicts with an existing unit.', 409);
    }

    const restored = await this.db.measurementUnit.update({
      where: { id },
      data: {
        deletedAt: null,
        isActive: true,
      },
      include: unitDetailInclude,
    });

    await this.auditUnit(AuditAction.RESTORE, restored, metadata, existing);
    return serialiseMeasurementUnit(restored);
  }

  private async getExistingUnitRecord(id: number): Promise<MeasurementUnitWithItemCount> {
    const unit = await this.db.measurementUnit.findFirst({
      where: { id, deletedAt: null },
      include: unitDetailInclude,
    });

    if (unit === null) {
      throw new AppError('Measurement unit not found', 404);
    }

    return unit;
  }

  private async auditUnit(
    action: AuditAction,
    unit: MeasurementUnit,
    metadata: RequestMetadata,
    previous?: MeasurementUnit,
  ) {
    const changed = previous
      ? pickChangedFields(
          previous as unknown as Record<string, unknown>,
          unit as unknown as Record<string, unknown>,
          [...unitAuditFields],
        )
      : undefined;

    await createAuditLog(this.db, {
      metadata,
      entityType: 'MeasurementUnit',
      entityId: String(unit.id),
      action,
      oldValues: changed?.oldValues,
      newValues: changed?.newValues ?? {
        name: unit.name,
        symbol: unit.symbol,
        allowDecimal: unit.allowDecimal,
        isActive: unit.isActive,
      },
    });
  }
}

function createMeasurementUnitSearchFilter(search: string): Prisma.MeasurementUnitWhereInput {
  return {
    OR: [{ name: { contains: search } }, { symbol: { contains: search } }],
  };
}

function hasUnitChanges(existing: MeasurementUnit, data: Prisma.MeasurementUnitUpdateInput) {
  return Object.entries(data).some(([key, value]) => existing[key as keyof MeasurementUnit] !== value);
}
