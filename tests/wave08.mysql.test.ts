import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TwoFirmFixture, assertDisposableTenantDatabase, type TenantFixture } from './helpers/two-firm-fixture.js';
import type { OutboxRepository } from '../src/core/outbox/outbox.repository.js';

const testUrl = process.env.WAVE08_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
type Publication = { id: number; key: string; version: number; definition: Record<string, unknown> };
type Approval = { id: string; status: string; policyId: number; fingerprint: string; command: Record<string, unknown> };
suite('Wave 08 authenticated tenant automation and transactional execution', () => {
  let db: PrismaClient; let fixture: TwoFirmFixture; let a: TenantFixture; let b: TenantFixture;
  let secondAdmin: Awaited<ReturnType<TwoFirmFixture['createActor']>>; let server: Server; let base: string; let origin: string; let planId: number;
  let worker: OutboxRepository; let failAction = false; let failFinancialAudit = false;
  const cookies = new Map<number, string>(); const warehouses = new Map<number, number>();
  async function request(method: string, path: string, body?: unknown, actorId = a.admin.id) {
    return fetch(`${base}/api/v1${path}`, { method, headers: { Cookie: cookies.get(actorId)!, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function data<T>(response: Response, status = 200): Promise<T> { expect(response.status, await response.clone().text()).toBe(status); return (await response.json() as { data: T }).data; }
  async function publish(path: string, key: string, definition: unknown, expectedVersion = 0, actorId = a.admin.id) {
    return (await data<{ definition: Publication }>(await request('POST', `${path}/${key}/publish`, { expectedVersion, definition }, actorId), 201)).definition;
  }
  function policy(action: string, enabled = true) { return { action, enabled, expiresAfterHours: 48, authority: 'OTHER_FIRM_ADMIN' }; }
  function rule(recipientId = a.admin.id, delayMinutes = 0) { return { enabled: true, name: 'Stock notice', trigger: 'stock.adjusted', delayMinutes, expiresAfterMinutes: 1440, entry: 'notify', steps: [{ id: 'notify', type: 'NOTIFY', recipientIds: [recipientId], title: '{{documentNumber}}', body: '{{entityType}} {{status}}', next: 'finish' }, { id: 'finish', type: 'STOP' }] }; }
  function adjustment(tenant = a) { return { itemId: tenant.item.id, warehouseId: warehouses.get(tenant.firm.id)!, direction: 'IN', quantity: '1', unitCost: '2.00', reason: 'Reviewed fixture stock', idempotencyKey: randomUUID() }; }
  async function drain(limit = 100) { for (let index = 0; index < limit && await worker.runOne('wave08-fixture'); index++); }
  beforeAll(async () => {
    assertDisposableTenantDatabase(testUrl!, '08');
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', testUrl!); vi.stubEnv('JWT_ACCESS_SECRET', 'wave08-disposable-access-secret'); vi.stubEnv('JWT_REFRESH_SECRET', 'wave08-disposable-refresh-secret'); vi.stubEnv('OUTBOX_WORKER_ENABLED', 'false');
    db = new PrismaClient({ datasources: { db: { url: testUrl! } } }); fixture = new TwoFirmFixture(db);
    const applied = await db.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261108150000_wave08_tenant_automation' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(applied).toHaveLength(1);
    db.$use(async (params, next) => { if (failAction && params.model === 'WorkflowActionResult' && params.action === 'upsert') throw new Error('Injected transactional action failure'); if (failFinancialAudit && params.model === 'AuditLog' && params.action === 'create' && params.args.data.entityType === 'BillingDocument') throw new Error('Injected financial audit failure'); return next(params); });
    vi.doMock('../src/core/database/prisma.js', () => ({ prisma: db }));
    vi.doMock('../src/integrations/mail/index.js', () => ({ mailService: { send: vi.fn().mockRejectedValue(new Error('External mail disabled')) } }));
    vi.doMock('../src/integrations/documents/index.js', () => ({ renderAndStorePdf: vi.fn().mockRejectedValue(new Error('External rendering disabled')) }));
    a = await fixture.createTenant('automation-A'); b = await fixture.createTenant('automation-B'); secondAdmin = await fixture.createActor(a.firm.id, 'FIRM_ADMIN');
    const { FEATURE_KEYS } = await import('../src/modules/entitlements/feature-registry.js'); const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const plan = await db.plan.create({ data: { name: 'Wave08 fixture', slug: `wave08-${randomUUID()}`, versions: { create: { revision: 1, createdById: a.admin.id, publishedAt: new Date(), policy: LEGACY_POLICY, features: { create: FEATURE_KEYS.map((featureKey) => ({ featureKey })) }, quotas: { create: ['users', 'documents', 'storageBytes', 'aiCredits'].map((resource) => ({ resource, limit: null })) } } } }, include: { versions: true } }); planId = plan.id;
    for (const tenant of [a, b]) {
      await db.firmSubscription.create({ data: { firmId: tenant.firm.id, planVersionId: plan.versions[0]!.id, status: 'ACTIVE', authorId: tenant.admin.id, reason: 'Disposable automation fixture', effectiveFrom: new Date(Date.now() - 1000) } });
      await db.item.update({ where: { id: tenant.item.id }, data: { stockTracking: true } });
      const warehouse = await db.warehouse.create({ data: { firmId: tenant.firm.id, code: 'MAIN', name: 'Fixture warehouse' } }); warehouses.set(tenant.firm.id, warehouse.id);
    }
    const { generateAccessToken } = await import('../src/modules/auth/security/auth.tokens.js'); const { ACCESS_TOKEN_COOKIE_NAME } = await import('../src/modules/auth/auth.constants.js');
    for (const actor of [a.admin, a.reader, b.admin, secondAdmin]) {
      const session = await db.authSession.create({ data: { userId: actor.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3600000) } });
      cookies.set(actor.id, `${ACCESS_TOKEN_COOKIE_NAME}=${generateAccessToken({ userId: actor.id, role: actor.role, sessionId: session.id })}`);
    }
    origin = new URL((await import('../src/config/env.js')).env.FRONTEND_URL).origin;
    const { app } = await import('../src/bootstrap/app.js'); server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Disposable listener unavailable'); base = `http://127.0.0.1:${address.port}`;
    const { OutboxRepository: Worker } = await import('../src/core/outbox/outbox.repository.js'); const { workflowHandler, workflowNotificationHandler } = await import('../src/modules/automation/workflows.repository.js'); const { inAppNotificationHandler } = await import('../src/modules/notifications/notifications.repository.js');
    worker = new Worker(db, { 'automation.workflow.v1': workflowHandler, 'automation.notification.v1': workflowNotificationHandler, 'notifications.in-app.v1': inAppNotificationHandler });
    await data(await request('PUT', '/billing-settings', { expectedVersion: 0, config: { schemaVersion: 1, registration: 'UNREGISTERED', sellerStateCode: '24', einvoiceRequired: false, prefixes: { INVOICE: 'INV', PROFORMA: 'PF', CREDIT_NOTE: 'CN', DEBIT_NOTE: 'DN' }, template: 'STANDARD', primaryColour: '#168A56', paymentInstructions: '', termsAndConditions: '' } }));
  }, 60000);
  afterAll(async () => {
    try { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); if (fixture) await fixture.cleanup(); if (planId) await db.plan.update({ where: { id: planId }, data: { archivedAt: new Date() } }); }
    finally { if (db) await db.$disconnect(); vi.doUnmock('../src/core/database/prisma.js'); vi.doUnmock('../src/integrations/mail/index.js'); vi.doUnmock('../src/integrations/documents/index.js'); vi.unstubAllEnvs(); }
  }, 60000);

  it('denies role, plan and suspended-firm APIs, including direct publication', async () => {
    expect((await request('POST', '/automation/workflows/denied/publish', { expectedVersion: 0, definition: rule() }, a.reader.id)).status).toBe(403);
    const denied = await db.firmFeatureOverride.create({ data: { firmId: b.firm.id, target: 'feature:automation', effect: 'DENY', startsAt: new Date(Date.now() - 1000), authorId: b.admin.id, reason: 'Fixture denied feature' } });
    expect((await request('POST', '/automation/workflows/denied/publish', { expectedVersion: 0, definition: rule(b.admin.id) }, b.admin.id)).status).toBe(403);
    await db.firmFeatureOverride.update({ where: { id: denied.id }, data: { revokedAt: new Date() } });
    await db.firm.update({ where: { id: b.firm.id }, data: { status: 'SUSPENDED' } });
    expect((await request('GET', '/automation/workflows', undefined, b.admin.id)).status).toBe(403);
    await db.firm.update({ where: { id: b.firm.id }, data: { status: 'ACTIVE' } });
    const { evaluateFeature } = await import('../src/modules/entitlements/entitlement-evaluator.js'); const { loadEntitlements } = await import('../src/modules/entitlements/entitlements.repository.js');
    expect(evaluateFeature((await loadEntitlements(db, a.firm.id)).context, 'automation').allowed).toBe(true);
  });
  it('rejects foreign recipients and unsafe templates, and scopes history and value IDs', async () => {
    expect((await request('POST', '/automation/workflows/foreign/publish', { expectedVersion: 0, definition: rule(b.admin.id) })).status).toBe(403);
    expect((await request('POST', '/templates/QUOTATION/publish', { expectedVersion: 0, definition: { enabled: true, entity: 'QUOTATION', heading: '{{company.bankAccount}}', footer: '', primaryColour: '#168A56' } })).status).toBe(400);
    const field = { key: 'cf_project', label: 'Project', type: 'TEXT', required: false, searchable: true, visibility: 'INTERNAL', classification: 'BUSINESS', options: [] };
    const foreign = await publish('/custom-fields', 'COMPANY', { enabled: true, entity: 'COMPANY', fields: [field] }, 0, b.admin.id);
    expect((await request('GET', `/custom-fields/values/COMPANY/${b.company.id}`)).status).toBe(404);
    const own = await publish('/custom-fields', 'COMPANY', { enabled: true, entity: 'COMPANY', fields: [field] });
    expect((await request('PUT', `/custom-fields/values/COMPANY/${a.company.id}`, { expectedVersion: 0, definitionId: foreign.id, values: { cf_project: 'Foreign ID' } })).status).toBe(409);
    await data(await request('PUT', `/custom-fields/values/COMPANY/${a.company.id}`, { expectedVersion: 0, definitionId: own.id, values: { cf_project: 'Project A' } }), 201);
    const search = await data<{ entityIds: number[] }>(await request('GET', '/custom-fields/search/COMPANY?key=cf_project&value=Project%20A')); expect(search.entityIds).toEqual([a.company.id]);
    const history = await data<{ versions: Publication[] }>(await request('GET', '/custom-fields/COMPANY')); expect(history.versions.every((version) => version.id !== foreign.id)).toBe(true);
  });
  it('requires another administrator, pins policy versions and consumes one approval atomically under concurrent replay', async () => {
    const published = await publish('/approvals/policies', 'STOCK_ADJUST', policy('STOCK_ADJUST'));
    const input = adjustment(); const { itemId, ...stock } = input; const command = { action: 'STOCK_ADJUST', entityId: itemId, ...stock };
    expect((await request('POST', '/stock/adjustments', input)).status).toBe(409);
    const approval = (await data<{ approval: Approval }>(await request('POST', '/approvals', command), 201)).approval;
    const duplicate = (await data<{ approval: Approval }>(await request('POST', '/approvals', command), 201)).approval; expect(duplicate.id).toBe(approval.id);
    expect((await request('POST', `/approvals/${approval.id}/decisions`, { decision: 'APPROVED', reason: 'Self approval attempt' })).status).toBe(403);
    expect((await request('POST', `/approvals/${approval.id}/decisions`, { decision: 'APPROVED', reason: 'Foreign approval attempt' }, b.admin.id)).status).toBe(404);
    await publish('/approvals/policies', 'STOCK_ADJUST', { ...policy('STOCK_ADJUST'), expiresAfterHours: 24 }, published.version);
    const decisions = await Promise.all([request('POST', `/approvals/${approval.id}/decisions`, { decision: 'APPROVED', reason: 'Independent review complete' }, secondAdmin.id), request('POST', `/approvals/${approval.id}/decisions`, { decision: 'APPROVED', reason: 'Concurrent independent review' }, secondAdmin.id)]);
    expect(decisions.map((response) => response.status).sort()).toEqual([200, 409]);
    const responses = await Promise.all([request('POST', '/stock/adjustments', input), request('POST', '/stock/adjustments', input)]);
    const results = await Promise.all(responses.map((response) => data<{ operation: { id: number } }>(response, 201))); expect(results[0]!.operation.id).toBe(results[1]!.operation.id);
    const saved = await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } }); expect(saved.policyId).toBe(published.id); expect(saved.consumedAt).not.toBeNull();
    expect(await db.stockMovement.count({ where: { firmId: a.firm.id, sourceId: results[0]!.operation.id, eventType: 'ADJUSTMENT' } })).toBe(1);
    const current = await db.automationDefinitionVersion.findFirstOrThrow({ where: { firmId: a.firm.id, kind: 'APPROVAL', key: 'STOCK_ADJUST' }, orderBy: { version: 'desc' } });
    await publish('/approvals/policies', 'STOCK_ADJUST', policy('STOCK_ADJUST', false), current.version);
  });
  it('deduplicates event replay, rolls back failed actions and recovers through the existing outbox', async () => {
    await data(await request('PUT', '/automation/preferences', { enabled: true, utcOffsetMinutes: 0, quietStartMinute: null, quietEndMinute: null }));
    const published = await publish('/automation/workflows', 'stock_notice', rule()); const input = adjustment();
    await data(await request('POST', '/stock/adjustments', input), 201); await data(await request('POST', '/stock/adjustments', input), 201);
    expect(await db.workflowRun.count({ where: { firmId: a.firm.id, definitionId: published.id } })).toBe(1);
    failAction = true; try { await worker.runOne('wave08-failing'); } finally { failAction = false; }
    const run = await db.workflowRun.findFirstOrThrow({ where: { firmId: a.firm.id, definitionId: published.id } });
    expect(await db.workflowActionResult.count({ where: { runId: run.id } })).toBe(0);
    await db.outboxEvent.update({ where: { id: run.outboxId }, data: { availableAt: new Date() } }); await drain();
    expect(await db.notificationDelivery.count({ where: { firmId: a.firm.id, event: { kind: 'automation.notification.v1' } } })).toBe(1);
    expect(await db.workflowRun.count({ where: { firmId: a.firm.id } })).toBe(1);
    const diagnostics = await data<{ runs: Array<{ id: string; jobs: Array<{ jobAttempts: unknown[] }> }> }>(await request('GET', '/automation/runs')); expect(diagnostics.runs[0]!.jobs.some((job) => job.jobAttempts.length > 1)).toBe(true);
  });
  it('integrates invoice, void and credit-note approvals with immutable field values and issued templates', async () => {
    const field = { key: 'cf_reference', label: 'Reference', type: 'TEXT', required: false, searchable: false, visibility: 'DOCUMENT', classification: 'BUSINESS', options: [] };
    await publish('/custom-fields', 'INVOICE', { enabled: true, entity: 'INVOICE', fields: [field] });
    const template = await publish('/templates', 'INVOICE', { enabled: true, entity: 'INVOICE', heading: 'Approved original brand', footer: '{{documentNumber}}', primaryColour: '#168A56' });
    await publish('/approvals/policies', 'INVOICE_ISSUE', policy('INVOICE_ISSUE'));
    type Invoice = { id: number; version: number; grandTotal: string; status: string };
    const draftInput = () => ({ companyId: a.company.id, billingAddressId: a.address.id, invoiceDate: new Date().toISOString().slice(0, 10), supply: { isExempt: true, placeOfSupplyStateCode: '24', placeOfSupplyBasis: 'SERVICES_GENERAL', explanation: '' }, customFieldValues: { cf_reference: 'Original reference' }, lines: [{ itemName: 'Fixture service', supplyType: 'SERVICE', measurementUnit: 'HOUR', quantity: '1', unitRate: '20.00', discountType: 'NONE', discountValue: '0', taxRate: '0' }], idempotencyKey: randomUUID() });
    const approve = async (command: Record<string, unknown>) => { const row = (await data<{ approval: Approval }>(await request('POST', '/approvals', command), 201)).approval; await data(await request('POST', `/approvals/${row.id}/decisions`, { decision: 'APPROVED', reason: 'Independent financial review' }, secondAdmin.id)); return row; };
    const created = (await data<{ document: Invoice }>(await request('POST', '/invoices', draftInput()), 201)).document;
    const edited = (await data<{ document: Invoice }>(await request('PATCH', `/invoices/${created.id}/custom-fields`, { expectedVersion: created.version, values: { cf_reference: 'Revised reference' }, refresh: false }))).document;
    const values = await data<{ history: Array<{ version: number; values: Record<string, unknown> }> }>(await request('GET', `/invoices/${created.id}/custom-fields/history`));
    expect(values.history.map((row) => row.values.cf_reference)).toEqual(['Revised reference', 'Original reference']);
    expect((await request('GET', `/invoices/${created.id}/custom-fields/history`, undefined, b.admin.id)).status).toBe(404);
    const issue = { expectedVersion: edited.version, confirmedTotal: edited.grandTotal };
    expect((await request('POST', `/invoices/${edited.id}/issue`, issue)).status).toBe(409);
    const approved = await approve({ action: 'INVOICE_ISSUE', entityId: edited.id, ...issue });
    failFinancialAudit = true; try { expect((await request('POST', `/invoices/${edited.id}/issue`, issue)).status).toBe(500); } finally { failFinancialAudit = false; }
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approved.id } })).consumedAt).toBeNull();
    expect((await db.invoice.findUniqueOrThrow({ where: { id: edited.id } })).status).toBe('DRAFT');
    const issued = (await data<{ document: Invoice }>(await request('POST', `/invoices/${edited.id}/issue`, issue))).document;
    await publish('/templates', 'INVOICE', { ...template.definition, heading: 'New future brand' }, template.version);
    const snapshot = (await db.invoice.findUniqueOrThrow({ where: { id: issued.id } })).issueSnapshot;
    const { renderInvoiceHtml } = await import('../src/modules/invoices/documents/invoice-document.template.js');
    expect(renderInvoiceHtml(snapshot)).toContain('Approved original brand'); expect(renderInvoiceHtml(snapshot)).not.toContain('New future brand');
    await publish('/approvals/policies', 'CREDIT_NOTE_ISSUE', policy('CREDIT_NOTE_ISSUE'));
    const credit = (await data<{ document: Invoice }>(await request('POST', '/billing-adjustments', { sourceInvoiceId: issued.id, kind: 'CREDIT_NOTE', reason: 'Fixture partial service credit', idempotencyKey: randomUUID(), gstReductionEligible: false, annualReturnFiledAt: null, recipientItcReversalConfirmed: false, lines: [{ sourceLineNumber: 1, quantity: '1', unitRate: '5.00' }], customFieldValues: {} }), 201)).document;
    const creditIssue = { expectedVersion: credit.version, confirmedTotal: credit.grandTotal }; expect((await request('POST', `/billing-adjustments/${credit.id}/issue`, creditIssue)).status).toBe(409);
    await approve({ action: 'CREDIT_NOTE_ISSUE', entityId: credit.id, ...creditIssue }); await data(await request('POST', `/billing-adjustments/${credit.id}/issue`, creditIssue));
    const other = (await data<{ document: Invoice }>(await request('POST', '/invoices', draftInput()), 201)).document;
    const otherIssue = { expectedVersion: other.version, confirmedTotal: other.grandTotal }; await approve({ action: 'INVOICE_ISSUE', entityId: other.id, ...otherIssue });
    const otherIssued = (await data<{ document: Invoice }>(await request('POST', `/invoices/${other.id}/issue`, otherIssue))).document;
    await publish('/approvals/policies', 'INVOICE_VOID', policy('INVOICE_VOID')); const voidInput = { expectedVersion: otherIssued.version, reason: 'Fixture same-day cancellation', notReportedAndSupplyCancelled: true };
    expect((await request('POST', `/invoices/${other.id}/void`, voidInput)).status).toBe(409); await approve({ action: 'INVOICE_VOID', entityId: other.id, ...voidInput }); await data(await request('POST', `/invoices/${other.id}/void`, voidInput));
  });
  it('protects discounted quotation commitment and order confirmation through their existing commands', async () => {
    await publish('/approvals/policies', 'QUOTATION_SEND', { ...policy('QUOTATION_SEND'), discountPercent: '5' });
    const quotation = (await data<{ quotation: { id: number } }>(await request('POST', '/quotations', { companyId: a.company.id, billingAddressId: a.address.id, quotationDate: new Date().toISOString().slice(0, 10), currency: 'INR', taxMode: 'NONE', quotationDiscountType: 'PERCENTAGE', quotationDiscountValue: 10, items: [{ itemName: 'Fixture service', measurementUnit: 'HOUR', quantity: 1, unitRate: 100, gstRate: 0 }] }), 201)).quotation;
    expect((await request('PATCH', `/quotations/${quotation.id}/status`, { status: 'SENT' })).status).toBe(409);
    const approve = async (command: Record<string, unknown>) => { const row = (await data<{ approval: Approval }>(await request('POST', '/approvals', command), 201)).approval; await data(await request('POST', `/approvals/${row.id}/decisions`, { decision: 'APPROVED', reason: 'Independent sales review' }, secondAdmin.id)); };
    await approve({ action: 'QUOTATION_SEND', entityId: quotation.id, status: 'SENT' }); await data(await request('PATCH', `/quotations/${quotation.id}/status`, { status: 'SENT' })); await data(await request('PATCH', `/quotations/${quotation.id}/status`, { status: 'ACCEPTED' }));
    await publish('/approvals/policies', 'ORDER_CONFIRM', policy('ORDER_CONFIRM'));
    const input = { sourceRevisionId: quotation.id, idempotencyKey: randomUUID() }; expect((await request('POST', '/sales-orders/from-quotation', input)).status).toBe(409);
    await approve({ action: 'ORDER_CONFIRM', entityId: quotation.id, idempotencyKey: input.idempotencyKey }); await data(await request('POST', '/sales-orders/from-quotation', input), 201);
  });
  it('rechecks consent, quiet hours and worker entitlements after enqueue, and denies foreign run controls', async () => {
    const minute = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
    await data(await request('PUT', '/automation/preferences', { enabled: true, utcOffsetMinutes: 0, quietStartMinute: (minute + 1439) % 1440, quietEndMinute: (minute + 60) % 1440 }));
    await data(await request('POST', '/stock/adjustments', adjustment()), 201); await drain();
    const deferred = await db.outboxEvent.findFirstOrThrow({ where: { firmId: a.firm.id, kind: 'automation.notification.v1', status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    expect(deferred.availableAt.getTime()).toBeGreaterThan(Date.now()); expect(deferred.maxAttempts).toBeGreaterThan(5);
    const count = await db.notificationDelivery.count({ where: { firmId: a.firm.id } });
    await data(await request('PUT', '/automation/preferences', { enabled: false, utcOffsetMinutes: 0, quietStartMinute: null, quietEndMinute: null }));
    await db.outboxEvent.update({ where: { id: deferred.id }, data: { availableAt: new Date() } }); await drain(); expect(await db.notificationDelivery.count({ where: { firmId: a.firm.id } })).toBe(count);
    const foreign = await publish('/automation/workflows', 'foreign_notice', rule(b.admin.id), 0, b.admin.id);
    await data(await request('POST', '/stock/adjustments', adjustment(b), b.admin.id), 201);
    const foreignRun = await db.workflowRun.findFirstOrThrow({ where: { firmId: b.firm.id, definitionId: foreign.id } });
    expect((await request('POST', `/automation/runs/${foreignRun.id}/CANCEL`, {})).status).toBe(404);
    const denied = await db.firmFeatureOverride.create({ data: { firmId: b.firm.id, target: 'feature:automation', effect: 'DENY', startsAt: new Date(Date.now() - 1000), authorId: b.admin.id, reason: 'Fixture worker revocation' } });
    await drain(); expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: foreignRun.outboxId } })).status).toBe('DEAD');
    expect(await db.notificationDelivery.count({ where: { firmId: b.firm.id } })).toBe(0);
    await db.firmFeatureOverride.update({ where: { id: denied.id }, data: { revokedAt: new Date() } });
    await data(await request('POST', `/automation/runs/${foreignRun.id}/RETRY`, {}, b.admin.id)); await drain();
    expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: foreignRun.outboxId } })).status).toBe('SUCCEEDED');
  });
  it('preserves immutable publication history and cancels or expires pending work without output', async () => {
    const template = await publish('/templates', 'QUOTATION', { enabled: true, entity: 'QUOTATION', heading: '<script>{{businessName}}</script>', footer: '{{documentNumber}}', primaryColour: '#168A56' });
    await expect(db.automationDefinitionVersion.update({ where: { id: template.id }, data: { version: 9 } })).rejects.toThrow();
    await data(await request('POST', '/templates/QUOTATION/rollback', { expectedVersion: template.version, version: template.version }), 201);
    expect(await db.automationDefinitionVersion.count({ where: { firmId: a.firm.id, kind: 'TEMPLATE', key: 'QUOTATION' } })).toBe(2);
    const delayed = await publish('/notification-rules', 'delayed', rule(a.admin.id, 60));
    await data(await request('POST', '/stock/adjustments', adjustment()), 201);
    const run = await db.workflowRun.findFirstOrThrow({ where: { firmId: a.firm.id, definitionId: delayed.id } });
    await data(await request('POST', `/automation/runs/${run.id}/CANCEL`, {}));
    await db.outboxEvent.update({ where: { id: run.outboxId }, data: { availableAt: new Date() } }); await drain();
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('CANCELLED'); expect(await db.workflowActionResult.count({ where: { runId: run.id } })).toBe(0);
    await data(await request('POST', '/stock/adjustments', adjustment()), 201);
    const expiring = await db.workflowRun.findFirstOrThrow({ where: { firmId: a.firm.id, definitionId: delayed.id, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    await db.workflowRun.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await db.outboxEvent.update({ where: { id: expiring.outboxId }, data: { availableAt: new Date() } }); await drain();
    expect((await db.workflowRun.findUniqueOrThrow({ where: { id: expiring.id } })).status).toBe('EXPIRED'); expect(await db.workflowActionResult.count({ where: { runId: expiring.id } })).toBe(0);
  });
  it('rechecks a recipient role revoked after the originating event was committed', async () => {
    await data(await request('PUT', '/automation/preferences', { enabled: true, utcOffsetMinutes: 0, quietStartMinute: null, quietEndMinute: null }, secondAdmin.id));
    const published = await publish('/automation/workflows', 'revoked_recipient', rule(secondAdmin.id));
    await data(await request('POST', '/stock/adjustments', adjustment()), 201);
    const run = await db.workflowRun.findFirstOrThrow({ where: { firmId: a.firm.id, definitionId: published.id } });
    await db.user.update({ where: { id: secondAdmin.id }, data: { accountType: 'FIRM_USER', firmRoleId: a.role.id } });
    try {
      await drain();
      expect(await db.notificationDelivery.count({ where: { firmId: a.firm.id, recipientId: secondAdmin.id } })).toBe(0);
      expect(await db.outboxEvent.count({ where: { firmId: a.firm.id, correlationId: run.id, kind: 'automation.notification.v1', status: 'DEAD' } })).toBe(1);
    } finally { await db.user.update({ where: { id: secondAdmin.id }, data: { accountType: 'FIRM_ADMIN', firmRoleId: null } }); }
  });
  it('retains the existing generated-document quota when committing tenant-branded quotation metadata', async () => {
    const quotation = await db.quotation.findFirstOrThrow({ where: { firmId: a.firm.id, deletedAt: null } });
    const { quotationDocumentsRepository } = await import('../src/modules/quotations/documents/quotation-documents.repository.js');
    const quota = await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: 'quota:documents', effect: 'LIMIT', limit: 0n, startsAt: new Date(), authorId: a.admin.id, reason: 'Exhausted tenant-branded document quota' } });
    const before = await db.generatedDocument.count({ where: { quotationId: quotation.id } });
    try {
      await expect(quotationDocumentsRepository.createGeneratedDocument({ firmId: a.firm.id, quotationId: quotation.id, generatedById: a.admin.id, filePath: `quotation-documents/${a.firm.id}/${randomUUID()}.pdf`, fileHash: '0'.repeat(64), fileSize: 1, expectedUpdatedAt: quotation.updatedAt, presentation: { templateVersionId: null, template: null, fields: [] } })).rejects.toMatchObject({ statusCode: 409 });
      expect(await db.generatedDocument.count({ where: { quotationId: quotation.id } })).toBe(before);
    } finally { await db.firmFeatureOverride.update({ where: { id: quota.id }, data: { revokedAt: new Date() } }); }
  });
});
