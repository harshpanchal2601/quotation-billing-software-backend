import { z } from 'zod';
import { escapeHtml } from '../../../core/html/escape-html.js';
import { decimal } from '../../../core/money/index.js';
import { formatCalendarDate, formatExactDecimal, localizationSnapshotSchema } from '../../../core/localization/presentation.js';
import { customFieldDefinitionsSchema, documentKinds } from '../invoices.schema.js';
import { invoiceFinancialPolicySchema, lineSnapshotSchema } from '../invoice-calculations.js';
import { INDIA_STATES } from '../india-gst.js';
import { renderDocumentPresentation } from '../../automation/document-presentation.js';

const snapshotSchema = z.object({
  kind: z.enum(documentKinds), documentNumber: z.string(), invoiceDate: z.string(), currency: z.string(),
  buyerSnapshot: z.record(z.unknown()), sellerSnapshot: z.record(z.unknown()), bankSnapshot: z.record(z.unknown()).nullable(),
  financialPolicySnapshot: invoiceFinancialPolicySchema, supplySnapshot: z.object({ placeOfSupplyStateCode: z.string() }).passthrough(),
  customFieldSchema: customFieldDefinitionsSchema, customFieldValues: z.record(z.union([z.string(), z.boolean(), z.null()])),
  presentationSnapshot: z.object({ template: z.enum(['STANDARD', 'COMPACT']), primaryColour: z.string().regex(/^#[0-9a-fA-F]{6}$/), termsAndConditions: z.string(), paymentInstructions: z.string() }).passthrough(),
  sourceSnapshot: z.record(z.unknown()).nullable(), lines: z.array(lineSnapshotSchema),
  subtotal: z.string(), discountAmount: z.string(), taxableAmount: z.string(), taxAmount: z.string(), roundOffAmount: z.string(), grandTotal: z.string(),
  paymentTerms: z.string().nullable(), adjustmentReason: z.string().nullable(), customerReference: z.string().nullable(), dueDate: z.string().nullable(), notes: z.string().nullable(),
  automationPresentation: z.unknown().optional(),
  localizationSnapshot: localizationSnapshotSchema.optional(),
});
function text(value: unknown) { return escapeHtml(value === null || value === undefined ? '' : String(value)); }
function address(value: unknown) {
  const row = z.record(z.unknown()).nullable().parse(value ?? null);
  return row ? ['addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country'].map((key) => text(row[key])).filter(Boolean).join(', ') : '';
}
export function renderInvoiceHtml(snapshot: unknown) {
  const data = snapshotSchema.parse(snapshot);
  const policy = data.financialPolicySnapshot;
  const presentation = data.localizationSnapshot;
  const amount = (value: string) => text(presentation ? formatExactDecimal(value, presentation.locale) : value);
  const date = (value: string) => text(presentation ? formatCalendarDate(value, presentation.locale) : value);
  const title = data.kind === 'PROFORMA' ? 'PROFORMA — NOT A TAX INVOICE' : data.kind === 'CREDIT_NOTE' ? 'CREDIT NOTE' : data.kind === 'DEBIT_NOTE' ? 'DEBIT NOTE' : policy.registration === 'REGULAR' && policy.taxMode !== 'NONE' ? 'TAX INVOICE' : policy.registration === 'UNREGISTERED' ? 'INVOICE' : 'BILL OF SUPPLY';
  const total = (key: 'cgstAmount' | 'sgstAmount' | 'igstAmount') => amount(data.lines.reduce((sum, line) => sum.add(line[key]), decimal('0')).toFixed(2));
  const custom = data.customFieldSchema.filter((field) => field.showOnPdf).map((field) => `<div class="field ${field.width === 'FULL' ? 'full' : ''}"><strong>${text(field.label)}</strong>: ${text(typeof data.customFieldValues[field.key] === 'boolean' ? data.customFieldValues[field.key] ? 'Yes' : 'No' : data.customFieldValues[field.key])}</div>`).join('');
  const source = data.sourceSnapshot;
  const decoration = data.automationPresentation === undefined ? { heading: '', footer: '' } : renderDocumentPresentation(data.automationPresentation, { businessName: String(data.sellerSnapshot.displayName ?? data.sellerSnapshot.legalName ?? ''), documentNumber: data.documentNumber, entityType: 'INVOICE', status: 'ISSUED', currency: data.currency, total: data.grandTotal });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${text(title)} ${text(data.documentNumber)}</title><style>
    *{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;font-size:${data.presentationSnapshot.template === 'COMPACT' ? '10' : '12'}px;color:#172033;line-height:1.5}
    h1,h2,p{margin:0}h1{font-size:23px;line-height:1.25;color:${data.presentationSnapshot.primaryColour}}h2{font-size:13px;margin-bottom:10px}
    .document-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:18px;border-bottom:3px solid ${data.presentationSnapshot.primaryColour};margin-bottom:18px}
    .document-number{font-size:15px;font-weight:700;margin-top:6px}.document-meta{text-align:right;color:#526077;line-height:1.8;flex-shrink:0}
    table{width:100%;border-collapse:collapse;margin:16px 0;table-layout:fixed}th,td{border-bottom:1px solid #dce2e8;padding:8px 6px;text-align:left;overflow-wrap:anywhere;vertical-align:top}
    th{background:#f1f4f7;font-size:10px;white-space:nowrap;color:#35435a}thead{display:table-header-group}tr,.party,.field,.totals,.terms-block,footer{break-inside:avoid}
    .parties{display:flex;gap:16px;margin:18px 0}.party{width:calc(50% - 8px);padding:14px;border:1px solid #dce2e8;border-radius:6px;overflow-wrap:anywhere}.party p{margin-top:8px;color:#526077}
    .fields{display:flex;flex-wrap:wrap;gap:12px}.field{width:calc(50% - 6px);white-space:pre-wrap;overflow-wrap:anywhere}.full{width:100%}
    .amount{text-align:right;font-variant-numeric:tabular-nums}.terms{white-space:pre-wrap;overflow-wrap:anywhere}.terms-block{margin-top:18px}.muted{color:#526077}
    .totals{margin:18px 0 20px auto;width:48%}.totals td{padding:6px 8px}.totals .grand-total td{background:#f1f4f7;border-top:2px solid #35435a;font-size:14px;padding:10px 8px}
    footer{margin:32px 0 0 auto;width:46%;text-align:right;padding-top:12px;border-top:1px solid #dce2e8}p{overflow-wrap:anywhere;margin:8px 0}.document-header p{margin:0}.signatory{margin-top:32px;color:#526077}
  </style></head><body>${decoration.heading}<header class="document-header"><div><h1>${text(title)}</h1><p class="document-number">${text(data.documentNumber)}</p></div><div class="document-meta">Issue date: ${date(data.invoiceDate)}${data.dueDate ? `<br>Due date: ${date(data.dueDate)}` : ''}<br>Currency: ${text(data.currency)}</div></header>
  ${data.kind === 'PROFORMA' ? '<p><strong>For estimation only. No receivable, payment receipt or tax invoice is created by this proforma.</strong></p>' : ''}
  ${policy.registration === 'COMPOSITION' ? '<p>Composition taxable person, not eligible to collect tax on supplies.</p>' : ''}
  <div class="parties"><section class="party"><h2>Supplier</h2><strong>${text(data.sellerSnapshot.legalName)}</strong><p>${address(data.sellerSnapshot)}</p><p>GSTIN: ${text(data.sellerSnapshot.gstin) || 'Unregistered'}<br>State: ${text(data.sellerSnapshot.stateCode)} ${text(data.sellerSnapshot.stateName)}</p></section>
  <section class="party"><h2>Recipient</h2><strong>${text(data.buyerSnapshot.legalName || data.buyerSnapshot.name)}</strong><p>${address(data.buyerSnapshot.billingAddress)}</p><p>GSTIN: ${text(data.buyerSnapshot.gstin) || 'Unregistered'}</p></section></div>
  <p>Place of supply: ${text(data.supplySnapshot.placeOfSupplyStateCode)} ${text(INDIA_STATES[data.supplySnapshot.placeOfSupplyStateCode])}. Reverse charge: No.</p>
  ${data.buyerSnapshot.shippingAddress ? `<p>Delivery address: ${address(data.buyerSnapshot.shippingAddress)}</p>` : ''}
  ${data.customerReference ? `<p>Customer reference: ${text(data.customerReference)}</p>` : ''}
  ${source ? `<p>Source: ${text(source.orderNumber || source.invoiceNumber || source.proformaNumber || source.quotationNumber)}${source.revisionNumber !== undefined ? ` · Quotation revision ${text(source.revisionNumber)}` : ''}${source.invoiceDate ? ` · Dated ${text(source.invoiceDate)}` : ''}</p>` : ''}
  ${data.adjustmentReason ? `<p>Adjustment reason: ${text(data.adjustmentReason)}</p>` : ''}
  <div class="fields">${custom}</div><table><thead><tr><th style="width:4%">#</th><th style="width:28%">Goods / service</th><th style="width:11%">HSN / SAC</th><th style="width:11%" class="amount">Quantity</th><th style="width:11%" class="amount">Rate</th><th style="width:12%" class="amount">Taxable</th><th style="width:10%" class="amount">GST</th><th style="width:13%" class="amount">Total</th></tr></thead><tbody>${data.lines.map((line) => `<tr><td>${line.lineNumber}</td><td>${text(line.itemName)}${line.description ? `<br>${text(line.description)}` : ''}</td><td>${text(line.hsnCode)}</td><td class="amount">${amount(line.quantity)} ${text(line.measurementUnit)}</td><td class="amount">${amount(line.unitRate)}</td><td class="amount">${amount(line.taxableAmount)}</td><td class="amount">${amount(line.taxRate)}%<br>${amount(line.taxAmount)}</td><td class="amount">${amount(line.lineTotal)}</td></tr>`).join('')}</tbody></table>
  <table class="totals"><tbody><tr><td>Subtotal</td><td class="amount">${amount(data.subtotal)}</td></tr><tr><td>Discount</td><td class="amount">${amount(data.discountAmount)}</td></tr><tr><td>Taxable amount</td><td class="amount">${amount(data.taxableAmount)}</td></tr>${policy.taxMode === 'CGST_SGST' ? `<tr><td>CGST</td><td class="amount">${total('cgstAmount')}</td></tr><tr><td>${text(policy.localTaxLabel)}</td><td class="amount">${total('sgstAmount')}</td></tr>` : policy.taxMode === 'IGST' ? `<tr><td>IGST</td><td class="amount">${total('igstAmount')}</td></tr>` : ''}${source?.extraCharges ? `<tr><td>${source.orderNumber ? 'Allocated source charges and rounding' : 'Source freight and other charges'}</td><td class="amount">${text(source.extraCharges)}</td></tr>` : ''}<tr><td>Round off</td><td class="amount">${amount(data.roundOffAmount)}</td></tr><tr class="grand-total"><td><strong>Total ${text(data.currency)}</strong></td><td class="amount"><strong>${amount(data.grandTotal)}</strong></td></tr></tbody></table>
  ${data.bankSnapshot ? `<h2>Payment details</h2><p>${text(data.bankSnapshot.bankName)} · ${text(data.bankSnapshot.accountName)}<br>Account ${text(data.bankSnapshot.accountNumber)} · IFSC ${text(data.bankSnapshot.ifscCode)}${data.bankSnapshot.upiId ? `<br>UPI ${text(data.bankSnapshot.upiId)}` : ''}</p>` : ''}
  <section class="terms-block"><h2>Payment terms</h2><div class="terms">${text(data.paymentTerms || data.presentationSnapshot.paymentInstructions) || 'Not specified'}</div></section><section class="terms-block"><h2>Terms &amp; conditions</h2><div class="terms">${text(source?.termsAndConditions || data.presentationSnapshot.termsAndConditions) || 'Not specified'}</div></section>${data.notes ? `<p class="terms">${text(data.notes)}</p>` : ''}${decoration.footer}<footer>For ${text(data.sellerSnapshot.legalName)}<div class="signatory">Authorised signatory</div></footer></body></html>`;
}
