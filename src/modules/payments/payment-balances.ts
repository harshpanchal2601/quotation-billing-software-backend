import { AppError } from '../../core/errors/AppError.js';
import { CURRENCY_SCALES, currencyCode, decimal, money, type DecimalInput } from '../../core/money/index.js';

export function receiptAmount(value: string, code: string) {
  const currency = currencyCode(code);
  const amount = decimal(value);
  if (amount.lte(0) || amount.gte('1000000000000000000000') || amount.decimalPlaces() > CURRENCY_SCALES[currency]) throw new AppError('Use a positive amount within the currency precision', 400);
  return money(amount, currency).amount;
}

export function paymentBalance(input: { amount: DecimalInput; currency: string; allocations: readonly { amount: DecimalInput }[]; refunds: readonly { amount: DecimalInput }[]; reversal: { amount: DecimalInput } | null }) {
  const currency = currencyCode(input.currency);
  const refunded = input.refunds.reduce((total, row) => total.add(row.amount), decimal('0'));
  const reversed = input.reversal ? decimal(input.reversal.amount) : decimal('0');
  const net = decimal(input.amount).sub(refunded).sub(reversed);
  const allocated = input.reversal ? decimal('0') : input.allocations.reduce((total, row) => total.add(row.amount), decimal('0'));
  const unapplied = net.sub(allocated);
  if (net.lt(0) || allocated.lt(0) || unapplied.lt(0) || (input.reversal && !net.isZero())) throw new AppError('Receipt ledger does not reconcile', 409);
  return { netAmount: money(net, currency).amount, allocated: money(allocated, currency).amount, unapplied: money(unapplied, currency).amount, refunded: money(refunded, currency).amount, reversed: money(reversed, currency).amount };
}
