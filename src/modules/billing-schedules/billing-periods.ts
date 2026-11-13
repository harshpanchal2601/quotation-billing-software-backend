import { AppError } from '../../core/errors/AppError.js';

export function addCalendarDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  if (!Number.isFinite(result.getTime()) || result.getUTCFullYear() > 9999) throw new AppError('Billing date exceeds the supported calendar', 409);
  return result.toISOString().slice(0, 10);
}

// Always calculate from the original day, so Jan 31 → Feb 28 → Mar 31.
export function nextBillingPeriod(anchor: string, current: string, intervalMonths: number) {
  const origin = new Date(`${anchor}T00:00:00Z`);
  const date = new Date(`${current}T00:00:00Z`);
  const elapsed = (date.getUTCFullYear() - origin.getUTCFullYear()) * 12 + date.getUTCMonth() - origin.getUTCMonth();
  if (![1, 3, 12].includes(intervalMonths) || elapsed < 0 || elapsed % intervalMonths !== 0) throw new AppError('Invalid billing period', 409);
  const next = new Date(Date.UTC(origin.getUTCFullYear(), origin.getUTCMonth() + elapsed + intervalMonths, 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(origin.getUTCDate(), lastDay));
  if (next.getUTCFullYear() > 9999) throw new AppError('Billing calendar exhausted', 409);
  return next.toISOString().slice(0, 10);
}
