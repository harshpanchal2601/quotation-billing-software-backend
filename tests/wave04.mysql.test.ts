import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TwoFirmFixture, assertDisposableTenantDatabase, type TenantFixture } from './helpers/two-firm-fixture.js';
import { indiaToday } from '../src/modules/invoices/india-gst.js';
import type { InvoicesRepository } from '../src/modules/invoices/invoices.repository.js';
import type { InvoiceDraftInput } from '../src/modules/invoices/invoices.schema.js';

const testUrl = process.env.WAVE04_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
suite('Wave 04 authenticated billing and financial transactions', () => {
  let db: PrismaClient; let fixture: TwoFirmFixture; let a: TenantFixture; let b: TenantFixture;
  let server: Server; let base: string; let temporaryStorage: string; let originalStorage: string;
  let repository: InvoicesRepository; let planId: number;
  const cookies = new Map<number, string>();
  const pdf = vi.fn(async (html: string) => Buffer.from(`%PDF-1.4\n${html}`));
  const field = { key: 'cf_order', label: 'Purchase order', type: 'TEXT', required: false, showOnPdf: true, width: 'FULL', options: [] };
  type Document = { id: number; kind: string; status: string; version: number; documentNumber: string; grandTotal: string; lines: Array<{ lineNumber: number; itemName: string }>; customFieldSchema: typeof field[]; customFieldValues: Record<string, string>; postingEffect: string; buyerSnapshot: { name: string }; };
  async function request(method: string, route: string, body?: unknown, actorId = a.admin.id, selectedFirm?: number) {
    return fetch(`${base}/api/v1${route}`, { method, headers: { Cookie: cookies.get(actorId)!, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(selectedFirm === undefined ? {} : { 'x-firm-id': String(selectedFirm) }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function data<T>(response: Response, status = 200): Promise<T> { expect(response.status, await response.clone().text()).toBe(status); return (await response.json() as { data: T }).data; }
  function draft(tenant = a, extra: Partial<InvoiceDraftInput> = {}): InvoiceDraftInput {
    return { companyId: tenant.company.id, billingAddressId: tenant.address.id, invoiceDate: indiaToday(), supply: { isExempt: false, placeOfSupplyStateCode: '27', placeOfSupplyBasis: 'SERVICES_GENERAL', explanation: '' }, customFieldValues: { cf_order: 'PO-ORIGINAL' }, lines: [{ itemName: 'Consulting', hsnCode: '998311', supplyType: 'SERVICE', measurementUnit: 'HOUR', quantity: '1', unitRate: '100.10', discountType: 'NONE', discountValue: '0', taxRate: '18' }], idempotencyKey: randomUUID(), ...extra };
  }
  async function create(tenant = a, extra: Partial<InvoiceDraftInput> = {}, route = '/invoices') { return (await data<{ document: Document }>(await request('POST', route, draft(tenant, extra), tenant.admin.id), 201)).document; }
  async function issue(document: Document, tenant = a, route = '/invoices') { return (await data<{ document: Document }>(await request('POST', `${route}/${document.id}/issue`, { expectedVersion: document.version, confirmedTotal: document.grandTotal }, tenant.admin.id))).document; }
  async function settings(tenant = a) { return data<{ version: number; config: Record<string, unknown> }>(await request('GET', '/billing-settings', undefined, tenant.admin.id)); }

  beforeAll(async () => {
    assertDisposableTenantDatabase(testUrl!, '04');
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', testUrl!); vi.stubEnv('JWT_ACCESS_SECRET', 'wave04-disposable-access-secret'); vi.stubEnv('JWT_REFRESH_SECRET', 'wave04-disposable-refresh-secret'); vi.stubEnv('JWT_ACCESS_EXPIRES_IN', '1h');
    db = new PrismaClient({ datasources: { db: { url: testUrl! } } }); fixture = new TwoFirmFixture(db);
    vi.doMock('../src/core/database/prisma.js', () => ({ prisma: db }));
    vi.doMock('../src/integrations/pdf/index.js', () => ({ pdfService: { generateBufferFromHtml: pdf } }));
    vi.doMock('../src/integrations/mail/index.js', () => ({ mailService: { send: vi.fn().mockRejectedValue(new Error('External mail disabled')) } }));
    const storage = (await import('../src/config/storage.config.js')).storageConfig; originalStorage = storage.root; temporaryStorage = await mkdtemp(path.join(os.tmpdir(), 'wave04-pdf-')); storage.root = temporaryStorage;
    a = await fixture.createTenant('billing-A'); b = await fixture.createTenant('billing-B');
    const { FEATURE_KEYS } = await import('../src/modules/entitlements/feature-registry.js');
    const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const plan = await db.plan.create({ data: { name: 'Billing fixture', slug: `wave04-${randomUUID()}`, versions: { create: { revision: 1, createdById: a.admin.id, policy: LEGACY_POLICY, features: { create: FEATURE_KEYS.filter((key) => !key.startsWith('quotations.')).map((featureKey) => ({ featureKey })) }, quotas: { create: ['users', 'documents', 'storageBytes', 'aiCredits'].map((resource) => ({ resource, limit: null })) } } } }, include: { versions: true } }); planId = plan.id;
    await db.planVersion.update({ where: { id: plan.versions[0]!.id }, data: { publishedAt: new Date() } });
    for (const tenant of [a, b]) {
      await db.firmSubscription.create({ data: { firmId: tenant.firm.id, planVersionId: plan.versions[0]!.id, status: 'ACTIVE', authorId: tenant.admin.id, reason: 'Disposable billing fixture', effectiveFrom: new Date(Date.now() - 1000) } });
      await db.businessProfile.update({ where: { id: tenant.profile.id }, data: { gstin: '27AAPFU0939F1ZV', state: 'Maharashtra' } });
      await db.bankDetail.update({ where: { id: tenant.bank.id }, data: { isDefault: true } });
    }
    const { generateAccessToken } = await import('../src/modules/auth/security/auth.tokens.js'); const { ACCESS_TOKEN_COOKIE_NAME } = await import('../src/modules/auth/auth.constants.js');
    for (const actor of [a.admin, a.reader, b.admin]) {
      const session = await db.authSession.create({ data: { userId: actor.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3600000) } });
      cookies.set(actor.id, `${ACCESS_TOKEN_COOKIE_NAME}=${generateAccessToken({ userId: actor.id, role: actor.role, sessionId: session.id })}`);
    }
    const { app } = await import('../src/bootstrap/app.js'); server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Listener unavailable'); base = `http://127.0.0.1:${address.port}`;
    repository = (await import('../src/modules/invoices/invoices.repository.js')).invoicesRepository;
    for (const tenant of [a, b]) {
      await data(await request('PUT', '/billing-settings', { expectedVersion: 0, config: { schemaVersion: 1, registration: 'REGULAR', sellerStateCode: '27', einvoiceRequired: false, prefixes: { INVOICE: 'INV', PROFORMA: 'PF', CREDIT_NOTE: 'CN', DEBIT_NOTE: 'DN' }, template: 'STANDARD', primaryColour: '#168A56', paymentInstructions: 'Pay by bank', termsAndConditions: 'Fixture terms' } }, tenant.admin.id));
      await data(await request('PUT', '/billing-settings/fields', { expectedVersion: 1, customFields: [field] }, tenant.admin.id));
    }
  }, 60000);
  afterAll(async () => {
    try {
      if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (fixture) await fixture.cleanup();
      if (planId) await db.plan.update({ where: { id: planId }, data: { archivedAt: new Date() } });
    } finally {
      if (db) await db.$disconnect();
      if (temporaryStorage) { (await import('../src/config/storage.config.js')).storageConfig.root = originalStorage; await rm(temporaryStorage, { recursive: true, force: true }); }
      vi.doUnmock('../src/core/database/prisma.js'); vi.doUnmock('../src/integrations/pdf/index.js'); vi.doUnmock('../src/integrations/mail/index.js'); vi.unstubAllEnvs();
    }
  }, 60000);

  it('creates, reads, filters, calculates and edits manual service drafts with immutable snapshots', async () => {
    const input = draft(); const created = (await data<{ document: Document }>(await request('POST', '/invoices', input), 201)).document;
    expect(created).toMatchObject({ status: 'DRAFT', grandTotal: '118.00', customFieldValues: { cf_order: 'PO-ORIGINAL' } });
    await data(await request('POST', '/invoices/calculate', input));
    const list = await data<{ documents: Document[] }>(await request('GET', `/invoices?search=Consulting&companyId=${a.company.id}`)); expect(list.documents).toEqual([]);
    const { idempotencyKey: _, ...edit } = input;
    const updated = (await data<{ document: Document }>(await request('PATCH', `/invoices/${created.id}`, { ...edit, expectedVersion: 1, lines: [{ ...input.lines[0], unitRate: '200.10' }] }))).document;
    expect(updated.grandTotal).toBe('236.00'); expect(updated.version).toBe(2);
    expect((await request('PATCH', `/invoices/${created.id}`, { ...edit, expectedVersion: 1 })).status).toBe(409);
  });
  it('rejects foreign nested customers, addresses and catalog items and client tenancy overrides', async () => {
    for (const input of [draft(a, { companyId: b.company.id }), draft(a, { billingAddressId: b.address.id }), draft(a, { lines: [{ ...draft().lines[0]!, itemId: b.item.id }] })]) expect((await request('POST', '/invoices', input)).status).toBe(404);
    expect((await request('POST', '/invoices', { ...draft(), firmId: b.firm.id })).status).toBe(400);
    expect((await request('GET', `/invoices/options/customers/${b.company.id}/addresses`)).status).toBe(404);
  });
  it('supports catalog goods with owned unit validation', async () => {
    await db.measurementUnit.update({ where: { id: a.unit.id }, data: { allowDecimal: false } });
    const created = await create(a, { lines: [{ ...draft().lines[0]!, itemId: a.item.id, supplyType: 'GOODS', hsnCode: '847130', itemName: undefined }] });
    expect(created.lines[0]!.itemName).toBe(a.item.name);
    expect((await request('POST', '/invoices', draft(a, { lines: [{ ...draft().lines[0]!, itemId: a.item.id, quantity: '1.5' }] }))).status).toBe(400);
  });
  it('keeps draft creation idempotent under parallel submissions and rejects a changed payload', async () => {
    const input = draft(); const results = await Promise.all(Array.from({ length: 5 }, () => request('POST', '/invoices', input).then((response) => data<{ document: Document }>(response, 201))));
    expect(new Set(results.map((result) => result.document.id)).size).toBe(1);
    expect((await request('POST', '/invoices', { ...input, customerReference: 'Changed' })).status).toBe(409);
  });
  it('requires admin approval for field design, permits delegated design, and prevents fiscal/role escalation', async () => {
    const current = await settings();
    expect((await request('PUT', '/billing-settings/fields', { expectedVersion: current.version, customFields: [field] }, a.reader.id)).status).toBe(403);
    await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: ['invoices.edit', 'firm.invoice-fields.manage'] } });
    await data(await request('PUT', '/billing-settings/fields', { expectedVersion: current.version, customFields: [{ ...field, label: 'Approved PO' }] }, a.reader.id));
    expect((await request('PUT', '/billing-settings', { expectedVersion: current.version + 1, config: {} }, a.reader.id)).status).toBe(403);
    expect((await request('PUT', '/billing-settings/fields', { expectedVersion: current.version + 1, customFields: [field], config: { registration: 'UNREGISTERED' } }, a.reader.id)).status).toBe(400);
    expect((await request('GET', '/administration/roles', undefined, a.reader.id)).status).toBe(403);
    expect((await request('PUT', '/billing-settings/fields', { expectedVersion: current.version, customFields: [field] })).status).toBe(409);
    await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: ['quotations.view'] } });
  });
  it('enforces typed required values at issuance and preserves issued custom schemas', async () => {
    let current = await settings();
    await data(await request('PUT', '/billing-settings/fields', { expectedVersion: current.version, customFields: [{ ...field, required: true }] }));
    let created = await create(a, { customFieldValues: {} });
    expect((await request('POST', `/invoices/${created.id}/issue`, { expectedVersion: created.version, confirmedTotal: created.grandTotal })).status).toBe(400);
    created = (await data<{ document: Document }>(await request('PATCH', `/invoices/${created.id}/custom-fields`, { expectedVersion: created.version, values: { cf_order: 'PO-PINNED' } }))).document;
    const issued = await issue(created);
    current = await settings(); await data(await request('PUT', '/billing-settings/fields', { expectedVersion: current.version, customFields: [{ ...field, label: 'New label', type: 'NUMBER' }] }));
    const historical = (await data<{ document: Document }>(await request('GET', `/invoices/${issued.id}`))).document;
    expect(historical.customFieldSchema[0]!.type).toBe('TEXT'); expect(historical.customFieldValues.cf_order).toBe('PO-PINNED');
    expect((await request('PATCH', `/invoices/${issued.id}/custom-fields`, { expectedVersion: issued.version, values: { cf_order: 'HACK' } })).status).toBe(409);
    current = await settings(); await data(await request('PUT', '/billing-settings/fields', { expectedVersion: current.version, customFields: [field] }));
  });
  it('issues once under concurrency, isolates firm number series and preserves exact status history', async () => {
    const created = await create(); const issued = await Promise.all(Array.from({ length: 5 }, () => issue(created)));
    expect(new Set(issued.map((entry) => entry.documentNumber)).size).toBe(1);
    expect(await db.invoiceStatusHistory.count({ where: { firmId: a.firm.id, invoiceId: created.id } })).toBe(2);
    const batch = await Promise.all(Array.from({ length: 5 }, () => create())); const numbers = await Promise.all(batch.map((document) => issue(document)));
    expect(new Set(numbers.map((document) => document.documentNumber)).size).toBe(5);
    const other = await issue(await create(b), b); expect(other.documentNumber).toMatch(/000001$/);
  });
  it('rolls issuance, sequence, status and audit back on an injected audit failure', async () => {
    const created = await create();
    const sequence = await db.documentSequence.findMany({ where: { firmId: a.firm.id, documentType: 'INVOICE' } });
    const failing = db.$extends({ query: { auditLog: { create: async () => { throw new Error('injected mandatory audit failure'); } } } });
    const { InvoicesRepository } = await import('../src/modules/invoices/invoices.repository.js');
    await expect(new InvoicesRepository(failing as unknown as PrismaClient).issue(a.firm.id, a.admin.id, created.id, created.version, created.grandTotal, 'INVOICE', {})).rejects.toThrow('injected');
    expect((await db.invoice.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('DRAFT');
    expect(await db.documentSequence.findMany({ where: { firmId: a.firm.id, documentType: 'INVOICE' } })).toEqual(sequence);
    expect(await db.invoiceStatusHistory.count({ where: { invoiceId: created.id } })).toBe(1);
    await issue(created);
  });
  it('keeps PDF bytes and snapshots immutable after customer, bank, item and settings changes', async () => {
    const issued = await issue(await create(a, { lines: [{ ...draft().lines[0]!, itemId: a.item.id }] }));
    const first = await data<{ document: { id: number } }>(await request('POST', `/invoices/${issued.id}/pdf`, {}), 201);
    const before = await (await request('GET', `/invoices/${issued.id}/documents/${first.document.id}/download`)).text();
    await db.company.update({ where: { id: a.company.id }, data: { name: 'Changed customer' } }); await db.bankDetail.update({ where: { id: a.bank.id }, data: { accountNumber: '987654321' } }); await db.item.update({ where: { id: a.item.id }, data: { name: 'Changed item', gstRate: '5' } });
    const second = await data<{ document: { id: number } }>(await request('POST', `/invoices/${issued.id}/pdf`, {}), 201);
    const after = await (await request('GET', `/invoices/${issued.id}/documents/${second.document.id}/download`)).text();
    expect(after).toBe(before); expect(after).not.toContain('987654321');
    expect((await request('GET', `/invoices/${issued.id}/documents/${first.document.id}/download`, undefined, b.admin.id)).status).toBe(404);
  });
  it('denies foreign direct IDs, PDF history, mutations, conversion and audit records without leaking data', async () => {
    const foreign = await create(b);
    for (const route of [`/invoices/${foreign.id}`, `/invoices/${foreign.id}/documents`, `/invoices/${foreign.id}/documents/1/download`]) expect((await request('GET', route)).status).toBe(404);
    expect((await request('POST', `/invoices/${foreign.id}/issue`, { expectedVersion: 1, confirmedTotal: foreign.grandTotal })).status).toBe(404);
    const list = await data<{ documents: Document[] }>(await request('GET', `/invoices?companyId=${b.company.id}`)); expect(list.documents).toEqual([]);
    expect((await request('GET', `/invoices/${foreign.id}`, undefined, a.admin.id, b.firm.id)).status).toBe(404);
    const logs = await request('GET', `/audit-logs?entityType=BillingDocument&entityId=${foreign.id}`); expect(await logs.text()).not.toContain(b.company.name);
  });
  it('keeps proformas non-posting and converts once into a distinct invoice draft and number', async () => {
    const proforma = await issue(await create(a, {}, '/proformas'), a, '/proformas'); expect(proforma.postingEffect).toBe('NONE');
    const key = randomUUID(); const results = await Promise.all(Array.from({ length: 3 }, () => request('POST', `/proformas/${proforma.id}/convert`, { idempotencyKey: key }).then((response) => data<{ document: Document }>(response, 201))));
    expect(new Set(results.map((entry) => entry.document.id)).size).toBe(1); const invoice = await issue(results[0]!.document); expect(invoice.documentNumber).not.toBe(proforma.documentNumber);
    expect((await request('POST', `/proformas/${proforma.id}/convert`, { idempotencyKey: randomUUID() })).status).toBe(409);
    expect((await request('GET', `/invoices/${proforma.id}`)).status).toBe(404);
  });
  it('creates traceable adjustment documents, prevents over-credit and preserves originals', async () => {
    const source = await issue(await create()); const original = await db.invoice.findUniqueOrThrow({ where: { id: source.id } });
    const note = { sourceInvoiceId: source.id, kind: 'CREDIT_NOTE', reason: 'Service deficiency', idempotencyKey: randomUUID(), gstReductionEligible: true, annualReturnFiledAt: null, recipientItcReversalConfirmed: true, lines: [{ sourceLineNumber: 1, quantity: '1', unitRate: '50.00' }], customFieldValues: { cf_order: 'CN-1' } };
    const created = (await data<{ document: Document }>(await request('POST', '/billing-adjustments', note), 201)).document;
    const credit = await issue(created, a, '/billing-adjustments'); expect(credit.kind).toBe('CREDIT_NOTE'); expect(credit.postingEffect).toBe('CREDIT');
    expect((await request('POST', '/billing-adjustments', { ...note, idempotencyKey: randomUUID(), lines: [{ sourceLineNumber: 1, quantity: '1', unitRate: '90' }] })).status).toBe(409);
    expect(await db.invoice.findUniqueOrThrow({ where: { id: source.id } })).toEqual(original);
    const debit = (await data<{ document: Document }>(await request('POST', '/billing-adjustments', { ...note, kind: 'DEBIT_NOTE', idempotencyKey: randomUUID(), reason: 'Additional agreed service' }), 201)).document; await issue(debit, a, '/billing-adjustments');
    const invalid = await create(); expect((await request('POST', '/billing-adjustments', { ...note, sourceInvoiceId: invalid.id, idempotencyKey: randomUUID() })).status).toBe(409);
  });
  it('converts the exact accepted quotation revision without following a later mutable family pointer', async () => {
    const q = (await data<{ quotation: { id: number } }>(await request('POST', '/quotations', { companyId: a.company.id, billingAddressId: a.address.id, quotationDate: indiaToday(), currency: 'INR', taxMode: 'CGST_SGST', items: [{ itemName: 'Accepted service', quantity: '1', unitRate: '12.34', gstRate: '18' }] }), 201)).quotation;
    const input = { sourceRevisionId: q.id, idempotencyKey: randomUUID(), supply: draft().supply, customFieldValues: { cf_order: 'Q-1' }, lineMetadata: [{ lineNumber: 1, hsnCode: '998311', supplyType: 'SERVICE' }] };
    expect((await request('POST', '/invoices/from-quotation', input)).status).toBe(409);
    await data(await request('PATCH', `/quotations/${q.id}/status`, { status: 'PENDING' })); await data(await request('PATCH', `/quotations/${q.id}/status`, { status: 'ACCEPTED' }));
    const revision = await data<{ quotation: { id: number } }>(await request('POST', `/quotations/${q.id}/revisions`, {}), 201);
    expect(revision.quotation.id).not.toBe(q.id);
    const converted = await Promise.all(Array.from({ length: 3 }, () => request('POST', '/invoices/from-quotation', input).then((response) => data<{ document: Document }>(response, 201))));
    expect(new Set(converted.map((entry) => entry.document.id)).size).toBe(1); expect(converted[0]!.document.lines[0]!.itemName).toBe('Accepted service');
    await issue(converted[0]!.document);
    expect((await request('POST', '/invoices/from-quotation', { ...input, idempotencyKey: randomUUID() })).status).toBe(409);
    expect((await request('POST', '/invoices/from-quotation', { ...input, idempotencyKey: randomUUID(), sourceRevisionId: revision.quotation.id })).status).toBe(409);
    expect((await request('POST', '/invoices/from-quotation', { ...input, idempotencyKey: randomUUID() }, b.admin.id)).status).toBe(404);
  });
  it('enforces denied plans, denied roles, global off, expired grants and suspended firms', async () => {
    expect((await request('GET', '/invoices', undefined, a.reader.id)).status).toBe(403);
    const subscription = await db.firmSubscription.findFirstOrThrow({ where: { firmId: b.firm.id } });
    await db.firmSubscription.update({ where: { id: subscription.id }, data: { status: 'SUSPENDED' } }); expect((await request('GET', '/invoices', undefined, b.admin.id)).status).toBe(403);
    await db.firmSubscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE' } });
    await db.platformFeatureSwitch.create({ data: { key: 'billing.invoices', hardDisabled: true, authorId: a.admin.id, reason: 'Disposable test' } });
    try { expect((await request('GET', '/invoices')).status).toBe(403); } finally { await db.platformFeatureSwitch.delete({ where: { key: 'billing.invoices' } }); }
    await db.firm.update({ where: { id: b.firm.id }, data: { status: 'SUSPENDED' } }); expect((await request('GET', '/invoices', undefined, b.admin.id)).status).toBe(403); await db.firm.update({ where: { id: b.firm.id }, data: { status: 'ACTIVE' } });
    const other = await fixture.createTenant('no-plan');
    await expect(repository.get(other.firm.id, 1, 'INVOICE')).rejects.toMatchObject({ statusCode: 403 });
    await db.firmFeatureOverride.create({ data: { firmId: other.firm.id, target: 'feature:billing.invoices', effect: 'ALLOW', authorId: other.admin.id, reason: 'Expired fixture', startsAt: new Date(Date.now() - 20000), expiresAt: new Date(Date.now() - 10000) } });
    await expect(repository.get(other.firm.id, 1, 'INVOICE')).rejects.toMatchObject({ statusCode: 403 });
  });
  it('enforces PDF document quota without requiring quotation-document entitlement or leaving orphan metadata', async () => {
    const issued = await issue(await create());
    const counter = await db.usageCounter.findUniqueOrThrow({ where: { firmId_resource: { firmId: a.firm.id, resource: 'documents' } } });
    const override = await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: 'quota:documents', effect: 'LIMIT', limit: counter.used, authorId: a.admin.id, reason: 'Quota fixture', startsAt: new Date() } });
    try { expect((await request('POST', `/invoices/${issued.id}/pdf`, {})).status).toBe(409); expect(await db.invoiceDocument.count({ where: { invoiceId: issued.id } })).toBe(0); } finally { await db.firmFeatureOverride.delete({ where: { id: override.id } }); }
    await data(await request('POST', `/invoices/${issued.id}/pdf`, {}), 201);
  });
  it('retains voided numbers and blocks IRN-required B2B issuance', async () => {
    const source = await issue(await create());
    const voided = (await data<{ document: Document }>(await request('POST', `/invoices/${source.id}/void`, { expectedVersion: source.version, reason: 'Supply cancelled before reporting', notReportedAndSupplyCancelled: true }))).document;
    expect(voided.status).toBe('VOID'); expect(voided.documentNumber).toBe(source.documentNumber);
    await db.company.update({ where: { id: b.company.id }, data: { gstin: '27AAPFU0939F1ZV' } });
    const current = await settings(b); const { customFields: _, ...config } = current.config;
    await data(await request('PUT', '/billing-settings', { expectedVersion: current.version, config: { ...config, einvoiceRequired: true } }, b.admin.id));
    const b2b = await create(b); expect((await request('POST', `/invoices/${b2b.id}/issue`, { expectedVersion: b2b.version, confirmedTotal: b2b.grandTotal }, b.admin.id)).status).toBe(409);
  });
});
