import type { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';
import { invoicesRepository as repository, serialiseInvoice } from './invoices.repository.js';
import { invoiceDraftSchema, type InvoiceDraftInput } from './invoices.schema.js';

export function previewRecurringDraft(tx: Prisma.TransactionClient, firmId: number, actorId: number, input: InvoiceDraftInput) {
  return repository.previewInTransaction(tx, firmId, actorId, input, 'INVOICE');
}
export async function createRecurringDraft(tx: Prisma.TransactionClient, firmId: number, actorId: number, input: InvoiceDraftInput) {
  const invoice = await repository.createInTransaction(tx, firmId, actorId, input, 'INVOICE', { firmId, userId: actorId });
  if (invoice.status !== 'DRAFT') throw new AppError('Recurring period key conflicts with an issued document', 409);
  return invoice;
}
export async function readRecurringTemplate(tx: Prisma.TransactionClient, firmId: number, actorId: number, invoiceId: number) {
  await repository.authorize(tx, firmId, actorId, 'INVOICE', 'view');
  const record = await repository.find(tx, firmId, invoiceId, 'INVOICE');
  if (record.status !== 'DRAFT' || record.sourceInvoiceId || record.sourceProformaId || record.sourceQuotationId || record.sourceSalesOrderId) throw new AppError('Choose a manual invoice draft as the recurring template', 409);
  const document = serialiseInvoice(record);
  const buyer = document.buyerSnapshot as { billingAddress: { id: number }; shippingAddress?: { id: number } | null };
  return invoiceDraftSchema.parse({
    companyId: document.companyId, billingAddressId: buyer.billingAddress.id, shippingAddressId: buyer.shippingAddress?.id ?? null,
    invoiceDate: document.invoiceDate, dueDate: document.dueDate, customerReference: document.customerReference,
    paymentTerms: document.paymentTerms, notes: document.notes, supply: document.supplySnapshot, customFieldValues: document.customFieldValues,
    idempotencyKey: `template_${document.id}`, lines: document.lines.map((line) => ({ itemId: line.itemId, itemName: line.itemName, description: line.description, hsnCode: line.hsnCode, supplyType: line.supplyType, measurementUnit: line.measurementUnit, quantity: line.quantity, unitRate: line.unitRate, discountType: line.discountType, discountValue: line.discountValue, taxRate: line.taxRate })),
  });
}
