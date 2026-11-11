import type { MeasurementUnit, Prisma, PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { createAuditLog, pickChangedFields, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { listOrderBy } from '../../core/validation/list-sort.js';
import { withFirmEntitlementTransaction } from '../entitlements/index.js';
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

  async listMeasurementUnits(firmId: number, query: MeasurementUnitListQuery) {
    const where: Prisma.MeasurementUnitWhereInput = {
      firmId,
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.allowDecimal === undefined ? {} : { allowDecimal: query.allowDecimal }),
      ...(query.search === undefined ? {} : createMeasurementUnitSearchFilter(query.search)),
    };

    const [measurementUnits, total] = await this.db.$transaction([
      this.db.measurementUnit.findMany({
        where,
        orderBy: listOrderBy(query, ['name', 'symbol', 'createdAt', 'updatedAt'], 'name', 'asc'),
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

  async getMeasurementUnitOptions(firmId: number) {
    const measurementUnits = await this.db.measurementUnit.findMany({
      where: {
        firmId,
        deletedAt: null,
        isActive: true,
      },
      orderBy: { name: 'asc' },
    });

    return {
      measurementUnits: measurementUnits.map(serialiseMeasurementUnitOption),
    };
  }

  async findDuplicateMeasurementUnit(firmId: number, name: string, symbol: string, excludeId?: number) {
    return this.db.measurementUnit.findFirst({
      where: {
        firmId,
        OR: [{ name }, { symbol }],
        ...(excludeId === undefined ? {} : { NOT: { id: excludeId } }),
      },
    });
  }

  async findMeasurementUnitById(firmId: number, id: number): Promise<MeasurementUnitWithItemCount | null> {
    return this.db.measurementUnit.findFirst({
      where: { id, firmId, deletedAt: null },
      include: unitDetailInclude,
    });
  }

  async findDeletedMeasurementUnitById(firmId: number, id: number) {
    return this.db.measurementUnit.findFirst({
      where: { id, firmId, deletedAt: { not: null } },
    });
  }

  async findRestoreConflict(firmId: number, id: number, name: string, symbol: string) {
    return this.db.measurementUnit.findFirst({
      where: {
        firmId,
        OR: [{ name }, { symbol }],
        deletedAt: null,
        NOT: { id },
      },
    });
  }

  async countLinkedItems(firmId: number, id: number) {
    return this.db.item.count({
      where: { firmId, measurementUnitId: id, deletedAt: null },
    });
  }

  async createMeasurementUnit(
    firmId: number,
    input: MeasurementUnitCreateInput,
    metadata: RequestMetadata,
  ) {
    const unit = await this.db.measurementUnit.create({
      data: {
        firmId,
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
    return withFirmEntitlementTransaction(this.db, previous.firmId, async (tx) => {
      const current = await tx.measurementUnit.findFirst({ where: { id, firmId: previous.firmId, deletedAt: null } });
      if (!current) throw new AppError('Measurement unit unavailable', 404);
      if (input.allowDecimal !== undefined && input.allowDecimal !== current.allowDecimal && await tx.item.count({ where: { firmId: previous.firmId, measurementUnitId: id, stockTracking: true } })) throw new AppError('Decimal precision cannot change for a unit used by tracked inventory', 409);
      const updateData: Prisma.MeasurementUnitUpdateInput = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.symbol === undefined ? {} : { symbol: input.symbol }),
        ...(input.allowDecimal === undefined ? {} : { allowDecimal: input.allowDecimal }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      };

      const updated = await tx.measurementUnit.update({
        where: { id },
        data: updateData,
        include: unitDetailInclude,
      });

      await this.auditUnit(AuditAction.UPDATE, updated, metadata, current, tx);
      return serialiseMeasurementUnit(updated);
    });
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
    db: PrismaClient | Prisma.TransactionClient = this.db,
  ) {
    const changed = previous
      ? pickChangedFields(
          previous as unknown as Record<string, unknown>,
          unit as unknown as Record<string, unknown>,
          [...unitAuditFields],
        )
      : undefined;

    await createAuditLog(db, {
      metadata,
      entityType: 'MeasurementUnit',
      entityId: String(unit.id),
      action,
      policy: db === this.db ? 'BEST_EFFORT' : 'REQUIRED',
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
