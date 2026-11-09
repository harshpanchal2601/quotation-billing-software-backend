import type { ReportSectionKey } from './reports.schema.js';

export type ReportMetric = {
  key: string;
  label: string;
  currency: string | null;
  dimension: string | null;
  value: string;
  unit: 'MONEY' | 'COUNT' | 'PERCENT' | 'VALUATION';
};
export type ReportSectionData = {
  source: string;
  basis: string;
  dateBasis: 'PERIOD' | 'CURRENT' | 'CLOSING';
  asOf: string;
  timezone: string;
  scope: 'FIRM' | 'OWNED_OR_CREATED';
  metrics: ReportMetric[];
};
export type ReportSection = { key: ReportSectionKey } & (
  | { status: 'AVAILABLE'; data: ReportSectionData }
  | { status: 'UNAVAILABLE' }
);
export type ReportOverview = {
  schemaVersion: 1;
  firmId: number;
  generatedAt: string;
  dateFrom: string;
  dateTo: string;
  currency: string | null;
  currencyPolicy: 'SEGMENTED_NO_CONVERSION';
  sections: ReportSection[];
};
