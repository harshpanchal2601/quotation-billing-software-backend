import type { TaxMode } from '@prisma/client';

// Snapshot the actual legacy calculator, independently of new-domain defaults.
// Never infer the legal jurisdiction of historical quotations.
export function quotationPolicySnapshot(currency: string, taxMode: TaxMode) {
  return {
    version: 1, calculator: 'quotation-legacy-v1', currency, amountScale: 2,
    rounding: 'HALF_UP', grandTotalScale: 0, taxMode, taxRateSource: 'quotation-item-snapshots',
  };
}
