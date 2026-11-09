import type { ReportOverview } from './reports.types.js';

function csvCell(value: string) {
  // Quoting alone does not prevent a spreadsheet from executing a formula.
  let start = 0;
  while (start < value.length && (value[start]!.trim() === '' || value.charCodeAt(start) < 32)) start += 1;
  const first = value[start];
  const formula = first !== undefined && '=+@-'.includes(first);
  const safe = formula && !/^-?\d+(?:\.\d+)?$/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function reportCsv(report: ReportOverview) {
  const rows: string[][] = [[
    'schema_version', 'firm_id', 'generated_at', 'date_from', 'date_to', 'currency_policy', 'section', 'status',
    'source', 'basis', 'date_basis', 'as_of', 'timezone', 'scope', 'metric', 'dimension', 'currency', 'unit', 'value',
  ]];
  for (const section of report.sections) {
    const prefix = [String(report.schemaVersion), String(report.firmId), report.generatedAt, report.dateFrom, report.dateTo, report.currencyPolicy, section.key, section.status];
    if (section.status === 'UNAVAILABLE') {
      rows.push([...prefix, ...Array<string>(11).fill('')]);
      continue;
    }
    const data = section.data;
    const context = [...prefix, data.source, data.basis, data.dateBasis, data.asOf, data.timezone, data.scope];
    if (data.metrics.length === 0) rows.push([...context, ...Array<string>(5).fill('')]);
    for (const metric of data.metrics) rows.push([...context, metric.key, metric.dimension ?? '', metric.currency ?? '', metric.unit, metric.value]);
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
