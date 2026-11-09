import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../core/database/prisma.js';
import { invoicesRepository } from './invoices.repository.js';
import { invoiceListSchema } from './invoices.schema.js';
import { readSalesReport } from './sales-report.repository.js';

// Financial report queries remain owned by the billing domain.

export async function searchAssistantInvoices(firmId: number, search: string, page: number) {
  const result = await invoicesRepository.list(firmId, 'INVOICE', invoiceListSchema.parse({ search, page, limit: 20 }));
  return { records: result.documents.map((row) => ({ id: row.id, label: row.documentNumber ?? `Draft ${row.id}`, customer: String(row.buyerSnapshot && typeof row.buyerSnapshot === 'object' && !Array.isArray(row.buyerSnapshot) ? row.buyerSnapshot.name ?? '' : ''), href: `/invoices/${row.id}`, status: row.status, currency: row.currency, total: row.grandTotal, version: row.version })), pagination: result.pagination };
}

// Issued document sales, segmented by currency. Receipts are reported by Payments.
export async function readAssistantSales(firmId: number, actorId: number, input: { dateFrom?: string; dateTo?: string; currency?: string }, db: PrismaClient = prisma) {
  return db.$transaction((tx) => readSalesReport(tx, firmId, actorId, input), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
