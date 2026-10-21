import type { MeasurementUnit, Prisma, PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { createAuditLog, pickChangedFields, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { createPaginationMetadata } from './measurement-units.types.js';
import {
  serialiseMeasurementUnit,
  serialiseMeasurementUnitOption,
  type MeasurementUnitWithItemCount,
} from './measurement-units.serializer.js';
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

export class MeasurementUnitsRepository {
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

  async findDuplicateMeasurementUnit(name: string, symbol: string, excludeId?: number) {
    return this.db.measurementUnit.findFirst({
      where: {
        OR: [{ name }, { symbol }],
        ...(excludeId === undefined ? {} : { NOT: { id: excludeId } }),
      },
    });
  }

  async findMeasurementUnitById(id: number): Promise<MeasurementUnitWithItemCount | null> {
    return this.db.measurementUnit.findFirst({
      where: { id, deletedAt: null },
      include: unitDetailInclude,
    });
  }

  async findDeletedMeasurementUnitById(id: number) {
    return this.db.measurementUnit.findFirst({
      where: { id, deletedAt: { not: null } },
    });
  }

  async findRestoreConflict(id: number, name: string, symbol: string) {
    return this.db.measurementUnit.findFirst({
      where: {
        OR: [{ name }, { symbol }],
        deletedAt: null,
        NOT: { id },
      },
    });
  }

  async countLinkedItems(id: number) {
    return this.db.item.count({
      where: { measurementUnitId: id, deletedAt: null },
    });
  }

  async createMeasurementUnit(
    input: MeasurementUnitCreateInput,
    metadata: RequestMetadata,
  ) {
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

  async updateMeasurementUnit(
    id: number,
    input: MeasurementUnitUpdateInput,
    metadata: RequestMetadata,
    previous: MeasurementUnit,
  ) {
    const updateData: Prisma.MeasurementUnitUpdateInput = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
      ...(input.allowDecimal === undefined ? {} : { allowDecimal: input.allowDecimal }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    };

    const updated = await this.db.measurementUnit.update({
      where: { id },
      data: updateData,
      include: unitDetailInclude,
    });

    await this.auditUnit(AuditAction.UPDATE, updated, metadata, previous);
    return serialiseMeasurementUnit(updated);
  }

  async updateMeasurementUnitStatus(
    id: number,
    isActive: boolean,
    metadata: RequestMetadata,
    previous: MeasurementUnit,
  ) {
    const updated = await this.db.measurementUnit.update({
      where: { id },
      data: { isActive },
      include: unitDetailInclude,
    });

    await this.auditUnit(AuditAction.STATUS_CHANGE, updated, metadata, previous);
    return serialiseMeasurementUnit(updated);
  }

  async deleteMeasurementUnit(id: number, metadata: RequestMetadata, previous: MeasurementUnit) {
    await this.db.measurementUnit.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    await this.auditUnit(AuditAction.DELETE, previous, metadata);
  }

  async restoreMeasurementUnit(id: number, metadata: RequestMetadata, previous: MeasurementUnit) {
    const restored = await this.db.measurementUnit.update({
      where: { id },
      data: {
        deletedAt: null,
        isActive: true,
      },
      include: unitDetailInclude,
    });

    await this.auditUnit(AuditAction.RESTORE, restored, metadata, previous);
    return serialiseMeasurementUnit(restored);
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

export const measurementUnitsRepository = new MeasurementUnitsRepository(prisma);

function createMeasurementUnitSearchFilter(search: string): Prisma.MeasurementUnitWhereInput {
  return {
    OR: [{ name: { contains: search } }, { symbol: { contains: search } }],
  };
}
