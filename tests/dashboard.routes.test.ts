import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dashboardRepositoryMock = {
  getDashboardOverview: vi.fn(),
};

vi.mock('../src/modules/dashboard/dashboard.repository.js', () => ({
  dashboardRepository: dashboardRepositoryMock,
}));

const { getDashboardOverview, dashboardRepository } = await import('../src/modules/dashboard/dashboard.routes.js');

function createRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('dashboard routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the dashboard overview payload from the repository', async () => {
    vi.mocked(dashboardRepository.getDashboardOverview).mockResolvedValueOnce({
      currency: 'INR',
      range: {
        period: 'CURRENT_FINANCIAL_YEAR',
        dateFrom: '2026-04-01',
        dateTo: '2027-03-31',
        label: 'Financial Year 2026–27',
      },
      quotationMetrics: {
        totalQuotations: 0,
        totalQuotationValue: '0.00',
        averageQuotationValue: '0.00',
        acceptedQuotationCount: 0,
        acceptedQuotationValue: '0.00',
        completedQuotationCount: 0,
        completedQuotationValue: '0.00',
        openQuotationCount: 0,
        openQuotationValue: '0.00',
      },
      masterDataMetrics: { activeCompanies: 0, activeItems: 0 },
      operationalMetrics: { expiringSoonCount: 0, expiringWithinDays: 7 },
      statusBreakdown: [],
      monthlyTrend: [],
      recentQuotations: [],
      expiringQuotations: [],
      topCustomers: [],
    } as never);

    const req = { query: {} } as Request;
    const res = createRes();

    await getDashboardOverview(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Dashboard overview retrieved successfully',
      }),
    );
  });
});