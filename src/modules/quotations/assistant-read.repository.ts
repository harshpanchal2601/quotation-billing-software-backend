import { quotationsRepository } from './quotations.repository.js';
import { quotationListQuerySchema } from './quotations.schema.js';

// Reuse the normal API's latest-revision and tenant filtering.

export async function searchAssistantQuotations(firmId: number, search: string, page: number) {
  const result = await quotationsRepository.listQuotations(firmId, quotationListQuerySchema.parse({ search, page, limit: 20 }));
  return { records: result.quotations.map((row) => ({ id: row.id, label: row.quotationNumber, customer: row.companyNameSnapshot, href: `/quotations/${row.id}`, status: row.status, currency: row.currency, total: row.grandTotal })), pagination: result.pagination };
}
