import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TwoFirmFixture, assertDisposableTenantDatabase, type TenantFixture } from './helpers/two-firm-fixture.js';
import { indiaToday } from '../src/modules/invoices/india-gst.js';
import type { InvoiceDraftInput } from '../src/modules/invoices/invoices.schema.js';
import type { BillingSchedulesRepository } from '../src/modules/billing-schedules/billing-schedules.repository.js';
import type { OutboxRepository } from '../src/core/outbox/outbox.repository.js';

const testUrl = process.env.WAVE05_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
type Document = { id: number; version: number; status: string; grandTotal: string };
type Payment = { id: number; amount: string; allocated: string; unapplied: string; status: string; refunded: string; reversal: { amount: string } | null };
type Schedule = { id: number; version: number; status: string; runs: Array<{ id: number; invoiceId: number | null; period: string; status: string; retryCount: number; event: { id: string; status: string } | null }> };

suite('Wave 05 authenticated customer ledger and recurring transactions', () => {
  let db: PrismaClient; let fixture: TwoFirmFixture; let a: TenantFixture; let b: TenantFixture;
  let server: Server; let base: string; let planId: number; let planVersionId: number;
  let schedules: BillingSchedulesRepository; let worker: OutboxRepository;
  let temporaryStorage: string; let originalStorage: string;
  let failAuditFor: string | null = null;
  const cookies = new Map<number, string>();
  async function request(method: string, route: string, body?: unknown, actorId = a.admin.id, selectedFirm?: number) {
    return fetch(`${base}/api/v1${route}`, { method, headers: { Cookie: cookies.get(actorId)!, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(selectedFirm === undefined ? {} : { 'x-firm-id': String(selectedFirm) }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function data<T>(response: Response, status = 200): Promise<T> { expect(response.status, await response.clone().text()).toBe(status); return (await response.json() as { data: T }).data; }
  function draft(tenant = a): InvoiceDraftInput { return { companyId: tenant.company.id, billingAddressId: tenant.address.id, invoiceDate: indiaToday(), supply: { isExempt: true, placeOfSupplyStateCode: '24', placeOfSupplyBasis: 'SERVICES_GENERAL', explanation: '' }, customFieldValues: {}, lines: [{ itemName: 'Recurring service', supplyType: 'SERVICE', measurementUnit: 'HOUR', quantity: '1', unitRate: '100.00', discountType: 'NONE', discountValue: '0', taxRate: '0' }], idempotencyKey: randomUUID() }; }
  async function createDraft(tenant = a) { return (await data<{ document: Document }>(await request('POST', '/invoices', draft(tenant), tenant.admin.id), 201)).document; }
  async function issued(tenant = a) { const row = await createDraft(tenant); return (await data<{ document: Document }>(await request('POST', `/invoices/${row.id}/issue`, { expectedVersion: row.version, confirmedTotal: row.grandTotal }, tenant.admin.id))).document; }
  function receipt(tenant = a, amount = '100.00', allocations: Array<{ invoiceId: number; amount: string }> = []) { return { companyId: tenant.company.id, currency: 'INR', amount, method: 'CASH', receivedDate: indiaToday(), confirmed: true, idempotencyKey: randomUUID(), allocations }; }
  async function payment(tenant = a, amount = '100.00', allocations: Array<{ invoiceId: number; amount: string }> = []) { return (await data<{ payment: Payment }>(await request('POST', '/payments', receipt(tenant, amount, allocations), tenant.admin.id), 201)).payment; }
  async function settlement(id: number) { return data<{ outstanding: string; allocated: string; settlementStatus: string }>(await request('GET', `/receivables/invoices/${id}`)); }
  async function createSchedule() { const source = await createDraft(); return (await data<{ schedule: Schedule }>(await request('POST', '/billing-schedules', { name: `Schedule ${randomUUID()}`, sourceDraftId: source.id, startDate: indiaToday(), endDate: null, intervalMonths: 1, dueDays: 30, idempotencyKey: randomUUID() }), 201)).schedule; }
  async function approve(row: Schedule) { const preview = await data<{ previewToken: string }>(await request('GET', `/billing-schedules/${row.id}/preview`)); await data(await request('POST', `/billing-schedules/${row.id}/approve`, { expectedVersion: row.version, previewToken: preview.previewToken })); }
  async function schedule(id: number) { return (await data<{ schedule: Schedule }>(await request('GET', `/billing-schedules/${id}`))).schedule; }
  async function drain() { for (let i = 0; i < 100; i++) if (!await worker.runOne('wave05-fixture')) return; throw new Error('Fixture queue did not settle'); }

  beforeAll(async () => {
    assertDisposableTenantDatabase(testUrl!, '05');
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', testUrl!); vi.stubEnv('JWT_ACCESS_SECRET', 'wave05-disposable-access-secret'); vi.stubEnv('JWT_REFRESH_SECRET', 'wave05-disposable-refresh-secret'); vi.stubEnv('JWT_ACCESS_EXPIRES_IN', '1h');
    db = new PrismaClient({ datasources: { db: { url: testUrl! } } });
    const applied = await db.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261103120000_wave05_customer_payments' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(applied).toHaveLength(1);
    db.$use(async (params, next) => { if (failAuditFor && params.model === 'AuditLog' && params.action === 'create' && params.args.data.entityType === failAuditFor) throw new Error('Injected required-audit failure'); return next(params); });
    vi.doMock('../src/core/database/prisma.js', () => ({ prisma: db }));
    vi.doMock('../src/integrations/mail/index.js', () => ({ mailService: { send: vi.fn().mockRejectedValue(new Error('External mail disabled')) } }));
    vi.doMock('../src/integrations/pdf/index.js', () => ({ pdfService: { generateBufferFromHtml: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fixture')) } }));
    const storage = (await import('../src/config/storage.config.js')).storageConfig; originalStorage = storage.root; temporaryStorage = await mkdtemp(path.join(os.tmpdir(), 'wave05-storage-')); storage.root = temporaryStorage;
    fixture = new TwoFirmFixture(db); a = await fixture.createTenant('payments-A'); b = await fixture.createTenant('payments-B');
    const { FEATURE_KEYS } = await import('../src/modules/entitlements/feature-registry.js');
    const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const plan = await db.plan.create({ data: { name: 'Wave05 fixture', slug: `wave05-${randomUUID()}`, versions: { create: { revision: 1, createdById: a.admin.id, policy: LEGACY_POLICY, features: { create: FEATURE_KEYS.map((featureKey) => ({ featureKey })) }, quotas: { create: ['users', 'documents', 'storageBytes', 'aiCredits'].map((resource) => ({ resource, limit: null })) } } } }, include: { versions: true } });
    await fixture.publishPlanVersion(plan.versions[0]!.id);
    planId = plan.id; planVersionId = plan.versions[0]!.id;
    for (const tenant of [a, b]) await db.firmSubscription.create({ data: { firmId: tenant.firm.id, planVersionId, status: 'ACTIVE', authorId: tenant.admin.id, reason: 'Disposable payments fixture', effectiveFrom: new Date(Date.now() - 1000) } });
    const { generateAccessToken } = await import('../src/modules/auth/security/auth.tokens.js'); const { ACCESS_TOKEN_COOKIE_NAME } = await import('../src/modules/auth/auth.constants.js');
    for (const actor of [a.admin, a.reader, b.admin]) { const session = await db.authSession.create({ data: { userId: actor.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3600000) } }); cookies.set(actor.id, `${ACCESS_TOKEN_COOKIE_NAME}=${generateAccessToken({ userId: actor.id, role: actor.role, sessionId: session.id })}`); }
    const { app } = await import('../src/bootstrap/app.js'); server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Disposable listener unavailable'); base = `http://127.0.0.1:${address.port}`;
    for (const tenant of [a, b]) await data(await request('PUT', '/billing-settings', { expectedVersion: 0, config: { schemaVersion: 1, registration: 'UNREGISTERED', sellerStateCode: '24', einvoiceRequired: false, prefixes: { INVOICE: 'INV', PROFORMA: 'PF', CREDIT_NOTE: 'CN', DEBIT_NOTE: 'DN' }, template: 'STANDARD', primaryColour: '#168A56', paymentInstructions: 'Fixture', termsAndConditions: '' } }, tenant.admin.id));
    const recurring = await import('../src/modules/billing-schedules/billing-schedules.repository.js'); schedules = recurring.billingSchedulesRepository;
    const { inAppNotificationHandler } = await import('../src/modules/notifications/index.js');
    const { OutboxRepository } = await import('../src/core/outbox/outbox.repository.js'); worker = new OutboxRepository(db, { 'billing.recurring-draft.v1': recurring.recurringDraftHandler, 'notifications.in-app.v1': inAppNotificationHandler });
  }, 60000);
  afterAll(async () => { try { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); if (fixture) await fixture.cleanup(); if (planId) await db.plan.update({ where: { id: planId }, data: { archivedAt: new Date() } }); } finally { if (db) await db.$disconnect(); if (temporaryStorage) { (await import('../src/config/storage.config.js')).storageConfig.root = originalStorage; await rm(temporaryStorage, { recursive: true, force: true }); } vi.doUnmock('../src/core/database/prisma.js'); vi.doUnmock('../src/integrations/mail/index.js'); vi.doUnmock('../src/integrations/pdf/index.js'); vi.unstubAllEnvs(); } }, 60000);

  it('records partial, advance and multi-invoice receipts and reconciles immutable invoice history', async () => {
    const first = await issued(); const second = await issued();
    const before = await db.invoice.findUniqueOrThrow({ where: { id: first.id }, select: { issueSnapshot: true, version: true, grandTotal: true } });
    const row = await payment(a, '175.00', [{ invoiceId: first.id, amount: '100.00' }, { invoiceId: second.id, amount: '50.00' }]);
    expect(row).toMatchObject({ allocated: '150.00', unapplied: '25.00' });
    expect(await settlement(first.id)).toMatchObject({ outstanding: '0.00', settlementStatus: 'PAID' });
    expect(await settlement(second.id)).toMatchObject({ outstanding: '50.00', settlementStatus: 'PARTIAL' });
    expect(await db.invoice.findUniqueOrThrow({ where: { id: first.id }, select: { issueSnapshot: true, version: true, grandTotal: true } })).toEqual(before);
    expect(await db.auditLog.count({ where: { firmId: a.firm.id, entityType: 'CustomerPayment', entityId: String(row.id) } })).toBe(1);
  });
  it('serializes concurrent receipts against the same invoice and rolls back losing receipts', async () => {
    const invoice = await issued();
    const responses = await Promise.all(Array.from({ length: 5 }, () => request('POST', '/payments', receipt(a, '100.00', [{ invoiceId: invoice.id, amount: '100.00' }]))));
    expect(responses.filter((result) => result.status === 201)).toHaveLength(1); expect(responses.filter((result) => result.status === 409)).toHaveLength(4);
    expect(await db.paymentAllocation.count({ where: { invoiceId: invoice.id } })).toBe(1);
    expect((await settlement(invoice.id)).outstanding).toBe('0.00');
  });
  it('serializes allocation races across independent advance receipts', async () => {
    const invoice = await issued(); const receipts = await Promise.all([payment(), payment()]);
    const results = await Promise.all(receipts.map((row) => request('POST', `/payments/${row.id}/allocate`, { idempotencyKey: randomUUID(), allocations: [{ invoiceId: invoice.id, amount: '100.00' }] })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });
  it('deduplicates receipt and allocation requests, and rejects changed payloads', async () => {
    const invoice = await issued(); const input = receipt(a, '60.00');
    const rows = await Promise.all(Array.from({ length: 3 }, () => request('POST', '/payments', input).then((response) => data<{ payment: Payment }>(response, 201))));
    expect(new Set(rows.map((row) => row.payment.id)).size).toBe(1);
    expect((await request('POST', '/payments', { ...input, amount: '61.00' })).status).toBe(409);
    const command = { idempotencyKey: randomUUID(), allocations: [{ invoiceId: invoice.id, amount: '60.00' }] };
    for (let i = 0; i < 2; i++) await data(await request('POST', `/payments/${rows[0]!.payment.id}/allocate`, command));
    expect(await db.paymentAllocation.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });
  it('bounds refunds by unapplied funds and reverses remaining funds exactly once', async () => {
    const invoice = await issued(); const row = await payment(a, '100.00', [{ invoiceId: invoice.id, amount: '60.00' }]);
    const refund = { idempotencyKey: randomUUID(), amount: '20.00', paidDate: indiaToday(), reference: 'REFUND-TEST', reason: 'Confirmed external refund', confirmed: true };
    for (let i = 0; i < 2; i++) await data(await request('POST', `/payments/${row.id}/refunds`, refund), 201);
    expect((await request('POST', `/payments/${row.id}/refunds`, { ...refund, idempotencyKey: randomUUID(), amount: '20.01' })).status).toBe(409);
    const reverse = { idempotencyKey: randomUUID(), reason: 'Receipt correction confirmed' };
    const reversed = (await data<{ payment: Payment }>(await request('POST', `/payments/${row.id}/reverse`, reverse))).payment;
    expect(reversed).toMatchObject({ status: 'REVERSED', unapplied: '0.00', allocated: '0.00', refunded: '20.00', reversal: { amount: '80.00' } });
    await data(await request('POST', `/payments/${row.id}/reverse`, reverse));
    expect((await settlement(invoice.id)).outstanding).toBe('100.00');
    expect(await db.paymentReversal.count({ where: { paymentId: row.id } })).toBe(1);
    expect((await request('POST', `/payments/${row.id}/refunds`, { ...refund, idempotencyKey: randomUUID() })).status).toBe(409);
  });
  it('denies cross-firm/customer/currency nested IDs and forged gateway state', async () => {
    const foreign = await payment(b); const foreignInvoice = await issued(b); const own = await payment();
    for (const path of [`/payments/${foreign.id}`, `/receivables/invoices/${foreignInvoice.id}`, `/payments?companyId=${b.company.id}`, `/receivables/aging?companyId=${b.company.id}`]) expect((await request('GET', path, undefined, a.admin.id, b.firm.id)).status).toBe(404);
    for (const [action, body] of [['allocate', { idempotencyKey: randomUUID(), allocations: [{ invoiceId: foreignInvoice.id, amount: '1.00' }] }], ['reverse', { idempotencyKey: randomUUID(), reason: 'Foreign ID injection' }], ['refunds', { idempotencyKey: randomUUID(), amount: '1.00', paidDate: indiaToday(), reference: 'Foreign', reason: 'Foreign ID injection', confirmed: true }]] as const) expect((await request('POST', `/payments/${foreign.id}/${action}`, body)).status).toBe(404);
    expect((await request('POST', `/payments/${own.id}/allocate`, { idempotencyKey: randomUUID(), allocations: [{ invoiceId: foreignInvoice.id, amount: '1.00' }] })).status).toBe(404);
    const company = await db.company.create({ data: { firmId: a.firm.id, name: 'Other customer', companyCode: `C-${randomUUID()}` } });
    const other = (await data<{ payment: Payment }>(await request('POST', '/payments', { ...receipt(), companyId: company.id }), 201)).payment;
    const invoice = await issued(); expect((await request('POST', `/payments/${other.id}/allocate`, { idempotencyKey: randomUUID(), allocations: [{ invoiceId: invoice.id, amount: '1.00' }] })).status).toBe(409);
    const usd = (await data<{ payment: Payment }>(await request('POST', '/payments', { ...receipt(), currency: 'USD' }), 201)).payment;
    expect((await request('POST', `/payments/${usd.id}/allocate`, { idempotencyKey: randomUUID(), allocations: [{ invoiceId: invoice.id, amount: '1.00' }] })).status).toBe(409);
    for (const extra of [{ status: 'PAID' }, { firmId: b.firm.id }, { method: 'GATEWAY' }, { confirmed: false }]) expect((await request('POST', '/payments', { ...receipt(), ...extra })).status).toBe(400);
    const audit = await data<{ auditLogs: Array<{ firmId: number; entityId: string }> }>(await request('GET', '/audit-logs?entityType=CustomerPayment&limit=100'));
    expect(audit.auditLogs.every((entry) => entry.firmId === a.firm.id)).toBe(true);
    expect(audit.auditLogs.some((entry) => entry.entityId === String(foreign.id))).toBe(false);
  });
  it('keeps currency partitions separate and invoice adjustments within settlement capacity', async () => {
    const invoice = await issued(); await payment(a, '100.00', [{ invoiceId: invoice.id, amount: '100.00' }]);
    expect((await request('POST', `/invoices/${invoice.id}/void`, { expectedVersion: invoice.version, reason: 'Supply cancelled', notReportedAndSupplyCancelled: true })).status).toBe(409);
    const note = (await data<{ document: Document }>(await request('POST', '/billing-adjustments', { sourceInvoiceId: invoice.id, kind: 'CREDIT_NOTE', reason: 'Partial service cancellation', idempotencyKey: randomUUID(), gstReductionEligible: false, annualReturnFiledAt: null, recipientItcReversalConfirmed: false, customFieldValues: {}, lines: [{ sourceLineNumber: 1, quantity: '1', unitRate: '10.00' }] }), 201)).document;
    expect((await request('POST', `/billing-adjustments/${note.id}/issue`, { expectedVersion: note.version, confirmedTotal: note.grandTotal })).status).toBe(409);
    const report = await data<{ customerCredits: Array<{ currency: string; unapplied: string }> }>(await request('GET', `/receivables/aging?companyId=${a.company.id}`));
    expect(report.customerCredits.map((row) => row.currency)).toEqual(expect.arrayContaining(['INR', 'USD']));
  });
  it('rolls receipt and allocations back if required audit persistence fails', async () => {
    const invoice = await issued(); const input = receipt(a, '100.00', [{ invoiceId: invoice.id, amount: '100.00' }]);
    failAuditFor = 'CustomerPayment';
    try { expect((await request('POST', '/payments', input)).status).toBe(500); } finally { failAuditFor = null; }
    expect(await db.customerPayment.count({ where: { firmId: a.firm.id, idempotencyKey: input.idempotencyKey } })).toBe(0);
    expect((await settlement(invoice.id)).allocated).toBe('0.00');
    await data(await request('POST', '/payments', input), 201);
  });
  it('reports outstanding invoices independently in each currency', async () => {
    const { configuration: original } = await data<{ configuration: { version: number; policy: Record<string, unknown> } }>(await request('GET', '/settings/business-policy'));
    const { configuration: changed } = await data<{ configuration: { version: number } }>(await request('PUT', '/settings/business-policy', { expectedVersion: original.version, policy: { ...original.policy, currency: 'USD', inAppNotifications: false } }));
    try {
      const usd = await issued();
      const report = await data<{ buckets: Array<{ currency: string; amount: string }>; receivables: Array<{ id: number; currency: string; outstanding: string }> }>(await request('GET', '/receivables/aging?limit=100'));
      expect(report.buckets.map((row) => row.currency)).toEqual(expect.arrayContaining(['INR', 'USD']));
      expect(report.receivables.find((row) => row.id === usd.id)).toMatchObject({ currency: 'USD', outstanding: '100.00' });
    } finally { await data(await request('PUT', '/settings/business-policy', { expectedVersion: changed.version, policy: original.policy })); }
  });
  it('keeps recording grants independent from refund/reversal authority', async () => {
    await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: ['payments.record'] } });
    try {
      const own = (await data<{ payment: Payment }>(await request('POST', '/payments', receipt(), a.reader.id), 201)).payment;
      await data(await request('GET', `/payments/${own.id}`, undefined, a.reader.id));
      expect((await request('POST', `/payments/${own.id}/reverse`, { idempotencyKey: randomUUID(), reason: 'Denied reversal authority' }, a.reader.id)).status).toBe(403);
      expect((await request('GET', '/billing-schedules', undefined, a.reader.id)).status).toBe(403);
    } finally { await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: ['quotations.view'] } }); }
    const own = await payment();
    await db.platformFeatureSwitch.create({ data: { key: 'payments.manage', hardDisabled: true, authorId: a.admin.id, reason: 'Disposable manage kill' } });
    try { expect((await request('POST', `/payments/${own.id}/reverse`, { idempotencyKey: randomUUID(), reason: 'Denied global override' })).status).toBe(403); } finally { await db.platformFeatureSwitch.delete({ where: { key: 'payments.manage' } }); }
  });
  it('denies independent roles, excluded plans, expired grants, hard kills and suspended firms', async () => {
    const paths = ['/payments', '/receivables/aging', '/billing-schedules'];
    for (const path of paths) expect((await request('GET', path, undefined, a.reader.id)).status).toBe(403);
    const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const excluded = await db.planVersion.create({ data: { planId, revision: 2, createdById: a.admin.id, policy: LEGACY_POLICY, features: { create: ['firm.core', 'companies', 'billing.invoices'].map((featureKey) => ({ featureKey })) } } });
    await fixture.publishPlanVersion(excluded.id);
    const sub = await db.firmSubscription.findFirstOrThrow({ where: { firmId: a.firm.id } });
    await db.firmSubscription.update({ where: { id: sub.id }, data: { planVersionId: excluded.id } });
    try {
      for (const key of ['payments.record', 'payments.manage', 'billing.recurring']) await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: `feature:${key}`, effect: 'ALLOW', authorId: a.admin.id, reason: 'Expired fixture', startsAt: new Date(Date.now() - 20000), expiresAt: new Date(Date.now() - 10000) } });
      for (const path of paths) expect((await request('GET', path)).status).toBe(403);
    } finally { await db.firmFeatureOverride.deleteMany({ where: { firmId: a.firm.id } }); await db.firmSubscription.update({ where: { id: sub.id }, data: { planVersionId } }); }
    for (const [key, path] of [['payments.record', '/payments'], ['billing.recurring', '/billing-schedules']] as const) {
      await db.platformFeatureSwitch.create({ data: { key, hardDisabled: true, authorId: a.admin.id, reason: 'Disposable fixture' } });
      try { expect((await request('GET', path)).status).toBe(403); } finally { await db.platformFeatureSwitch.delete({ where: { key } }); }
    }
    await db.firm.update({ where: { id: a.firm.id }, data: { status: 'SUSPENDED' } });
    try { for (const path of paths) expect((await request('GET', path)).status).toBe(403); } finally { await db.firm.update({ where: { id: a.firm.id }, data: { status: 'ACTIVE' } }); }
  });
  it('generates one draft per approved period under overlapping discovery and replay', async () => {
    const row = await createSchedule(); await approve(row);
    await Promise.all([schedules.dispatchDue(), schedules.dispatchDue()]); await drain();
    const current = await schedule(row.id); expect(current.runs).toHaveLength(1); expect(current.runs[0]).toMatchObject({ status: 'DRAFT_CREATED' });
    const run = current.runs[0]!; const invoice = await db.invoice.findUniqueOrThrow({ where: { id: run.invoiceId! } }); expect(invoice.status).toBe('DRAFT'); expect(invoice.documentNumber).toBeNull();
    await db.outboxEvent.update({ where: { id: run.event!.id }, data: { status: 'PENDING', availableAt: new Date() } }); await drain();
    expect(await db.invoice.count({ where: { firmId: a.firm.id, idempotencyKey: `recurring_run_${run.id}` } })).toBe(1);
    expect((await request('GET', `/billing-schedules/${row.id}`, undefined, b.admin.id)).status).toBe(404);
    await request('POST', `/billing-schedules/${row.id}/cancel`, { expectedVersion: row.version });
  });
  it('retains a failed period and supports a durable explicit retry without duplicates', async () => {
    const row = await createSchedule(); await approve(row); await schedules.dispatchDue();
    failAuditFor = 'BillingDocument'; try { await drain(); } finally { failAuditFor = null; }
    const failed = (await schedule(row.id)).runs[0]!; expect(failed.invoiceId).toBeNull();
    expect(await db.invoice.count({ where: { firmId: a.firm.id, idempotencyKey: `recurring_run_${failed.id}` } })).toBe(0);
    await db.outboxEvent.update({ where: { id: failed.event!.id }, data: { status: 'DEAD' } });
    await data(await request('POST', `/billing-schedules/${row.id}/runs/${failed.id}/retry`, { expectedRetryCount: failed.retryCount })); await drain();
    expect((await schedule(row.id)).runs[0]).toMatchObject({ status: 'DRAFT_CREATED', retryCount: 1 });
    await request('POST', `/billing-schedules/${row.id}/cancel`, { expectedVersion: row.version });
  });
  it('catches up missed periods without skipping or posting historical invoices', async () => {
    const row = await createSchedule();
    const anchor = new Date(`${indiaToday()}T00:00:00Z`); anchor.setUTCDate(1); anchor.setUTCMonth(anchor.getUTCMonth() - 2);
    const version = await db.billingScheduleVersion.findUniqueOrThrow({ where: { scheduleId_firmId_version: { scheduleId: row.id, firmId: a.firm.id, version: 1 } } });
    // Simulate a previously approved schedule whose worker was offline.
    await db.billingScheduleVersion.update({ where: { id: version.id }, data: { config: { ...(version.config as Record<string, Prisma.InputJsonValue>), startDate: anchor.toISOString().slice(0, 10), endDate: indiaToday() } } });
    await db.billingSchedule.update({ where: { id: row.id }, data: { nextPeriod: anchor } });
    await approve(row);
    for (let i = 0; i < 3; i++) { await schedules.dispatchDue(); await drain(); }
    const result = await schedule(row.id); expect(result.runs).toHaveLength(3); expect(new Set(result.runs.map((run) => run.period)).size).toBe(3);
    expect(result.status).toBe('COMPLETED');
    expect(await db.invoice.count({ where: { id: { in: result.runs.map((run) => run.invoiceId!) }, status: 'DRAFT' } })).toBe(3);
  });
  it('preserves old attempts while revising and reapproving an unfinished period', async () => {
    const row = await createSchedule(); await approve(row); await schedules.dispatchDue();
    const old = (await schedule(row.id)).runs[0]!;
    await data(await request('POST', `/billing-schedules/${row.id}/pause`, { expectedVersion: 1 }));
    const source = await createDraft();
    const revised = (await data<{ schedule: Schedule }>(await request('PATCH', `/billing-schedules/${row.id}`, { expectedVersion: 1, sourceDraftId: source.id, dueDays: 15, endDate: null }))).schedule;
    await approve(revised); await schedules.dispatchDue(); await drain();
    const result = await schedule(row.id); expect(result.runs).toHaveLength(1); expect(result.runs[0]).toMatchObject({ id: old.id, status: 'DRAFT_CREATED', retryCount: 1 });
    expect(await db.outboxEvent.count({ where: { firmId: a.firm.id, sourceEventId: `billing-run:${old.id}` } })).toBe(2);
    await request('POST', `/billing-schedules/${row.id}/cancel`, { expectedVersion: 2 });
  });
  it('enforces the existing PDF quota for recurring drafts after ordinary issuance', async () => {
    const row = await createSchedule(); await approve(row); await schedules.dispatchDue(); await drain();
    const generated = (await schedule(row.id)).runs[0]!;
    const invoice = await db.invoice.findUniqueOrThrow({ where: { id: generated.invoiceId! } });
    await data(await request('POST', `/invoices/${invoice.id}/issue`, { expectedVersion: invoice.version, confirmedTotal: invoice.grandTotal.toFixed(2) }));
    const quota = await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: 'quota:documents', effect: 'LIMIT', limit: 0n, startsAt: new Date(Date.now() - 1000), authorId: a.admin.id, reason: 'Disposable recurring PDF quota' } });
    try { expect((await request('POST', `/invoices/${invoice.id}/pdf`, {})).status).toBe(409); expect(await db.invoiceDocument.count({ where: { invoiceId: invoice.id } })).toBe(0); } finally { await db.firmFeatureOverride.delete({ where: { id: quota.id } }); }
    await request('POST', `/billing-schedules/${row.id}/cancel`, { expectedVersion: 1 });
  });
  it('cancels queued work and prevents foreign run injection and revoked-actor output', async () => {
    const row = await createSchedule(); await approve(row); await schedules.dispatchDue(); const run = (await schedule(row.id)).runs[0]!;
    expect((await request('POST', `/billing-schedules/${row.id}/runs/${run.id}/retry`, { expectedRetryCount: 0 }, b.admin.id)).status).toBe(404);
    await data(await request('POST', `/billing-schedules/${row.id}/cancel`, { expectedVersion: row.version })); await drain(); expect((await schedule(row.id)).runs[0]!.invoiceId).toBeNull();
    const revoked = await createSchedule(); await approve(revoked); await schedules.dispatchDue();
    await db.user.update({ where: { id: a.admin.id }, data: { status: 'INACTIVE' } });
    try { await drain(); } finally { await db.user.update({ where: { id: a.admin.id }, data: { status: 'ACTIVE' } }); }
    expect((await schedule(revoked.id)).runs[0]!.invoiceId).toBeNull(); await request('POST', `/billing-schedules/${revoked.id}/cancel`, { expectedVersion: revoked.version });
  });
  it('keeps links non-live and reminders suppressed pending approved policy', async () => {
    expect(await data(await request('GET', '/payments/capabilities'))).toMatchObject({ paymentLinks: { enabled: false }, reminders: { enabled: false } });
    expect((await request('POST', '/payments/webhooks/gateway', { status: 'PAID' })).status).toBe(404);
  });
});
