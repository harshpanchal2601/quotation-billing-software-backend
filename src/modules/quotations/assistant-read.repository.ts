import type { ListSort } from '../../core/validation/list-sort.js';
import { quotationsRepository } from './quotations.repository.js';
import { quotationListQuerySchema } from './quotations.schema.js';

// Reuse the normal API's latest-revision and tenant filtering.

export async function searchAssistantQuotations(firmId: number, search: string, page: number, sorting: ListSort<'id'> = {}) {
  const result = await quotationsRepository.listQuotations(firmId, quotationListQuerySchema.parse({ search, page, limit: 20, sortBy: sorting.sortBy, sortOrder: sorting.sortOrder }));
  return { records: result.quotations.map((row) => ({ id: row.id, label: row.quotationNumber, customer: row.companyNameSnapshot, href: `/quotations/${row.id}`, status: row.status, currency: row.currency, total: row.grandTotal })), pagination: result.pagination };
}
