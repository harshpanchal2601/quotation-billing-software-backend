import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors/AppError.js';
import { renderDocumentPresentation, resolveDocumentPresentation } from '../src/modules/automation/document-presentation.js';

const feature = vi.hoisted(() => vi.fn());
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: feature }));
beforeEach(() => vi.resetAllMocks());
describe('Wave 08 escaped document snapshots and confidential-field omission', () => {
  it('pins the current template and includes only fields explicitly visible on documents', async () => {
    const template = { enabled: true, entity: 'QUOTATION', heading: '{{businessName}}', footer: '<img src=x onerror=alert(1)>', primaryColour: '#168A56' };
    const field = { key: 'cf_public', label: 'Project', type: 'TEXT', required: false, searchable: false, visibility: 'DOCUMENT', classification: 'BUSINESS', options: [] };
    const tx = {
      automationDefinitionVersion: { findFirst: vi.fn().mockResolvedValue({ id: 12, firmId: 1, definition: template }) },
      customFieldValueVersion: { findFirst: vi.fn().mockResolvedValue({ values: { cf_public: '<script>project</script>', cf_private: 'Confidential customer note' }, definition: { definition: { enabled: true, entity: 'QUOTATION', fields: [field, { ...field, key: 'cf_private', label: 'Private note', visibility: 'INTERNAL' }] } } }) },
    };
    const snapshot = await resolveDocumentPresentation(tx as never, 1, 'QUOTATION', 7);
    expect(snapshot.templateVersionId).toBe(12); expect(snapshot.fields).toHaveLength(1); expect(JSON.stringify(snapshot)).not.toContain('Confidential');
    const html = renderDocumentPresentation(snapshot, { businessName: '<b>Firm A</b>' });
    expect(html.heading).toContain('&lt;b&gt;Firm A&lt;/b&gt;'); expect(html.footer).toContain('&lt;script&gt;'); expect(html.footer).not.toContain('<img');
    expect(tx.automationDefinitionVersion.findFirst).toHaveBeenCalledWith({ where: { firmId: 1, kind: 'TEMPLATE', key: 'QUOTATION' }, orderBy: { version: 'desc' } });
    expect(tx.customFieldValueVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 1, entity: 'QUOTATION', entityId: 7 } }));
  });
  it('keeps existing documents readable from pinned snapshots when live automation is unavailable', async () => {
    feature.mockRejectedValueOnce(new AppError('Feature denied', 403));
    const tx = { automationDefinitionVersion: { findFirst: vi.fn() } };
    expect(await resolveDocumentPresentation(tx as never, 1, 'INVOICE', 7)).toEqual({ templateVersionId: null, template: null, fields: [] });
    expect(tx.automationDefinitionVersion.findFirst).not.toHaveBeenCalled();
    expect(renderDocumentPresentation({ templateVersionId: 12, template: { enabled: true, entity: 'INVOICE', heading: '{{documentNumber}}', footer: 'Historical terms', primaryColour: '#168A56' }, fields: [] }, { documentNumber: 'INV-OLD' }).footer).toContain('Historical terms');
  });
});
