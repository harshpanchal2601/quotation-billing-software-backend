import { describe, expect, it } from 'vitest';
import { addMoney, convertMoney, decimal, money, roundDecimal } from '../src/core/money/index.js';
import { calculateTax } from '../src/core/tax/index.js';

describe('explicit Decimal money', () => {
  it('preserves large values and exact decimal addition', () => {
    expect(addMoney(money('9999999999999.90', 'INR'), money('0.10', 'INR')).amount).toBe('10000000000000.00');
    expect(addMoney(money('0.1', 'USD'), money('0.2', 'USD')).amount).toBe('0.30');
  });
  it('uses explicit currency minor units and rounding golden cases', () => {
    expect(money('1.5', 'JPY').amount).toBe('2');
    expect(money('1.2345', 'KWD').amount).toBe('1.235');
    expect(roundDecimal('2.345', 2, 'HALF_EVEN')).toBe('2.34');
    expect(roundDecimal('-2.345', 2, 'HALF_UP')).toBe('-2.35');
    expect(roundDecimal('2.349', 2, 'DOWN')).toBe('2.34');
  });
  it('rejects floats, nonfinite inputs, unsupported currencies and implicit FX', () => {
    for (const value of [0.1, 'NaN', 'Infinity', '', '1e6']) expect(() => decimal(value as string)).toThrow();
    expect(() => money('1', 'XXX' as 'INR')).toThrow();
    expect(() => addMoney(money('1', 'INR'), money('1', 'USD'))).toThrow();
  });
  it('requires and returns an immutable exchange quote snapshot', () => {
    const quote = { from: 'USD', to: 'INR', rate: '83.123456', source: 'fixture', reference: 'quote-1', observedAt: '2026-10-21T12:00:00Z' } as const;
    expect(convertMoney(money('10', 'USD'), quote)).toMatchObject({ value: { amount: '831.23', currency: 'INR' }, quote });
    expect(() => convertMoney(money('1', 'USD'), { ...quote, source: '' })).toThrow();
    expect(() => convertMoney(money('1', 'USD'), { ...quote, rate: '-1' })).toThrow();
  });
});

describe('versioned explicit tax math', () => {
  it('splits GST with conserved rounded total, including odd paise', () => {
    expect(calculateTax(money('1.50', 'INR'), { id: 'india-gst', version: 1, country: 'IN', mode: 'CGST_SGST', rate: '18' })).toMatchObject({ cgst: '0.14', sgst: '0.13', total: '0.27', igst: '0.00' });
    expect(calculateTax(money('100', 'INR'), { id: 'india-gst', version: 1, country: 'IN', mode: 'IGST', rate: '18' })).toMatchObject({ cgst: '0.00', sgst: '0.00', igst: '18.00', total: '18.00' });
  });
  it('supports explicit no-tax mode across currencies and rejects unsupported regimes', () => {
    expect(calculateTax(money('12.345', 'KWD'), { id: 'none', version: 1 }).total).toBe('0.000');
    expect(() => calculateTax(money('100', 'USD'), { id: 'india-gst', version: 1, country: 'IN', mode: 'IGST', rate: '18' })).toThrow();
    expect(() => calculateTax(money('1', 'INR'), { id: 'none', version: 2 } as never)).toThrow();
  });
});
