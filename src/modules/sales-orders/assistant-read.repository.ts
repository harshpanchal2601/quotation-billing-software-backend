import { salesOrdersRepository } from './sales-orders.repository.js';
import { salesListSchema } from './sales-orders.schema.js';

// Sales capability and actor checks remain in the existing order read.

export async function searchAssistantOrders(firmId: number, actorId: number, search: string, page: number) {
  const result = await salesOrdersRepository.list(firmId, actorId, salesListSchema.parse({ search, page, limit: 20 }));
  return { records: result.orders.map((row) => ({ id: row.id, label: row.orderNumber, customer: row.company.name, href: `/sales-orders/${row.id}`, status: row.status, currency: row.currency })), pagination: result.pagination };
}
