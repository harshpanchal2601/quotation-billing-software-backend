import { DiscountType, Prisma, TaxMode } from '@prisma/client';
import { roundDecimal } from '../../../core/money/index.js';

import type {
  CalculatedLineItem,
  CalculatedQuotationTotals,
  CalculationPreviewInput,
} from '../quotations.types.js';

export function calculateQuotationTotals(
  input: CalculationPreviewInput,
): CalculatedQuotationTotals {
  const taxMode = input.taxMode ?? TaxMode.CGST_SGST;
  const quotationDiscountType = input.quotationDiscountType ?? DiscountType.NONE;
  const rawQuoDiscountVal = toDecimal(input.quotationDiscountValue ?? 0);
  const freightAmount = toDecimal(input.freightAmount ?? 0).abs().toDecimalPlaces(2);
  const otherCharges = toDecimal(input.otherCharges ?? 0).abs().toDecimalPlaces(2);

  const itemsInput = input.items ?? [];

  const rawLines = itemsInput.map((item, index) => {
    const quantity = toDecimal(item.quantity).abs();
    const unitRate = toDecimal(item.unitRate).abs().toDecimalPlaces(2);
    const baseAmount = quantity.mul(unitRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const lineDiscType = item.discountType ?? DiscountType.NONE;
    const lineDiscVal = toDecimal(item.discountValue ?? 0).abs();
    let lineDiscountAmount = new Prisma.Decimal(0);

    if (lineDiscType === DiscountType.PERCENTAGE) {
      const pct = DecimalMin(lineDiscVal, new Prisma.Decimal(100));
      lineDiscountAmount = baseAmount.mul(pct).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    } else if (lineDiscType === DiscountType.FIXED) {
      lineDiscountAmount = DecimalMin(lineDiscVal, baseAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    }

    const preHeaderTaxable = baseAmount.sub(lineDiscountAmount);

    return {
      lineNumber: item.lineNumber ?? index + 1,
      itemId: item.itemId ?? null,
      itemCodeSnapshot: null,
      itemNameSnapshot: item.itemName ?? `Item #${index + 1}`,
      descriptionSnapshot: item.description ?? null,
      specificationsSnapshot: item.specifications ?? null,
      measurementUnitSnapshot: item.measurementUnit ?? 'NOS',
      quantity,
      unitRate,
      lineDiscType,
      lineDiscVal,
      lineDiscountAmount,
      baseAmount,
      preHeaderTaxable,
      gstRate: toDecimal(item.gstRate ?? 18).abs().toDecimalPlaces(2),
      sortOrder: item.sortOrder ?? index,
    };
  });

  const subtotal = rawLines.reduce((acc, line) => acc.add(line.baseAmount), new Prisma.Decimal(0));
  const itemDiscountAmount = rawLines.reduce(
    (acc, line) => acc.add(line.lineDiscountAmount),
    new Prisma.Decimal(0),
  );
  const netSubtotal = subtotal.sub(itemDiscountAmount);

  let quotationDiscountAmount = new Prisma.Decimal(0);
  if (quotationDiscountType === DiscountType.PERCENTAGE) {
    const pct = DecimalMin(rawQuoDiscountVal, new Prisma.Decimal(100));
    quotationDiscountAmount = netSubtotal.mul(pct).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  } else if (quotationDiscountType === DiscountType.FIXED) {
    quotationDiscountAmount = DecimalMin(rawQuoDiscountVal, netSubtotal).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  const allocatedHeaderDiscounts: Prisma.Decimal[] = rawLines.map((line) => {
    if (netSubtotal.isZero() || quotationDiscountAmount.isZero()) {
      return new Prisma.Decimal(0);
    }
    return quotationDiscountAmount
      .mul(line.preHeaderTaxable)
      .div(netSubtotal)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  });

  const sumAllocated = allocatedHeaderDiscounts.reduce(
    (acc, val) => acc.add(val),
    new Prisma.Decimal(0),
  );
  const remainder = quotationDiscountAmount.sub(sumAllocated);

  if (!remainder.isZero() && rawLines.length > 0) {
    let lastEligibleIndex = rawLines.length - 1;
    for (let i = rawLines.length - 1; i >= 0; i--) {
      if (rawLines[i]!.preHeaderTaxable.gt(0)) {
        lastEligibleIndex = i;
        break;
      }
    }
    allocatedHeaderDiscounts[lastEligibleIndex] = allocatedHeaderDiscounts[lastEligibleIndex]!.add(remainder);
  }

  const calculatedItems: CalculatedLineItem[] = rawLines.map((line, i) => {
    const totalLineDiscount = line.lineDiscountAmount.add(allocatedHeaderDiscounts[i]!);
    const taxableAmount = DecimalMax(new Prisma.Decimal(0), line.baseAmount.sub(totalLineDiscount)).toDecimalPlaces(2);

    let cgst = new Prisma.Decimal(0);
    let sgst = new Prisma.Decimal(0);
    let igst = new Prisma.Decimal(0);
    let totalTax = new Prisma.Decimal(0);

    if (taxMode === TaxMode.CGST_SGST) {
      totalTax = taxableAmount.mul(line.gstRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      cgst = totalTax.div(2).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      sgst = totalTax.sub(cgst);
    } else if (taxMode === TaxMode.IGST) {
      igst = taxableAmount.mul(line.gstRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      totalTax = igst;
    }

    const lineTotal = taxableAmount.add(totalTax);

    return {
      lineNumber: line.lineNumber,
      itemId: line.itemId,
      itemCodeSnapshot: line.itemCodeSnapshot,
      itemNameSnapshot: line.itemNameSnapshot,
      descriptionSnapshot: line.descriptionSnapshot,
      specificationsSnapshot: line.specificationsSnapshot,
      measurementUnitSnapshot: line.measurementUnitSnapshot,
      quantity: line.quantity.toFixed(3),
      unitRate: line.unitRate.toFixed(2),
      discountType: line.lineDiscType,
      discountValue: line.lineDiscVal.toFixed(2),
      discountAmount: totalLineDiscount.toFixed(2),
      baseAmount: line.baseAmount.toFixed(2),
      taxableAmount: taxableAmount.toFixed(2),
      gstRate: line.gstRate.toFixed(2),
      cgstAmount: cgst.toFixed(2),
      sgstAmount: sgst.toFixed(2),
      igstAmount: igst.toFixed(2),
      taxAmount: totalTax.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
      sortOrder: line.sortOrder,
    };
  });

  const totalTaxableAmount = calculatedItems.reduce(
    (acc, line) => acc.add(new Prisma.Decimal(line.taxableAmount)),
    new Prisma.Decimal(0),
  );
  const totalCgst = calculatedItems.reduce(
    (acc, line) => acc.add(new Prisma.Decimal(line.cgstAmount)),
    new Prisma.Decimal(0),
  );
  const totalSgst = calculatedItems.reduce(
    (acc, line) => acc.add(new Prisma.Decimal(line.sgstAmount)),
    new Prisma.Decimal(0),
  );
  const totalIgst = calculatedItems.reduce(
    (acc, line) => acc.add(new Prisma.Decimal(line.igstAmount)),
    new Prisma.Decimal(0),
  );

  const preRoundTotal = totalTaxableAmount
    .add(totalCgst)
    .add(totalSgst)
    .add(totalIgst)
    .add(freightAmount)
    .add(otherCharges);

  const roundedGrandTotal = new Prisma.Decimal(roundDecimal(preRoundTotal, 0, 'HALF_UP'));
  const roundOffAmount = roundedGrandTotal.sub(preRoundTotal);

  return {
    subtotal: subtotal.toFixed(2),
    itemDiscountAmount: itemDiscountAmount.toFixed(2),
    quotationDiscountType,
    quotationDiscountValue: rawQuoDiscountVal.toFixed(2),
    quotationDiscountAmount: quotationDiscountAmount.toFixed(2),
    taxableAmount: totalTaxableAmount.toFixed(2),
    cgstAmount: totalCgst.toFixed(2),
    sgstAmount: totalSgst.toFixed(2),
    igstAmount: totalIgst.toFixed(2),
    freightAmount: freightAmount.toFixed(2),
    otherCharges: otherCharges.toFixed(2),
    roundOffAmount: roundOffAmount.toFixed(2),
    grandTotal: roundedGrandTotal.toFixed(2),
    amountInWords: convertAmountToWords(roundedGrandTotal, input.currency),
    items: calculatedItems,
  };
}

function toDecimal(value: number | string | Prisma.Decimal | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined || value === '') return new Prisma.Decimal(0);
  if (value instanceof Prisma.Decimal) return value;
  try {
    return new Prisma.Decimal(String(value));
  } catch {
    return new Prisma.Decimal(0);
  }
}

function DecimalMin(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.lessThan(b) ? a : b;
}

function DecimalMax(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return a.greaterThan(b) ? a : b;
}

export function convertAmountToWords(amount: number | string | Prisma.Decimal, currency = 'INR'): string {
  const rounded = new Prisma.Decimal(amount).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  const code = currency.trim().toUpperCase();
  const currencyNames: Record<string, [string, string]> = {
    INR: ['Rupees', 'Rupees'], USD: ['US Dollar', 'US Dollars'],
    AED: ['UAE Dirham', 'UAE Dirhams'], SAR: ['Saudi Riyal', 'Saudi Riyals'],
  };
  // Preserve accepted legacy codes without inventing a currency name or fraction policy.
  const currencyName = currencyNames[code]?.[rounded.eq(1) ? 0 : 1] ?? code;
  if (rounded.lte(0)) return `Zero ${currencyName} Only`;

  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function numToWords(n: number): string {
    if (n < 10) return units[n]!;
    if (n < 20) return teens[n - 10]!;
    if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 !== 0 ? ` ${units[n % 10]}` : ''}`;
    if (n < 1000) return `${units[Math.floor(n / 100)]} Hundred${n % 100 !== 0 ? ` ${numToWords(n % 100)}` : ''}`;
    if (n < 100000) return `${numToWords(Math.floor(n / 1000))} Thousand${n % 1000 !== 0 ? ` ${numToWords(n % 1000)}` : ''}`;
    if (n < 10000000) return `${numToWords(Math.floor(n / 100000))} Lakh${n % 100000 !== 0 ? ` ${numToWords(n % 100000)}` : ''}`;
    return `${numToWords(Math.floor(n / 10000000))} Crore${n % 10000000 !== 0 ? ` ${numToWords(n % 10000000)}` : ''}`;
  }

  let words: string;
  if (code === 'INR') {
    // Stored quotation totals have 13 integer digits, within the exact integer range.
    words = numToWords(rounded.toNumber());
  } else {
    const scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
    const groups = rounded.toFixed(0).match(/\d{1,3}(?=(\d{3})*$)/g) ?? [];
    words = groups.map((group, index) => {
      const value = Number(group);
      if (value === 0) return '';
      const scale = scales[groups.length - index - 1];
      return `${numToWords(value)}${scale ? ` ${scale}` : ''}`;
    }).filter(Boolean).join(' ');
  }
  return `${words} ${currencyName} Only`;
}
