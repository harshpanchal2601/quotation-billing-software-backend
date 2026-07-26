import { Prisma, QuotationStatus } from '@prisma/client';

import { prisma } from '../../config/database.js';
import type {
  DashboardDateRange,
  DashboardOverviewData,
  DashboardOverviewQuery,
  DashboardPeriod,
  ExpiringQuotationDto,
  MonthlyTrendDto,
  RecentQuotationDto,
  StatusBreakdownDto,
  TopCustomerDto,
} from './dashboard.types.js';

const ALL_QUOTATION_STATUSES: QuotationStatus[] = [
  QuotationStatus.DRAFT,
  QuotationStatus.PENDING,
  QuotationStatus.SENT,
  QuotationStatus.ACCEPTED,
  QuotationStatus.REJECTED,
  QuotationStatus.EXPIRED,
  QuotationStatus.CANCELLED,
  QuotationStatus.COMPLETED,
];

const OPEN_STATUSES: QuotationStatus[] = [
  QuotationStatus.DRAFT,
  QuotationStatus.PENDING,
  QuotationStatus.SENT,
];

const ACCEPTED_STATUSES: QuotationStatus[] = [
  QuotationStatus.ACCEPTED,
  QuotationStatus.COMPLETED,
];

export function resolveDashboardDateRange(
  period: DashboardPeriod = 'CURRENT_FINANCIAL_YEAR',
  customDateFrom?: string,
  customDateTo?: string,
  now: Date = new Date(),
): DashboardDateRange {
  let dateFromStr = '';
  let dateToStr = '';
  let label = '';

  const formatIsoDate = (d: Date): string => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  switch (period) {
    case 'CURRENT_FINANCIAL_YEAR': {
      const year = now.getFullYear();
      const month = now.getMonth() + 1; // 1-12
      const startYear = month >= 4 ? year : year - 1;
      const endYear = startYear + 1;

      dateFromStr = `${startYear}-04-01`;
      dateToStr = `${endYear}-03-31`;
      const endYY = String(endYear).slice(-2);
      label = `Financial Year ${startYear}–${endYY}`;
      break;
    }
    case 'LAST_30_DAYS': {
      const to = new Date(now);
      const from = new Date(now);
      from.setDate(from.getDate() - 29);

      dateFromStr = formatIsoDate(from);
      dateToStr = formatIsoDate(to);
      label = 'Last 30 Days';
      break;
    }
    case 'LAST_90_DAYS': {
      const to = new Date(now);
      const from = new Date(now);
      from.setDate(from.getDate() - 89);

      dateFromStr = formatIsoDate(from);
      dateToStr = formatIsoDate(to);
      label = 'Last 90 Days';
      break;
    }
    case 'CURRENT_CALENDAR_YEAR': {
      const year = now.getFullYear();
      dateFromStr = `${year}-01-01`;
      dateToStr = `${year}-12-31`;
      label = `Calendar Year ${year}`;
      break;
    }
    case 'CUSTOM': {
      dateFromStr = customDateFrom || formatIsoDate(now);
      dateToStr = customDateTo || formatIsoDate(now);
      label = `${dateFromStr} to ${dateToStr}`;
      break;
    }
    default: {
      const year = now.getFullYear();
      dateFromStr = `${year}-04-01`;
      dateToStr = `${year + 1}-03-31`;
      label = `Financial Year ${year}–${String(year + 1).slice(-2)}`;
      break;
    }
  }

  return {
    period,
    dateFrom: dateFromStr,
    dateTo: dateToStr,
    label,
  };
}

