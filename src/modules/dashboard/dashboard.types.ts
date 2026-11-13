import type { QuotationStatus } from '@prisma/client';

export type DashboardPeriod =
  | 'CURRENT_FINANCIAL_YEAR'
  | 'LAST_30_DAYS'
  | 'LAST_90_DAYS'
  | 'CURRENT_CALENDAR_YEAR'
  | 'CUSTOM';

export type DashboardOverviewQuery = {
  currency?: string;
  period?: DashboardPeriod;
  dateFrom?: string;
  dateTo?: string;
};

export type DashboardDateRange = {
  period: DashboardPeriod;
  dateFrom: string;
  dateTo: string;
  label: string;
};

export type QuotationMetricsDto = {
  totalQuotations: number;
  totalQuotationValue: string;
  averageQuotationValue: string;
  acceptedQuotationCount: number;
  acceptedQuotationValue: string;
  completedQuotationCount: number;
  completedQuotationValue: string;
  openQuotationCount: number;
  openQuotationValue: string;
};

export type MasterDataMetricsDto = {
  activeCompanies: number;
  activeItems: number;
};

export type OperationalMetricsDto = {
  expiringSoonCount: number;
  expiringWithinDays: number;
};

export type StatusBreakdownDto = {
  status: QuotationStatus;
  count: number;
  totalValue: string;
  percentageOfCount: string;
};

export type MonthlyTrendDto = {
  month: string;
  label: string;
  quotationCount: number;
  totalQuotationValue: string;
  acceptedQuotationCount: number;
  acceptedQuotationValue: string;
};

export type RecentQuotationDto = {
  id: number;
  quotationNumber: string;
  revisionNumber: number;
  companySnapshotName: string;
  contactSnapshotName: string | null;
  quotationDate: string;
  validUntil: string | null;
  status: QuotationStatus;
  currency: string;
  grandTotal: string;
  createdAt: string;
  updatedAt: string;
};

export type ExpiringQuotationDto = {
  id: number;
  quotationNumber: string;
  companySnapshotName: string;
  validUntil: string;
  daysRemaining: number;
  status: QuotationStatus;
  currency: string;
  grandTotal: string;
};

export type TopCustomerDto = {
  companyId: number;
  companyName: string;
  quotationCount: number;
  totalQuotationValue: string;
  acceptedQuotationCount: number;
  acceptedQuotationValue: string;
};

export type DashboardOverviewData = {
  currency: string;
  currencyTotals: Array<{ currency: string; quotationCount: number; totalQuotationValue: string }>;
  range: DashboardDateRange;
  quotationMetrics: QuotationMetricsDto;
  masterDataMetrics: MasterDataMetricsDto;
  operationalMetrics: OperationalMetricsDto;
  statusBreakdown: StatusBreakdownDto[];
  monthlyTrend: MonthlyTrendDto[];
  recentQuotations: RecentQuotationDto[];
  expiringQuotations: ExpiringQuotationDto[];
  topCustomers: TopCustomerDto[];
};
