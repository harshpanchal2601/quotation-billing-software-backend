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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${xml(title)}</title><style>body{font:12px sans-serif;color:#111}h1{font-size:20px}h2{font-size:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}section{margin-top:20px}</style></head><body><h1>${xml(title)}</h1><p>Firm ${report.firmId} · ${xml(report.dateFrom)} through ${xml(report.dateTo)} · Generated ${xml(generated)}</p><p>Display ${xml(presentation?.locale ?? 'source')} · ${xml(presentation?.timezone ?? 'UTC')}</p><p>Currencies are separate. Values retain source precision. Schema ${report.schemaVersion}.</p>${report.sections.map((section) => `<section><h2>${xml(section.key)}</h2>${section.status === 'UNAVAILABLE' ? '<p>Unavailable for the current access.</p>' : `<p>${xml(section.data.basis)}</p><p>Source: ${xml(section.data.source)} · ${xml(section.data.dateBasis)} · ${xml(section.data.asOf)} · ${xml(section.data.timezone)} · ${xml(section.data.scope)}</p><table><thead><tr><th>Metric</th><th>Dimension</th><th>Currency</th><th>Unit</th><th>Value</th></tr></thead><tbody>${section.data.metrics.map((metric) => `<tr>${[metric.label, metric.dimension ?? '', metric.currency ?? '', metric.unit, metricValue(metric.value)].map((value) => `<td>${xml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`}</section>`).join('')}</body></html>`;
}

export const reportPdf = (report: ReportOverview) => pdfService.generateBufferFromHtml(reportHtml(report));
