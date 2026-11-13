import { decimal, money, type Money, type RoundingMode } from '../money/index.js';

// The owning domain selects jurisdiction, registration, place of supply and rate.
// This contract calculates an explicitly selected policy; it makes no tax determination.
export type TaxPolicy = Readonly<
  { id: 'none'; version: 1 } |
  { id: 'india-gst'; version: 1; country: 'IN'; mode: 'CGST_SGST' | 'IGST'; rate: string }
>;

export function calculateTax(base: Money, policy: TaxPolicy, rounding: RoundingMode = 'HALF_UP') {
  if (decimal(base.amount).lt(0)) throw new Error('Taxable amount must be non-negative');
  const zero = money('0', base.currency, rounding).amount;
  if (policy.version !== 1) throw new Error('Unsupported tax policy version');
  if (policy.id === 'none') return { cgst: zero, sgst: zero, igst: zero, total: zero, snapshot: { ...policy } };
  if (policy.id !== 'india-gst' || policy.country !== 'IN' || base.currency !== 'INR' ||
      !['CGST_SGST', 'IGST'].includes(policy.mode) || decimal(policy.rate).lt(0) || decimal(policy.rate).gt(100)) throw new Error('Unsupported tax policy');
  const total = money(decimal(base.amount).mul(decimal(policy.rate)).div(100), base.currency, rounding).amount;
  const cgst = policy.mode === 'CGST_SGST' ? money(decimal(total).div(2), base.currency, rounding).amount : zero;
  return {
    cgst,
    sgst: policy.mode === 'CGST_SGST' ? money(decimal(total).sub(cgst), base.currency, rounding).amount : zero,
    igst: policy.mode === 'IGST' ? total : zero,
    total,
    snapshot: { ...policy },
  };
}
