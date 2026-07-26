import type { MeasurementUnit } from '@prisma/client';
import type { MeasurementUnitFormatted, MeasurementUnitOption } from './measurement-units.types.js';

export type MeasurementUnitWithItemCount = MeasurementUnit & {
  _count?: {
    items: number;
  };
};

export function serialiseMeasurementUnit(unit: MeasurementUnitWithItemCount): MeasurementUnitFormatted {
  return {
    id: unit.id,
    name: unit.name,
    symbol: unit.symbol,
    allowDecimal: unit.allowDecimal,
    isActive: unit.isActive,
    linkedItemCount: unit._count?.items ?? 0,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
  };
}

export function serialiseMeasurementUnitOption(unit: MeasurementUnit): MeasurementUnitOption {
  return {
    id: unit.id,
    name: unit.name,
    symbol: unit.symbol,
    allowDecimal: unit.allowDecimal,
  };
}
