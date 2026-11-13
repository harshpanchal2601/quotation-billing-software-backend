import { zipEntries } from '../../core/serialization/zip.js';
import { pdfService } from '../../integrations/pdf/index.js';
import { reportRows } from './reports.csv.js';
import type { ReportOverview } from './reports.types.js';
import { formatExactDecimal, formatTimestamp } from '../../core/localization/presentation.js';

const xml = (value: string) => Array.from(value).filter((char) => char.charCodeAt(0) >= 32 || ['\t', '\r', '\n'].includes(char)).join('').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export function reportXlsx(report: ReportOverview): Buffer {
  const rows = reportRows(report).map((row, index) => `<row r="${index + 1}">${row.map((cell) => `<c t="inlineStr"><is><t xml:space="preserve">${xml(cell)}</t></is></c>`).join('')}</row>`).join('');
  // Every cell is text. Exact decimals, long identifiers and formula-looking
  // labels survive spreadsheet opening without coercion or formula execution.
  return zipEntries([
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Source reports" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>` },
  ]);
}

export function reportHtml(report: ReportOverview): string {
  const presentation = report.localizationSnapshot;
  const title = ({ en: 'Business source reports', hi: 'व्यावसायिक स्रोत रिपोर्ट', gu: 'વ્યવસાયિક સ્રોત અહેવાલો' })[presentation?.language ?? 'en'];
  const generated = presentation ? formatTimestamp(report.generatedAt, presentation) : report.generatedAt;
  const metricValue = (value: string) => presentation ? formatExactDecimal(value, presentation.locale) : value;
  const sectionLabels = { quotations: 'Quotation conversion', sales: 'Invoice sales', receivables: 'Outstanding & customer credit', pipeline: 'Sales pipeline', stock: 'Stock valuation', purchaseOrders: 'Purchase commitments', supplierBills: 'Supplier bills', expenses: 'Expenses' };
  const unitLabels = { MONEY: 'Amount', COUNT: 'Count', PERCENT: '%', VALUATION: 'Stock value' };
  const dateLabels = { PERIOD: 'Selected period', CURRENT: 'Current balances', CLOSING: 'Closing balance' };
  return `<!doctype html><html lang="${presentation?.language ?? 'en'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${xml(title)}</title><style>body{margin:0;font:11px Arial,sans-serif;color:#172033;line-height:1.4}h1{font-size:23px;color:#278456;border-bottom:2px solid #278456;padding-bottom:12px}h2{font-size:15px;margin-bottom:8px;break-after:avoid}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:12px}th,td{border-bottom:1px solid #dce2e8;padding:6px 5px;text-align:left;overflow-wrap:anywhere;vertical-align:top}th{background:#f1f4f7;color:#35435a;font-size:10px}thead{display:table-header-group;break-after:avoid}tr{break-inside:avoid}section{margin-top:18px;break-inside:avoid}section>p{break-after:avoid;margin:6px 0}.provenance{color:#526077;font-size:10px}.amount{text-align:right;font-variant-numeric:tabular-nums}</style></head><body><h1>${xml(title)}</h1><p>Firm ${report.firmId} · ${xml(report.dateFrom)} through ${xml(report.dateTo)} · Generated ${xml(generated)}</p><p>Display ${xml(presentation?.locale ?? 'source')} · ${xml(presentation?.timezone ?? 'UTC')}</p><p>Currencies are separate. Values retain source precision.</p>${report.sections.map((section) => `<section><h2>${xml(sectionLabels[section.key])}</h2>${section.status === 'UNAVAILABLE' ? '<p>Unavailable for your current access.</p>' : `<p>${xml(section.data.basis)}</p><p class="provenance">${dateLabels[section.data.dateBasis]} · As of ${xml(section.data.asOf)} · ${xml(section.data.timezone)}${section.data.scope === 'OWNED_OR_CREATED' ? ' · Your owned or created opportunities' : ''}</p><table><colgroup><col style="width:36%"><col style="width:17%"><col style="width:12%"><col style="width:13%"><col style="width:22%"></colgroup><thead><tr><th>Measure</th><th>Group</th><th>Currency</th><th>Unit</th><th class="amount">Value</th></tr></thead><tbody>${section.data.metrics.map((metric) => `<tr>${[metric.label, section.key === 'pipeline' && metric.dimension ? metric.dimension.replaceAll('_', ' ').toLowerCase().replace(/^./, (letter) => letter.toUpperCase()) : metric.dimension ?? '—', metric.currency ?? '—', unitLabels[metric.unit], metricValue(metric.value)].map((value, index) => `<td${index === 4 ? ' class="amount"' : ''}>${xml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`}</section>`).join('')}</body></html>`;
}

export const reportPdf = (report: ReportOverview) => pdfService.generateBufferFromHtml(reportHtml(report));
