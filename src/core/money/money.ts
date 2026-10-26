import { Prisma } from '@prisma/client';

// Isolate precision from Prisma/Decimal's mutable global configuration.
const Decimal = Prisma.Decimal.clone({ precision: 48, rounding: Prisma.Decimal.ROUND_HALF_UP });
export type DecimalInput = string | Prisma.Decimal;
export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN';
export const CURRENCY_SCALES = Object.freeze({ INR: 2, USD: 2, EUR: 2, GBP: 2, AED: 2, SAR: 2, JPY: 0, KWD: 3, BHD: 3 });
export type Currency = keyof typeof CURRENCY_SCALES;
export type Money = Readonly<{ amount: string; currency: Currency }>;
const roundingModes = { HALF_UP: Decimal.ROUND_HALF_UP, HALF_EVEN: Decimal.ROUND_HALF_EVEN, DOWN: Decimal.ROUND_DOWN } as const;

export function decimal(value: DecimalInput): Prisma.Decimal {
  if (typeof value !== 'string' && !Prisma.Decimal.isDecimal(value)) throw new Error('Decimal amounts must be strings or Decimals');
  if (typeof value === 'string' && !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid decimal amount');
  const result = new Decimal(value);
  if (!result.isFinite() || result.abs().gte('1000000000000000000000000') || result.decimalPlaces() > (typeof value === 'string' ? 18 : 48)) throw new Error('Decimal amount is outside supported precision');
  return result;
}

export function currencyCode(value: string): Currency {
  if (!Object.hasOwn(CURRENCY_SCALES, value)) throw new Error(`Unsupported currency: ${value}`);
  return value as Currency;
}

export function roundDecimal(value: DecimalInput, scale: number, mode: RoundingMode = 'HALF_UP') {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18 || !Object.hasOwn(roundingModes, mode)) throw new Error('Invalid rounding policy');
  return decimal(value).toDecimalPlaces(scale, roundingModes[mode]).toFixed(scale);
}

export function money(amount: DecimalInput, currency: Currency, mode: RoundingMode = 'HALF_UP'): Money {
  return Object.freeze({ amount: roundDecimal(amount, CURRENCY_SCALES[currencyCode(currency)], mode), currency });
}

export function addMoney(left: Money, right: Money, mode: RoundingMode = 'HALF_UP'): Money {
  if (left.currency !== right.currency) throw new Error('Currency conversion requires an explicit exchange quote');
  return money(decimal(left.amount).add(decimal(right.amount)), left.currency, mode);
}

export type ExchangeQuote = Readonly<{
  from: Currency; to: Currency; rate: string; source: string; reference: string; observedAt: string;
}>;

export function convertMoney(value: Money, quote: ExchangeQuote, mode: RoundingMode = 'HALF_UP') {
  currencyCode(quote.from);
  currencyCode(quote.to);
  if (value.currency !== quote.from || quote.from === quote.to || decimal(quote.rate).lte(0) ||
      !quote.source.trim() || !quote.reference.trim() || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(quote.observedAt) || !Number.isFinite(Date.parse(quote.observedAt))) {
    throw new Error('A matching, positive exchange quote with provenance is required');
  }
  return Object.freeze({ value: money(decimal(value.amount).mul(decimal(quote.rate)), quote.to, mode), quote: Object.freeze({ ...quote }) });
}
