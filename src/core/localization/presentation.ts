import { z } from 'zod';

export const localeSchema = z.enum(['en-IN', 'en-US', 'en-GB', 'hi-IN', 'gu-IN']);
export const languageSchema = z.enum(['en', 'hi', 'gu']);
export const timezoneSchema = z.string().max(100).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}, 'Use a supported IANA timezone');
export const presentationSchema = z.object({ language: languageSchema, locale: localeSchema, timezone: timezoneSchema }).strict();
export const localizationSnapshotSchema = presentationSchema.extend({ policyVersion: z.number().int().min(0).optional() });
export type Presentation = z.infer<typeof presentationSchema>;

// Format the integer with BigInt and retain every source fractional digit.
// Financial values must never pass through binary floating point for display.
export function formatExactDecimal(value: string, locale: z.infer<typeof localeSchema>): string {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid exact decimal');
  const [integer = '0', fraction] = value.split('.');
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const signed = BigInt(integer);
  const negativeZero = value.startsWith('-') && signed === 0n;
  const minus = formatter.formatToParts(-1).find((part) => part.type === 'minusSign')?.value ?? '-';
  const separator = new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';
  return `${negativeZero ? minus : ''}${formatter.format(signed)}${fraction === undefined ? '' : separator + fraction}`;
}
export function formatCalendarDate(value: string, locale: z.infer<typeof localeSchema>) {
  // A date-only value is a calendar date, never a timestamp shifted by a zone.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid calendar date');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
export function formatTimestamp(value: string, presentation: Presentation) {
  return new Intl.DateTimeFormat(presentation.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: presentation.timezone }).format(new Date(value));
}
