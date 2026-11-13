import { z } from 'zod';
import { CURRENCY_SCALES, currencyCode, decimal, money, roundDecimal } from '../../core/money/index.js';
import { calculateTax } from '../../core/tax/index.js';
import { AppError } from '../../core/errors/AppError.js';
import type { InvoiceLineInput } from './invoices.schema.js';

export const invoiceFinancialPolicySchema = z.object({
  version: z.literal(1), businessPolicyVersion: z.number().int().nonnegative(),
  currency: z.string(), rounding: z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN']), grandTotal: z.enum(['MINOR_UNIT', 'WHOLE_UNIT']),
  registration: z.enum(['REGULAR', 'COMPOSITION', 'UNREGISTERED']), sellerStateCode: z.string(),
  taxMode: z.enum(['NONE', 'CGST_SGST', 'IGST']), localTaxLabel: z.enum(['SGST', 'UTGST']),
}).strict();
export type InvoiceFinancialPolicy = z.infer<typeof invoiceFinancialPolicySchema>;
export const lineSnapshotSchema = z.object({
  lineNumber: z.number().int().positive(), itemId: z.number().int().positive().nullable(), itemCode: z.string().nullable(),
  itemName: z.string(), description: z.string().nullable(), hsnCode: z.string().nullable(), supplyType: z.enum(['GOODS', 'SERVICE']),
  measurementUnit: z.string(), quantity: z.string(), unitRate: z.string(), discountType: z.enum(['NONE', 'PERCENTAGE', 'FIXED']),
  discountValue: z.string(), taxRate: z.string(), baseAmount: z.string(), discountAmount: z.string(), taxableAmount: z.string(),
  cgstAmount: z.string(), sgstAmount: z.string(), igstAmount: z.string(), taxAmount: z.string(), lineTotal: z.string(), sourceLineNumber: z.number().int().positive().optional(),
});
export type InvoiceLineSnapshot = z.infer<typeof lineSnapshotSchema>;

// Billing owns the workflow; currency precision and tax arithmetic remain in Wave 03 primitives.
export function calculateInvoiceLines(input: readonly InvoiceLineInput[], policy: InvoiceFinancialPolicy, itemCodes: ReadonlyMap<number, string> = new Map()) {
  const currency = currencyCode(policy.currency);
  if (policy.taxMode !== 'NONE' && currency !== 'INR') throw new AppError('Domestic GST billing requires INR', 400);
  const amount = (value: ReturnType<typeof decimal> | string) => money(value, currency, policy.rounding).amount;
  const lines: InvoiceLineSnapshot[] = input.map((line, index) => {
    if (decimal(line.unitRate).decimalPlaces() > CURRENCY_SCALES[currency]) throw new AppError('Unit rate exceeds currency precision', 400);
    const baseAmount = amount(decimal(line.quantity).mul(decimal(line.unitRate)));
    let discountAmount = amount('0');
    const discountValue = decimal(line.discountValue);
    if (line.discountType === 'PERCENTAGE') {
      if (discountValue.gt(100)) throw new AppError('Percentage discount cannot exceed 100', 400);
      discountAmount = amount(decimal(baseAmount).mul(discountValue).div(100));
    } else if (line.discountType === 'FIXED') {
      if (discountValue.decimalPlaces() > CURRENCY_SCALES[currency]) throw new AppError('Discount exceeds currency precision', 400);
      discountAmount = amount(discountValue);
    } else if (!discountValue.isZero()) throw new AppError('A discount type is required for a nonzero discount', 400);
    if (decimal(discountAmount).gt(baseAmount)) throw new AppError('Discount cannot exceed the line value', 400);
    if (policy.taxMode === 'NONE' && !decimal(line.taxRate).isZero()) throw new AppError('This registration cannot collect GST; tax rates must be zero', 400);
    const taxableAmount = amount(decimal(baseAmount).sub(discountAmount));
    const tax = calculateTax(money(taxableAmount, currency, policy.rounding), policy.taxMode === 'NONE'
      ? { id: 'none', version: 1 } : { id: 'india-gst', version: 1, country: 'IN', mode: policy.taxMode, rate: line.taxRate }, policy.rounding);
    return {
      ...line, lineNumber: index + 1, itemId: line.itemId ?? null, itemCode: line.itemId ? itemCodes.get(line.itemId) ?? null : null,
      itemName: line.itemName!, description: line.description ?? null, hsnCode: line.hsnCode ?? null,
      baseAmount, discountAmount, taxableAmount, cgstAmount: tax.cgst, sgstAmount: tax.sgst, igstAmount: tax.igst,
      taxAmount: tax.total, lineTotal: amount(decimal(taxableAmount).add(tax.total)),
    };
  });
  return { lines, ...sumInvoiceLines(lines, policy) };
}
export function sumInvoiceLines(lines: readonly InvoiceLineSnapshot[], policy: InvoiceFinancialPolicy, extraCharges = '0') {
  const currency = currencyCode(policy.currency);
  const amount = (value: ReturnType<typeof decimal>) => money(value, currency, policy.rounding).amount;
  const sum = (field: 'baseAmount' | 'discountAmount' | 'taxableAmount' | 'taxAmount') => amount(lines.reduce((total, line) => total.add(decimal(line[field])), decimal('0')));
  const subtotal = sum('baseAmount'); const discountAmount = sum('discountAmount');
  const taxableAmount = sum('taxableAmount'); const taxAmount = sum('taxAmount');
  const beforeRounding = decimal(taxableAmount).add(taxAmount).add(decimal(extraCharges));
  const grandTotal = policy.grandTotal === 'WHOLE_UNIT' ? amount(decimal(roundDecimal(beforeRounding, 0, policy.rounding))) : amount(beforeRounding);
  if (decimal(grandTotal).gte('1000000000000000000000')) throw new AppError('Document total exceeds supported precision', 400);
  return { subtotal, discountAmount, taxableAmount, taxAmount, roundOffAmount: amount(decimal(grandTotal).sub(beforeRounding)), grandTotal };
}
