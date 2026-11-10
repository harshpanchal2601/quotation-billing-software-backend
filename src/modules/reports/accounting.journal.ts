import { z } from 'zod';
import { AppError } from '../../core/errors/AppError.js';
import { currencyCode, decimal, money } from '../../core/money/index.js';
import type { DateWindow } from '../../core/validation/date-window.js';
import type { readBillingJournalSources } from '../invoices/index.js';
import type { AccountingMapping } from './accounting.schema.js';

const snapshotSchema = z.object({ status: z.literal('ISSUED'), currency: z.string(), documentNumber: z.string().min(1), taxableAmount: z.string(), taxAmount: z.string(), roundOffAmount: z.string(), grandTotal: z.string() });
export type JournalRow = { sourceEvent: string; sourceId: number; documentNumber: string; event: 'ISSUE' | 'VOID'; eventAt: string; currency: string; account: string; debit: string; credit: string };
export function billingJournal(sources: Awaited<ReturnType<typeof readBillingJournalSources>>, mapping: AccountingMapping, window: DateWindow): JournalRow[] {
  const rows: JournalRow[] = [];
  for (const source of sources) {
    const parsed = snapshotSchema.safeParse(source.issueSnapshot);
    if (!parsed.success || parsed.data.currency !== source.currency || parsed.data.documentNumber !== source.documentNumber || !source.issuedAt) throw new AppError('A billing source has an invalid issue snapshot; reconcile it before export', 409);
    const snapshot = parsed.data;
    const currency = currencyCode(source.currency);
    const total = decimal(snapshot.grandTotal); const taxable = decimal(snapshot.taxableAmount); const tax = decimal(snapshot.taxAmount); const rounding = decimal(snapshot.roundOffAmount);
    if (total.isNegative() || taxable.isNegative() || tax.isNegative() || !taxable.add(tax).add(rounding).equals(total)) throw new AppError('A billing snapshot does not reconcile; export refused', 409);
    for (const event of ['ISSUE', 'VOID'] as const) {
      const when = event === 'ISSUE' ? source.issuedAt : source.voidedAt;
      if (!when || when < window.from || when >= window.until) continue;
      const history = source.statusHistory.find((entry) => entry.toStatus === (event === 'ISSUE' ? 'ISSUED' : 'VOID'));
      if (!history) throw new AppError('A billing source is missing its status history; reconcile it before export', 409);
      const sign = (source.kind === 'CREDIT_NOTE' ? -1 : 1) * (event === 'VOID' ? -1 : 1);
      const entries = [[mapping.receivables, total.mul(sign)], [mapping.sales, taxable.mul(-sign)], [mapping.outputTax, tax.mul(-sign)], [mapping.rounding, rounding.mul(-sign)]] as const;
      let balance = decimal('0');
      for (const [account, signed] of entries) {
        const amount = money(signed.abs(), currency).amount;
        // Currency rounding must not silently change an immutable source.
        if (!decimal(amount).equals(signed.abs())) throw new AppError('Source precision is incompatible with its currency', 409);
        if (signed.isZero()) continue;
        balance = balance.add(signed);
        rows.push({ sourceEvent: `billing:${source.id}:${history.version}:${event}`, sourceId: source.id, documentNumber: snapshot.documentNumber, event, eventAt: when.toISOString(), currency, account, debit: signed.isPositive() ? amount : money('0', currency).amount, credit: signed.isNegative() ? amount : money('0', currency).amount });
      }
      if (!balance.isZero()) throw new AppError('Unbalanced accounting projection; export refused', 409);
    }
  }
  return rows;
}
