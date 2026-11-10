import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/core/serialization/csv.js';
import { reportHtml, reportXlsx } from '../src/modules/reports/reports.formats.js';
import { importRecords, normalizeImport } from '../src/modules/imports/imports.normalization.js';
import type { ReportOverview } from '../src/modules/reports/reports.types.js';

describe('Wave 10 bounded interchange formats', () => {
  it('parses escaped quotes, CRLF, embedded newlines and exact decimal strings', () => {
    expect(parseCsv('\ufeffexternalId,name,amount\r\na,"A ""quoted""\nname",9007199254740993.01\r\n')).toEqual([['externalId', 'name', 'amount'], ['a', 'A "quoted"\nname', '9007199254740993.01']]);
  });
  it('rejects malformed, oversized and structurally ambiguous CSV', () => {
    for (const text of ['a\n"unfinished', 'a\n"closed"junk', 'a\nb"c', 'a\n\u0000']) expect(() => parseCsv(text)).toThrow();
    expect(() => parseCsv('a\n' + 'x\n'.repeat(501))).toThrow();
    expect(() => parseCsv('x'.repeat(512001))).toThrow();
    expect(() => importRecords('CUSTOMERS', 'externalId,name,name\nx,Good,Other')).toThrow();
    expect(() => importRecords('CUSTOMERS', 'externalId,name,firmId\nx,Good,2')).toThrow();
    expect(() => importRecords('CUSTOMERS', 'externalId,name\nx,Good,extra')).toThrow();
  });
  it('normalizes only the documented domain fields and rejects formula identifiers', () => {
    expect(normalizeImport('CUSTOMERS', { externalId: 'c-1', name: 'Customer', gstin: '' })).toMatchObject({ identifier: 'c-1', data: { name: 'Customer', isActive: true } });
    expect(() => normalizeImport('CUSTOMERS', { externalId: '=1+1', name: 'Customer' })).toThrow();
    expect(() => normalizeImport('ITEMS', { externalId: 'i-1', name: 'Item', measurementUnitId: '3', defaultRate: '1e5' })).toThrow();
  });
  it('exports exact strings as Office text and escapes active PDF markup', () => {
    const report: ReportOverview = { schemaVersion: 1, firmId: 1, generatedAt: '2026-11-09T00:00:00Z', dateFrom: '2026-11-01', dateTo: '2026-11-09', currency: null, currencyPolicy: 'SEGMENTED_NO_CONVERSION', sections: [{ key: 'sales', status: 'AVAILABLE', data: { source: 'invoices', basis: '<img src="https://private.invalid">', dateBasis: 'PERIOD', asOf: '2026-11-09', timezone: 'UTC', scope: 'FIRM', metrics: [{ key: 'sales', label: '<script>secret()</script>', currency: 'INR', dimension: '=HYPERLINK("example.invalid")', unit: 'MONEY', value: '9007199254740993.01' }] } }] };
    const archive = reportXlsx(report);
    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
    expect(archive.toString()).toContain('<c t="inlineStr">');
    expect(archive.toString()).toContain('9007199254740993.01');
    expect(archive.toString()).not.toContain('<f>');
    expect(reportHtml(report)).not.toContain('<img');
    expect(reportHtml(report)).not.toContain('<script>');
    expect(reportHtml(report)).toContain('&lt;script&gt;');
  });
});
