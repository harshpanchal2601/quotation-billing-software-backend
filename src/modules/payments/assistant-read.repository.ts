import { paymentsRepository } from './payments.repository.js';
import { receivablesRepository } from './receivables.repository.js';
import { paymentListSchema, receivablesQuerySchema } from './payments.schema.js';

// Settlement and ageing calculations remain in the existing payment reports.

export async function searchAssistantPayments(firmId: number, actorId: number, search: string, page: number) {
  const result = await paymentsRepository.list(firmId, actorId, paymentListSchema.parse({ search, page, limit: 20 }));
  return { records: result.payments.map((row) => ({ id: row.id, label: row.reference, customer: row.companyName, href: `/payments/${row.id}`, status: row.status, currency: row.currency, total: row.amount })), pagination: result.pagination };
}
export async function readAssistantReceivables(firmId: number, actorId: number, input: { companyId?: number; currency?: string; page: number }) {
  const result = await receivablesRepository.aging(firmId, actorId, receivablesQuerySchema.parse({ ...input, limit: 20 }));
  return { ...result, href: '/receivables', receivables: result.receivables.map((row) => ({ ...row, href: `/invoices/${row.id}` })) };
}
