import { Prisma, QuotationStatus, type PrismaClient } from '@prisma/client';

import { prisma } from '../../core/database/prisma.js';
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

const ACCEPTED_STATUSES: QuotationStatus[] = [QuotationStatus.ACCEPTED, QuotationStatus.COMPLETED];

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
      const month = now.getMonth() + 1;
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

export class DashboardRepository {
  constructor(private readonly db: PrismaClient) {}

  async getDashboardOverview(query: DashboardOverviewQuery): Promise<DashboardOverviewData> {
    const range = resolveDashboardDateRange(query.period, query.dateFrom, query.dateTo);

    const startBound = new Date(`${range.dateFrom}T00:00:00.000Z`);
    const endBound = new Date(`${range.dateTo}T23:59:59.999Z`);

    const [quotations, activeCompaniesCount, activeItemsCount, expiringQuotationsRaw, businessProfile] =
      await Promise.all([
        this.db.quotation.findMany({
          where: {
            deletedAt: null,
            isLatestRevision: true,
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
        this.db.company.count({ where: { isActive: true, deletedAt: null } }),
        this.db.item.count({ where: { isActive: true, deletedAt: null } }),
        (() => {
          const today = new Date();
          const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
          const endSevenDays = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7, 23, 59, 59, 999);

          return this.db.quotation.findMany({
            where: {
              deletedAt: null,
              isLatestRevision: true,
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
        this.db.businessProfile.findFirst({ select: { defaultCurrency: true } }),
      ]);

    const defaultCurrency = businessProfile?.defaultCurrency || 'INR';

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

    for (const quotation of quotations) {
      totalQuotationValueDec = totalQuotationValueDec.add(quotation.grandTotal);

      const current = statusMap.get(quotation.status);
      if (current) {
        current.count += 1;
        current.totalValue = current.totalValue.add(quotation.grandTotal);
      }

      if (OPEN_STATUSES.includes(quotation.status)) {
        openQuotationCount += 1;
        openQuotationValueDec = openQuotationValueDec.add(quotation.grandTotal);
      }
      if (ACCEPTED_STATUSES.includes(quotation.status)) {
        acceptedQuotationCount += 1;
        acceptedQuotationValueDec = acceptedQuotationValueDec.add(quotation.grandTotal);
      }
      if (quotation.status === QuotationStatus.COMPLETED) {
        completedQuotationCount += 1;
        completedQuotationValueDec = completedQuotationValueDec.add(quotation.grandTotal);
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

    const masterDataMetrics = {
      activeCompanies: activeCompaniesCount,
      activeItems: activeItemsCount,
    };

    const todayDateOnly = new Date();
    todayDateOnly.setHours(0, 0, 0, 0);

    const expiringQuotations: ExpiringQuotationDto[] = expiringQuotationsRaw.map((quotation) => {
      const validUntilDate = quotation.validUntil ? new Date(quotation.validUntil) : new Date();
      validUntilDate.setHours(0, 0, 0, 0);

      const diffTime = validUntilDate.getTime() - todayDateOnly.getTime();
      const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

      return {
        id: quotation.id,
        quotationNumber: quotation.quotationNumber,
        companySnapshotName: quotation.companyNameSnapshot,
        validUntil: quotation.validUntil ? quotation.validUntil.toISOString() : '',
        daysRemaining,
        status: quotation.status,
        currency: quotation.currency,
        grandTotal: quotation.grandTotal.toFixed(2),
      };
    });

    const operationalMetrics = {
      expiringSoonCount: expiringQuotations.length,
      expiringWithinDays: 7,
    };

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

    for (const quotation of quotations) {
      const qDate = new Date(quotation.quotationDate);
      const yyyy = qDate.getFullYear();
      const mm = String(qDate.getMonth() + 1).padStart(2, '0');
      const monthKey = `${yyyy}-${mm}`;

      const bucket = monthlyMap.get(monthKey);
      if (bucket) {
        bucket.count += 1;
        bucket.totalValue = bucket.totalValue.add(quotation.grandTotal);
        if (ACCEPTED_STATUSES.includes(quotation.status)) {
          bucket.acceptedCount += 1;
          bucket.acceptedValue = bucket.acceptedValue.add(quotation.grandTotal);
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

    const recentQuotations: RecentQuotationDto[] = quotations.slice(0, 8).map((quotation) => ({
      id: quotation.id,
      quotationNumber: quotation.quotationNumber,
      revisionNumber: quotation.revisionNumber,
      companySnapshotName: quotation.companyNameSnapshot,
      contactSnapshotName: quotation.contactNameSnapshot,
      quotationDate: quotation.quotationDate.toISOString(),
      validUntil: quotation.validUntil ? quotation.validUntil.toISOString() : null,
      status: quotation.status,
      currency: quotation.currency,
      grandTotal: quotation.grandTotal.toFixed(2),
      createdAt: quotation.createdAt.toISOString(),
      updatedAt: quotation.updatedAt.toISOString(),
    }));

    const customerMap = new Map<
      number,
      { name: string; count: number; totalValue: Prisma.Decimal; acceptedCount: number; acceptedValue: Prisma.Decimal }
    >();

    for (const quotation of quotations) {
      const companyId = quotation.companyId;
      let customer = customerMap.get(companyId);

      if (!customer) {
        customer = {
          name: quotation.companyNameSnapshot,
          count: 0,
          totalValue: new Prisma.Decimal(0),
          acceptedCount: 0,
          acceptedValue: new Prisma.Decimal(0),
        };
        customerMap.set(companyId, customer);
      }

      customer.count += 1;
      customer.totalValue = customer.totalValue.add(quotation.grandTotal);

      if (ACCEPTED_STATUSES.includes(quotation.status)) {
        customer.acceptedCount += 1;
        customer.acceptedValue = customer.acceptedValue.add(quotation.grandTotal);
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

    const topCustomers: TopCustomerDto[] = sortedCustomers.map((customer) => ({
      companyId: customer.companyId,
      companyName: customer.companyName,
      quotationCount: customer.quotationCount,
      totalQuotationValue: customer.totalQuotationValue.toFixed(2),
      acceptedQuotationCount: customer.acceptedQuotationCount,
      acceptedQuotationValue: customer.acceptedQuotationValue.toFixed(2),
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
}

export const dashboardRepository = new DashboardRepository(prisma);
