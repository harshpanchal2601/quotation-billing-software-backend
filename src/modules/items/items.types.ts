import type { Item, ItemCategory, ItemSourceType, MeasurementUnit } from '@prisma/client';

export type ItemSpecification = {
  label: string;
  value: string;
};

export type ItemCategorySummary = {
  id: number;
  name: string;
  slug: string;
  isActive?: boolean;
};

export type MeasurementUnitSummary = {
  id: number;
  name: string;
  symbol: string;
  allowDecimal: boolean;
  isActive?: boolean;
};

export type ItemWithRelations = Item & {
  category: ItemCategory | null;
  measurementUnit: MeasurementUnit;
  _count?: {
    quotationItems: number;
  };
};

export type ItemListItem = {
  id: number;
  itemCode: string;
  name: string;
  shortDescription: string | null;
  category: ItemCategorySummary | null;
  measurementUnit: MeasurementUnitSummary;
  defaultRate: string;
  hsnCode: string | null;
  gstRate: string;
  imageUrl: string | null;
  sourceType: ItemSourceType;
  isActive: boolean;
  quotationUsageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ItemDetail = ItemListItem & {
  detailedDescription: string | null;
  specifications: ItemSpecification[];
  sourceUrl: string | null;
};

export type ItemOption = {
  id: number;
  itemCode: string;
  name: string;
  shortDescription: string | null;
  defaultRate: string;
  gstRate: string;
  hsnCode: string | null;
  category: ItemCategorySummary | null;
  measurementUnit: MeasurementUnitSummary;
  imageUrl: string | null;
};

export type PaginationMetadata = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export function createPaginationMetadata(page: number, limit: number, total: number): PaginationMetadata {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}
