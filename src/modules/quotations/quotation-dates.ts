const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const VALID_UNTIL_DATE_MESSAGE = 'Valid Until cannot be earlier than the Quotation Date.';

export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]!);
  const month = Number(match[2]!);
  const day = Number(match[3]!);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseDateOnlyToUtcDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  return new Date(`${value}T00:00:00.000Z`);
}

export function serialiseDateOnly(value: Date): string {
  return value.toISOString().split('T')[0]!;
}

export function isValidUntilBeforeQuotationDate(validUntil: string, quotationDate: string): boolean {
  return validUntil.localeCompare(quotationDate) < 0;
}
