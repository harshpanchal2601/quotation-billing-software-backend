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

export type MeasurementUnitOption = {
  id: number;
  name: string;
  symbol: string;
  allowDecimal: boolean;
};

export type MeasurementUnitFormatted = {
  id: number;
  name: string;
  symbol: string;
  allowDecimal: boolean;
  isActive: boolean;
  linkedItemCount: number;
  createdAt: Date;
  updatedAt: Date;
};
