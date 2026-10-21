import { Prisma, QuotationStatus, type PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { DashboardRepository, resolveDashboardDateRange } from '../src/modules/dashboard/dashboard.repository.js';
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

describe('dashboard currency boundaries', () => {
  const date = new Date('2026-06-01T00:00:00Z');
  function quotation(id: number, currency: string, amount: string, status: QuotationStatus) {
    return {
      id, currency, grandTotal: new Prisma.Decimal(amount), status,
      quotationNumber: `ERP/2026-27/${id}`, revisionNumber: 0, companyId: id,
      companyNameSnapshot: `Customer ${id}`, contactNameSnapshot: null,
      quotationDate: date, validUntil: null, createdAt: date, updatedAt: date,
    };
  }

  it.each(['INR', 'USD'])('scopes all monetary aggregates to %s and keeps overall counts', async (currency) => {
    const db = {
      quotation: { findMany: vi.fn().mockResolvedValueOnce([
        quotation(1, 'INR', '100.10', QuotationStatus.ACCEPTED),
        quotation(2, 'INR', '200.20', QuotationStatus.DRAFT),
        quotation(3, 'USD', '900.90', QuotationStatus.COMPLETED),
      ]).mockResolvedValueOnce([]) },
      company: { count: vi.fn().mockResolvedValue(2) },
      item: { count: vi.fn().mockResolvedValue(5) },
      businessProfile: { findUnique: vi.fn().mockResolvedValue({ defaultCurrency: 'INR' }) },
    };
    const result = await new DashboardRepository(db as unknown as PrismaClient).getDashboardOverview(1, {
      currency, period: 'CUSTOM', dateFrom: '2026-06-01', dateTo: '2026-06-30',
    });
    expect(result.currencyTotals).toEqual([
      { currency: 'INR', quotationCount: 2, totalQuotationValue: '300.30' },
      { currency: 'USD', quotationCount: 1, totalQuotationValue: '900.90' },
    ]);
    expect(result.quotationMetrics).toMatchObject({
      totalQuotations: 3, acceptedQuotationCount: 2, completedQuotationCount: 1, openQuotationCount: 1,
      totalQuotationValue: currency === 'INR' ? '300.30' : '900.90',
      averageQuotationValue: currency === 'INR' ? '150.15' : '900.90',
      acceptedQuotationValue: currency === 'INR' ? '100.10' : '900.90',
      completedQuotationValue: currency === 'INR' ? '0.00' : '900.90',
      openQuotationValue: currency === 'INR' ? '200.20' : '0.00',
    });
    expect(result.monthlyTrend[0]).toMatchObject({
      quotationCount: 3, totalQuotationValue: currency === 'INR' ? '300.30' : '900.90',
      acceptedQuotationCount: 2, acceptedQuotationValue: currency === 'INR' ? '100.10' : '900.90',
    });
    expect(result.statusBreakdown.find((item) => item.status === QuotationStatus.COMPLETED)).toMatchObject({
      count: 1, totalValue: currency === 'INR' ? '0.00' : '900.90',
    });
    expect(result.topCustomers.map((customer) => customer.companyId)).toEqual(currency === 'INR' ? [2, 1] : [3]);
    expect(result.masterDataMetrics).toEqual({ activeCompanies: 2, activeItems: 5 });
    expect(db.quotation.findMany.mock.calls.every(([query]) => query.where.firmId === 1)).toBe(true);
  });
});