export async function getDashboardOverviewService(
  query: DashboardOverviewQuery,
): Promise<DashboardOverviewData> {
  const range = resolveDashboardDateRange(query.period, query.dateFrom, query.dateTo);

  const startBound = new Date(`${range.dateFrom}T00:00:00.000Z`);
  const endBound = new Date(`${range.dateTo}T23:59:59.999Z`);

  // Parallel database queries
  const [
    quotations,
    activeCompaniesCount,
    activeItemsCount,
    expiringQuotationsRaw,
    businessProfile,
  ] = await Promise.all([
    // Period quotations select minimal required fields
    prisma.quotation.findMany({
      where: {
        deletedAt: null,
        quotationDate: {
          gte: startBound,
          lte: endBound,
        },
      },
      select: {
        id: true,
        quotationNumber: true,
        revisionNumber: true,
        companyId: true,
        companyNameSnapshot: true,
        contactNameSnapshot: true,
        quotationDate: true,
        validUntil: true,
        status: true,
        currency: true,
        grandTotal: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),

    // Master data: active companies
    prisma.company.count({
      where: { isActive: true, deletedAt: null },
    }),

    // Master data: active items
    prisma.item.count({
      where: { isActive: true, deletedAt: null },
    }),

    // Operational: quotations expiring in next 7 days
    (() => {
      const today = new Date();
      const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
      const endSevenDays = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7, 23, 59, 59, 999);

      return prisma.quotation.findMany({
        where: {
          deletedAt: null,
          status: { in: OPEN_STATUSES },
          validUntil: {
            gte: startToday,
            lte: endSevenDays,
          },
        },
        select: {
          id: true,
          quotationNumber: true,
          companyNameSnapshot: true,
          validUntil: true,
          status: true,
          currency: true,
          grandTotal: true,
        },
        orderBy: { validUntil: 'asc' },
      });
    })(),

    // Business profile for primary currency
    prisma.businessProfile.findFirst({
      select: { defaultCurrency: true },
    }),
  ]);

  const defaultCurrency = businessProfile?.defaultCurrency || 'INR';

  // --- 1. Quotation Metrics (Decimal Arithmetic) ---
  let totalQuotationValueDec = new Prisma.Decimal(0);
  let acceptedQuotationCount = 0;
  let acceptedQuotationValueDec = new Prisma.Decimal(0);
  let completedQuotationCount = 0;
  let completedQuotationValueDec = new Prisma.Decimal(0);
  let openQuotationCount = 0;
  let openQuotationValueDec = new Prisma.Decimal(0);

  const statusMap = new Map<QuotationStatus, { count: number; totalValue: Prisma.Decimal }>();
  for (const status of ALL_QUOTATION_STATUSES) {
    statusMap.set(status, { count: 0, totalValue: new Prisma.Decimal(0) });
  }

  for (const q of quotations) {
    totalQuotationValueDec = totalQuotationValueDec.add(q.grandTotal);

    // Status Map tracking
    const current = statusMap.get(q.status);
    if (current) {
      current.count += 1;
      current.totalValue = current.totalValue.add(q.grandTotal);
    }

    // Open / Accepted / Completed grouping
    if (OPEN_STATUSES.includes(q.status)) {
      openQuotationCount += 1;
      openQuotationValueDec = openQuotationValueDec.add(q.grandTotal);
    }
    if (ACCEPTED_STATUSES.includes(q.status)) {
      acceptedQuotationCount += 1;
      acceptedQuotationValueDec = acceptedQuotationValueDec.add(q.grandTotal);
    }
    if (q.status === QuotationStatus.COMPLETED) {
      completedQuotationCount += 1;
      completedQuotationValueDec = completedQuotationValueDec.add(q.grandTotal);
    }
  }

  const totalQuotations = quotations.length;
  const averageQuotationValueDec =
    totalQuotations > 0 ? totalQuotationValueDec.div(totalQuotations) : new Prisma.Decimal(0);

  const quotationMetrics = {
    totalQuotations,
    totalQuotationValue: totalQuotationValueDec.toFixed(2),
    averageQuotationValue: averageQuotationValueDec.toFixed(2),
    acceptedQuotationCount,
    acceptedQuotationValue: acceptedQuotationValueDec.toFixed(2),
    completedQuotationCount,
    completedQuotationValue: completedQuotationValueDec.toFixed(2),
    openQuotationCount,
    openQuotationValue: openQuotationValueDec.toFixed(2),
  };

  // --- 2. Master Data Metrics ---
  const masterDataMetrics = {
    activeCompanies: activeCompaniesCount,
    activeItems: activeItemsCount,
  };

  // --- 3. Operational Metrics & Expiring Quotations ---
  const todayDateOnly = new Date();
  todayDateOnly.setHours(0, 0, 0, 0);

  const expiringQuotations: ExpiringQuotationDto[] = expiringQuotationsRaw.map((q) => {
    const validUntilDate = q.validUntil ? new Date(q.validUntil) : new Date();
    validUntilDate.setHours(0, 0, 0, 0);

    const diffTime = validUntilDate.getTime() - todayDateOnly.getTime();
    const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    return {
      id: q.id,
      quotationNumber: q.quotationNumber,
      companySnapshotName: q.companyNameSnapshot,
      validUntil: q.validUntil ? q.validUntil.toISOString() : '',
      daysRemaining,
      status: q.status,
      currency: q.currency,
      grandTotal: q.grandTotal.toFixed(2),
    };
  });

  const operationalMetrics = {
    expiringSoonCount: expiringQuotations.length,
    expiringWithinDays: 7,
  };

  // --- 4. Status Breakdown ---
  const statusBreakdown: StatusBreakdownDto[] = ALL_QUOTATION_STATUSES.map((status) => {
    const item = statusMap.get(status) || { count: 0, totalValue: new Prisma.Decimal(0) };
    const percentageOfCount =
      totalQuotations > 0 ? ((item.count / totalQuotations) * 100).toFixed(2) : '0.00';

    return {
      status,
      count: item.count,
      totalValue: item.totalValue.toFixed(2),
      percentageOfCount,
    };
  });

  // --- 5. Monthly Quotation Trend ---
  // Generate chronological monthly buckets for range
  const monthlyMap = new Map<
    string,
    { label: string; count: number; totalValue: Prisma.Decimal; acceptedCount: number; acceptedValue: Prisma.Decimal }
  >();

  const startDate = new Date(startBound);
  const endDate = new Date(endBound);

  const currentIter = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endMonthIter = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (currentIter <= endMonthIter) {
    const yyyy = currentIter.getFullYear();
    const mm = String(currentIter.getMonth() + 1).padStart(2, '0');
    const monthKey = `${yyyy}-${mm}`;
    const label = currentIter.toLocaleString('en-US', { month: 'short', year: 'numeric' });

    monthlyMap.set(monthKey, {
      label,
      count: 0,
      totalValue: new Prisma.Decimal(0),
      acceptedCount: 0,
      acceptedValue: new Prisma.Decimal(0),
    });

    currentIter.setMonth(currentIter.getMonth() + 1);
  }

  for (const q of quotations) {
    const qDate = new Date(q.quotationDate);
    const yyyy = qDate.getFullYear();
    const mm = String(qDate.getMonth() + 1).padStart(2, '0');
    const monthKey = `${yyyy}-${mm}`;

    const bucket = monthlyMap.get(monthKey);
    if (bucket) {
      bucket.count += 1;
      bucket.totalValue = bucket.totalValue.add(q.grandTotal);
      if (ACCEPTED_STATUSES.includes(q.status)) {
        bucket.acceptedCount += 1;
        bucket.acceptedValue = bucket.acceptedValue.add(q.grandTotal);
      }
    }
  }

  const monthlyTrend: MonthlyTrendDto[] = Array.from(monthlyMap.entries()).map(([month, data]) => ({
    month,
    label: data.label,
    quotationCount: data.count,
    totalQuotationValue: data.totalValue.toFixed(2),
    acceptedQuotationCount: data.acceptedCount,
    acceptedQuotationValue: data.acceptedValue.toFixed(2),
  }));

  // --- 6. Recent Quotations (Top 8 sorted by createdAt desc) ---
  const recentQuotations: RecentQuotationDto[] = quotations.slice(0, 8).map((q) => ({
    id: q.id,
    quotationNumber: q.quotationNumber,
    revisionNumber: q.revisionNumber,
    companySnapshotName: q.companyNameSnapshot,
    contactSnapshotName: q.contactNameSnapshot,
    quotationDate: q.quotationDate.toISOString(),
    validUntil: q.validUntil ? q.validUntil.toISOString() : null,
    status: q.status,
    currency: q.currency,
    grandTotal: q.grandTotal.toFixed(2),
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  }));

  // --- 7. Top Customers by Quotation Value (Top 5) ---
  const customerMap = new Map<
    number,
    { name: string; count: number; totalValue: Prisma.Decimal; acceptedCount: number; acceptedValue: Prisma.Decimal }
  >();

  for (const q of quotations) {
    const companyId = q.companyId;
    let cust = customerMap.get(companyId);

    if (!cust) {
      cust = {
        name: q.companyNameSnapshot,
        count: 0,
        totalValue: new Prisma.Decimal(0),
        acceptedCount: 0,
        acceptedValue: new Prisma.Decimal(0),
      };
      customerMap.set(companyId, cust);
    }

    cust.count += 1;
    cust.totalValue = cust.totalValue.add(q.grandTotal);

    if (ACCEPTED_STATUSES.includes(q.status)) {
      cust.acceptedCount += 1;
      cust.acceptedValue = cust.acceptedValue.add(q.grandTotal);
    }
  }

  const sortedCustomers = Array.from(customerMap.entries())
    .map(([companyId, data]) => ({
      companyId,
      companyName: data.name,
      quotationCount: data.count,
      totalQuotationValue: data.totalValue,
      acceptedQuotationCount: data.acceptedCount,
      acceptedQuotationValue: data.acceptedValue,
    }))
    .sort((a, b) => b.totalQuotationValue.cmp(a.totalQuotationValue))
    .slice(0, 5);

  const topCustomers: TopCustomerDto[] = sortedCustomers.map((cust) => ({
    companyId: cust.companyId,
    companyName: cust.companyName,
    quotationCount: cust.quotationCount,
    totalQuotationValue: cust.totalQuotationValue.toFixed(2),
    acceptedQuotationCount: cust.acceptedQuotationCount,
    acceptedQuotationValue: cust.acceptedQuotationValue.toFixed(2),
  }));

  return {
    currency: defaultCurrency,
    range,
    quotationMetrics,
    masterDataMetrics,
    operationalMetrics,
    statusBreakdown,
    monthlyTrend,
    recentQuotations,
    expiringQuotations: expiringQuotations.slice(0, 8),
    topCustomers,
  };
}
