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

export type CategoryOption = {
  id: number;
  name: string;
  slug: string;
};

export type CategoryFormatted = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  linkedItemCount: number;
  createdAt: Date;
  updatedAt: Date;
};
