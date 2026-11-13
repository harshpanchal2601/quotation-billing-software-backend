import { describe, expect, it } from 'vitest';
import { formatCalendarDate, formatExactDecimal, formatTimestamp, presentationSchema } from '../src/core/localization/presentation.js';
import { businessPolicySchema } from '../src/modules/settings/business-policy/business-policy.schema.js';
describe('Wave 10 exact presentation and snapshot policy', () => {
  it('retains fractional precision beyond floating point across supported number grouping', () => {
    const raw = '9007199254740993.123';
    expect(formatExactDecimal(raw, 'en-US')).toBe('9,007,199,254,740,993.123');
    expect(formatExactDecimal(raw, 'en-IN')).toBe('9,00,71,99,25,47,40,993.123');
    expect(formatExactDecimal('-0.001', 'hi-IN')).toBe('-0.001');
    expect(formatExactDecimal('1000000.000001', 'gu-IN')).toBe('10,00,000.000001');
    expect(raw).toBe('9007199254740993.123');
  });
  it('keeps calendar dates independent of timezones while displaying timestamps in the selected zone', () => {
    expect(formatCalendarDate('2026-11-09', 'en-US')).toBe('Nov 9, 2026');
    expect(() => formatCalendarDate('2026-02-30', 'en-US')).toThrow();
    const presentation = presentationSchema.parse({ language: 'en', locale: 'en-US', timezone: 'America/Los_Angeles' });
    expect(formatTimestamp('2026-11-09T00:30:00Z', presentation)).toContain('Nov 8, 2026');
    expect(() => presentationSchema.parse({ ...presentation, timezone: 'invalid/zone' })).toThrow();
  });
  it('adds presentation to the existing versioned business policy without changing monetary rules', () => {
    const policy = { schemaVersion: 1, currency: 'INR', rounding: 'HALF_UP', grandTotal: 'MINOR_UNIT', tax: { id: 'none', version: 1 }, inAppNotifications: false };
    expect(businessPolicySchema.parse(policy)).toEqual(policy);
    const presentation = { language: 'gu', locale: 'gu-IN', timezone: 'Asia/Kolkata' };
    expect(businessPolicySchema.parse({ ...policy, presentation })).toEqual({ ...policy, presentation });
  });
});
