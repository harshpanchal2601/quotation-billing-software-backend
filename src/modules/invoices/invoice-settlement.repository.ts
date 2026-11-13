import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';
import { invoiceSettlement } from './invoice-settlement.js';
import { indiaToday } from './india-gst.js';

const settlementSelect = {
  id: true, companyId: true, documentNumber: true, dueDate: true, currency: true, grandTotal: true,
} satisfies Prisma.InvoiceSelect;

export async function readInvoiceSettlement(db: Prisma.TransactionClient | PrismaClient, firmId: number, invoiceId: number) {
  const row = await db.invoice.findFirst({ where: { id: invoiceId, firmId, kind: 'INVOICE', status: 'ISSUED' }, select: settlementSelect });
  if (!row) throw new AppError('Eligible invoice not found', 404);
  const notes = await db.invoice.groupBy({ by: ['kind'], where: { firmId, sourceInvoiceId: invoiceId, status: 'ISSUED', kind: { in: ['CREDIT_NOTE', 'DEBIT_NOTE'] } }, _sum: { grandTotal: true } });
  const allocations = await db.paymentAllocation.aggregate({ where: { invoiceId, firmId, payment: { reversal: null } }, _sum: { amount: true } });
  const totalFor = (kind: 'CREDIT_NOTE' | 'DEBIT_NOTE') => notes.find((entry) => entry.kind === kind)?._sum.grandTotal ?? new Prisma.Decimal(0);
  return { id: row.id, companyId: row.companyId, documentNumber: row.documentNumber, dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
    ...invoiceSettlement({ currency: row.currency, total: row.grandTotal,
      credits: totalFor('CREDIT_NOTE'), debits: totalFor('DEBIT_NOTE'),
      allocated: allocations._sum.amount ?? new Prisma.Decimal(0), dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null }, indiaToday()),
  };
}
