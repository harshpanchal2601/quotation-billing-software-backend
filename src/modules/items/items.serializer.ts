import { parseSpecificationsJson } from './item-specifications.js';
import type {
  ItemCategorySummary,
  ItemDetail,
  ItemListItem,
  ItemOption,
  ItemWithRelations,
  MeasurementUnitSummary,
} from './items.types.js';

export function toImageUrl(imagePath: string | null): string | null {
  return imagePath === null || imagePath === undefined || imagePath.trim().length === 0
    ? null
    : `/storage/${imagePath}`;
}

export function serialiseCategorySummary(category: ItemWithRelations['category']): ItemCategorySummary | null {
  if (!category) return null;
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    isActive: category.isActive,
  };
}

export function serialiseMeasurementUnitSummary(unit: ItemWithRelations['measurementUnit']): MeasurementUnitSummary {
  return {
    id: unit.id,
    name: unit.name,
    symbol: unit.symbol,
    allowDecimal: unit.allowDecimal,
    isActive: unit.isActive,
  };
}

export function serialiseItemListItem(item: ItemWithRelations): ItemListItem {
  return {
    id: item.id,
    itemCode: item.itemCode,
    name: item.name,
    shortDescription: item.shortDescription,
    category: serialiseCategorySummary(item.category),
    measurementUnit: serialiseMeasurementUnitSummary(item.measurementUnit),
    defaultRate: item.defaultRate.toFixed(2),
    hsnCode: item.hsnCode,
    gstRate: item.gstRate.toFixed(2),
    imageUrl: toImageUrl(item.imagePath),
    sourceType: item.sourceType,
    isActive: item.isActive,
    quotationUsageCount: item._count?.quotationItems ?? 0,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function serialiseItemDetail(item: ItemWithRelations): ItemDetail {
  return {
    ...serialiseItemListItem(item),
    detailedDescription: item.detailedDescription,
    specifications: parseSpecificationsJson(item.specifications),
    sourceUrl: item.sourceUrl,
  };
}

export function serialiseItemOption(item: ItemWithRelations): ItemOption {
  return {
    id: item.id,
    itemCode: item.itemCode,
    name: item.name,
    shortDescription: item.shortDescription,
    defaultRate: item.defaultRate.toFixed(2),
    gstRate: item.gstRate.toFixed(2),
    hsnCode: item.hsnCode,
    category: serialiseCategorySummary(item.category),
    measurementUnit: serialiseMeasurementUnitSummary(item.measurementUnit),
    imageUrl: toImageUrl(item.imagePath),
  };
}
