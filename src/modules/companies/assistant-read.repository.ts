import { companiesRepository } from './companies.repository.js';
import { companyListQuerySchema } from './companies.schema.js';

// Keep the assistant projection free of contact and address details.

export async function searchAssistantCustomers(firmId: number, search: string, page: number) {
  const result = await companiesRepository.listCompanies(firmId, companyListQuerySchema.parse({ search, page, limit: 20 }));
  return { records: result.companies.map((row) => ({ id: row.id, label: row.name, code: row.companyCode, href: `/companies/${row.id}`, status: row.isActive ? 'ACTIVE' : 'INACTIVE' })), pagination: result.pagination };
}
