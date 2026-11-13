import { AppError } from '../../core/errors/AppError.js';
import { z } from 'zod';
import { CURRENCY_SCALES, currencyCode, decimal, money, roundDecimal, type RoundingMode } from '../../core/money/index.js';
import { calculateTax, type TaxPolicy } from '../../core/tax/index.js';

type Policy = { version: number; policy: { currency: string; rounding: RoundingMode; grandTotal: 'MINOR_UNIT' | 'WHOLE_UNIT'; tax: TaxPolicy } };
type Line = { description: string; quantity: string; unitCost: string; taxRate: string; expenseCategory?: string };
const policySnapshot = z.object({ schemaVersion: z.literal(1), businessPolicyVersion: z.number().int().nonnegative(), currency: z.string(), rounding: z.enum(['HALF_UP', 'HALF_EVEN', 'DOWN']), grandTotalPolicy: z.enum(['MINOR_UNIT', 'WHOLE_UNIT']), taxMode: z.enum(['NONE', 'CGST_SGST', 'IGST']) });

export function purchasePolicyFromSnapshot(value: unknown): Policy {
  const parsed = policySnapshot.safeParse(value);
  if (!parsed.success) throw new AppError('Purchase financial snapshot version is unsupported', 409);
  const row = parsed.data;
  return { version: row.businessPolicyVersion, policy: { currency: row.currency, rounding: row.rounding, grandTotal: row.grandTotalPolicy, tax: row.taxMode === 'NONE' ? { id: 'none', version: 1 } : { id: 'india-gst', version: 1, country: 'IN', mode: row.taxMode, rate: '0' } } };
}

// Purchase-side snapshots reuse neutral money/tax arithmetic, never the sales
// invoice lifecycle or its seller-registration/ITC decisions.
export function calculatePurchase<T extends Line>(input: readonly T[], financial: Policy, taxMode: 'NONE' | 'CGST_SGST' | 'IGST') {
  const { policy, version } = financial;
  const currency = currencyCode(policy.currency);
  if (taxMode !== 'NONE' && (policy.tax.id !== 'india-gst' || currency !== 'INR')) throw new AppError('Purchase GST requires the explicitly configured India GST policy and INR', 409);
  const amount = (value: string | ReturnType<typeof decimal>) => money(value, currency, policy.rounding).amount;
  const lines = input.map((line, index) => {
    if (decimal(line.unitCost).decimalPlaces() > CURRENCY_SCALES[currency]) throw new AppError('Purchase cost exceeds currency precision', 400);
    if (taxMode === 'NONE' && !decimal(line.taxRate).isZero()) throw new AppError('Select the supplier document tax mode before entering tax', 400);
    const base = amount(decimal(line.quantity).mul(decimal(line.unitCost)));
    const tax = calculateTax(money(base, currency, policy.rounding), taxMode === 'NONE' ? { id: 'none', version: 1 } : { id: 'india-gst', version: 1, country: 'IN', mode: taxMode, rate: line.taxRate }, policy.rounding);
    return { ...line, lineNumber: index + 1, taxableAmount: base, cgstAmount: tax.cgst, sgstAmount: tax.sgst, igstAmount: tax.igst, taxAmount: tax.total, total: amount(decimal(base).add(tax.total)) };
  });
  const subtotal = amount(lines.reduce((sum, line) => sum.add(line.taxableAmount), decimal('0')));
  const taxAmount = amount(lines.reduce((sum, line) => sum.add(line.taxAmount), decimal('0')));
  const before = decimal(subtotal).add(taxAmount);
  const total = policy.grandTotal === 'WHOLE_UNIT' ? amount(roundDecimal(before, 0, policy.rounding)) : amount(before);
  if (decimal(total).gte('1000000000000000000000')) throw new AppError('Purchase document exceeds supported precision', 400);
  return { schemaVersion: 1, currency, businessPolicyVersion: version, rounding: policy.rounding, grandTotalPolicy: policy.grandTotal, taxMode, valuation: 'MOVING_WEIGHTED_AVERAGE_NET_OF_TAX', taxTreatment: 'SUPPLIER_DECLARED_NO_ITC_CLAIM', subtotal, taxAmount, roundOffAmount: amount(decimal(total).sub(before)), total, lines };
}
