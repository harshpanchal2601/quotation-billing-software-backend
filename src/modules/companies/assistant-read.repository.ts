import type { ListSort } from '../../core/validation/list-sort.js';
import { companiesRepository } from './companies.repository.js';
import { companyListQuerySchema } from './companies.schema.js';

// Keep the assistant projection free of contact and address details.

export async function searchAssistantCustomers(firmId: number, search: string, page: number, sorting: ListSort<'id'> = {}) {
  const result = await companiesRepository.listCompanies(firmId, companyListQuerySchema.parse({ search, page, limit: 20, sortBy: sorting.sortBy, sortOrder: sorting.sortOrder }));
  return { records: result.companies.map((row) => ({ id: row.id, label: row.name, code: row.companyCode, href: `/companies/${row.id}`, status: row.isActive ? 'ACTIVE' : 'INACTIVE' })), pagination: result.pagination };
}
