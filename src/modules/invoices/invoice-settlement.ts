import { AppError } from '../../core/errors/AppError.js';
import { currencyCode, decimal, money, type DecimalInput } from '../../core/money/index.js';

export function invoiceSettlement(input: { currency: string; total: DecimalInput; credits: DecimalInput; debits: DecimalInput; allocated: DecimalInput; dueDate: string | null }, today: string) {
  const currency = currencyCode(input.currency);
  const adjusted = decimal(input.total).add(input.debits).sub(input.credits);
  const allocated = decimal(input.allocated);
  if (adjusted.lt(0) || allocated.lt(0) || allocated.gt(adjusted)) throw new AppError('Invoice settlement does not reconcile; review receipt allocations and adjustments', 409);
  const outstanding = adjusted.sub(allocated);
  const overdueDays = input.dueDate && input.dueDate < today && outstanding.gt(0) ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${input.dueDate}T00:00:00Z`)) / 86400000) : 0;
  return {
    currency, adjustedTotal: money(adjusted, currency).amount, allocated: money(allocated, currency).amount,
    outstanding: money(outstanding, currency).amount,
    settlementStatus: outstanding.isZero() ? 'PAID' as const : allocated.gt(0) ? 'PARTIAL' as const : 'UNPAID' as const,
    overdue: overdueDays > 0, overdueDays,
    ageingBucket: overdueDays === 0 ? 'CURRENT' as const : overdueDays <= 30 ? 'DAYS_1_30' as const : overdueDays <= 60 ? 'DAYS_31_60' as const : overdueDays <= 90 ? 'DAYS_61_90' as const : 'DAYS_91_PLUS' as const,
  };
}
