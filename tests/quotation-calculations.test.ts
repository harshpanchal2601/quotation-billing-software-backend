import { TaxMode } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { calculateQuotationTotals, convertAmountToWords } from '../src/modules/quotations/calculations/quotation-calculations.js';

describe('currency wording golden values', () => {
  it.each([
    ['USD', 'US Dollar', 'US Dollars'], ['AED', 'UAE Dirham', 'UAE Dirhams'], ['SAR', 'Saudi Riyal', 'Saudi Riyals'],
  ])('words singular and zero %s amounts explicitly', (currency, singular, plural) => {
    expect(convertAmountToWords('1.49', currency)).toBe(`One ${singular} Only`);
    expect(convertAmountToWords('0', currency)).toBe(`Zero ${plural} Only`);
  });
  it.each([
    ['INR', 'One Lakh Twenty Three Thousand Four Hundred Fifty Seven Rupees Only'],
    ['USD', 'One Hundred Twenty Three Thousand Four Hundred Fifty Seven US Dollars Only'],
    ['AED', 'One Hundred Twenty Three Thousand Four Hundred Fifty Seven UAE Dirhams Only'],
    ['SAR', 'One Hundred Twenty Three Thousand Four Hundred Fifty Seven Saudi Riyals Only'],
    ['XYZ', 'One Hundred Twenty Three Thousand Four Hundred Fifty Seven XYZ Only'],
  ])('preserves numeric policy while wording %s explicitly', (currency, expected) => {
    const result = calculateQuotationTotals({
      currency, taxMode: TaxMode.NONE,
      items: [{ quantity: '1', unitRate: '123456.78', gstRate: 0 }],
    });
    expect(result.grandTotal).toBe('123457.00');
    expect(result.roundOffAmount).toBe('0.22');
    expect(result.amountInWords).toBe(expected);
  });

  it('keeps large decimal values exact', () => {
    const result = calculateQuotationTotals({
      currency: 'USD', taxMode: TaxMode.NONE,
      items: [{ quantity: '1', unitRate: '9999999999998.49', gstRate: 0 }],
    });
    expect(result.grandTotal).toBe('9999999999998.00');
    expect(result.roundOffAmount).toBe('-0.49');
    expect(result.amountInWords).toBe('Nine Trillion Nine Hundred Ninety Nine Billion Nine Hundred Ninety Nine Million Nine Hundred Ninety Nine Thousand Nine Hundred Ninety Eight US Dollars Only');
  });
});
