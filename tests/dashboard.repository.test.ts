import { describe, expect, it } from 'vitest';

import { resolveDashboardDateRange } from '../src/modules/dashboard/dashboard.repository.js';
import { dashboardOverviewQuerySchema } from '../src/modules/dashboard/dashboard.schema.js';

describe('dashboard repository helpers and validation', () => {
  it('resolves CURRENT_FINANCIAL_YEAR correctly based on Indian financial year (April 1 to March 31)', () => {
    // Test date in July 2026 -> FY 2026-27 (2026-04-01 to 2027-03-31)
    const julyDate = new Date('2026-07-26T10:00:00.000Z');
    const fyJuly = resolveDashboardDateRange('CURRENT_FINANCIAL_YEAR', undefined, undefined, julyDate);

    expect(fyJuly.dateFrom).toBe('2026-04-01');
    expect(fyJuly.dateTo).toBe('2027-03-31');
    expect(fyJuly.label).toContain('Financial Year 2026–27');

    // Test date in February 2026 -> FY 2025-26 (2025-04-01 to 2026-03-31)
    const febDate = new Date('2026-02-15T10:00:00.000Z');
    const fyFeb = resolveDashboardDateRange('CURRENT_FINANCIAL_YEAR', undefined, undefined, febDate);

    expect(fyFeb.dateFrom).toBe('2025-04-01');
    expect(fyFeb.dateTo).toBe('2026-03-31');
    expect(fyFeb.label).toContain('Financial Year 2025–26');
  });

  it('validates custom date range requires dateFrom <= dateTo and maximum 24 months', () => {
    // Valid custom range
    const validResult = dashboardOverviewQuerySchema.safeParse({
      period: 'CUSTOM',
      dateFrom: '2026-01-01',
      dateTo: '2026-06-30',
    });
    expect(validResult.success).toBe(true);

    // Invalid: dateFrom > dateTo
    const invalidReverse = dashboardOverviewQuerySchema.safeParse({
      period: 'CUSTOM',
      dateFrom: '2026-07-01',
      dateTo: '2026-01-01',
    });
    expect(invalidReverse.success).toBe(false);

    // Invalid: exceeds 24 months
    const invalidLong = dashboardOverviewQuerySchema.safeParse({
      period: 'CUSTOM',
      dateFrom: '2023-01-01',
      dateTo: '2026-01-01',
    });
    expect(invalidLong.success).toBe(false);
  });
});
