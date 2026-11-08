import type { customerQuotationSnapshot } from '../quotations/index.js';
import { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';
import { decimal, currencyCode, money } from '../../core/money/index.js';
import { lineSnapshotSchema, type InvoiceLineSnapshot } from './invoice-calculations.js';

type Source = ReturnType<typeof customerQuotationSnapshot>;
export function quotationBillingLines(source: Pick<Source, 'items' | 'taxMode' | 'currency'>, metadata: Array<{ lineNumber: number; hsnCode: string | null; supplyType: 'GOODS' | 'SERVICE' }>): InvoiceLineSnapshot[] {
  const byLine = new Map(metadata.map((line) => [line.lineNumber, line]));
  if (byLine.size !== metadata.length || metadata.length !== source.items.length || source.items.some((line) => !byLine.has(line.lineNumber))) throw new AppError('Provide HSN/SAC and goods/service metadata for each exact source line', 400);
  return source.items.map((line) => {
    for (const field of ['unitRate', 'baseAmount', 'discountAmount', 'taxableAmount', 'taxAmount', 'lineTotal'] as const) if (!decimal(money(line[field], currencyCode(source.currency), 'HALF_UP').amount).eq(line[field])) throw new AppError('Accepted quotation amounts exceed currency precision; review a new revision', 409);
    const tax = source.taxMode === 'CGST_SGST' ? decimal(line.taxAmount).div(2).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : decimal('0');
    return lineSnapshotSchema.parse({ ...line, ...byLine.get(line.lineNumber)!, cgstAmount: tax.toFixed(2), sgstAmount: source.taxMode === 'CGST_SGST' ? decimal(line.taxAmount).sub(tax).toFixed(2) : '0.00', igstAmount: source.taxMode === 'IGST' ? line.taxAmount : '0.00' });
  });
}

// Allocate remaining exact source components from active invoice snapshots.
// Voided reservations are omitted by the owning repository.
export function partialQuotationLine(source: InvoiceLineSnapshot, previousQuantity: string, quantity: string, currency: string, consumed?: Partial<InvoiceLineSnapshot>): InvoiceLineSnapshot {
  const before = decimal(previousQuantity); const after = before.add(quantity); const total = decimal(source.quantity);
  if (before.lt(0) || decimal(quantity).lte(0) || after.gt(total)) throw new AppError('Invoice quantity exceeds the order line', 409);
  const amount = (value: ReturnType<typeof decimal>) => money(value, currencyCode(currency), 'HALF_UP').amount;
  const part = (field: 'baseAmount' | 'discountAmount' | 'cgstAmount' | 'sgstAmount' | 'igstAmount') => {
    const used = consumed?.[field] ?? amount(decimal(source[field]).mul(before).div(total));
    const remaining = decimal(source[field]).sub(used);
    if (remaining.lt(0)) throw new AppError('Order component reservations exceed the accepted value', 409);
    return amount(remaining.mul(quantity).div(total.sub(before)));
  };
  const baseAmount = part('baseAmount'); const discountAmount = part('discountAmount');
  const taxableAmount = amount(decimal(baseAmount).sub(discountAmount));
  const cgstAmount = part('cgstAmount'); const sgstAmount = part('sgstAmount'); const igstAmount = part('igstAmount');
  const taxAmount = amount(decimal(cgstAmount).add(sgstAmount).add(igstAmount));
  return { ...source, quantity, baseAmount, discountAmount, taxableAmount, cgstAmount, sgstAmount, igstAmount, taxAmount, lineTotal: amount(decimal(taxableAmount).add(taxAmount)), ...(source.discountType === 'FIXED' ? { discountValue: discountAmount } : {}) };
}
