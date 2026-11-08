import { itemsRepository } from './items.repository.js';
import { itemListQuerySchema } from './items.schema.js';

// Descriptions are untrusted data and are not sent to the intent router.

export async function searchAssistantItems(firmId: number, search: string, page: number) {
  const result = await itemsRepository.listItems(firmId, itemListQuerySchema.parse({ search, page, limit: 20 }));
  return { records: result.items.map((row) => ({ id: row.id, label: row.name, code: row.itemCode, href: `/items/${row.id}`, status: row.isActive ? 'ACTIVE' : 'INACTIVE', unitRate: row.defaultRate, unit: row.measurementUnit.symbol })), pagination: result.pagination };
}
