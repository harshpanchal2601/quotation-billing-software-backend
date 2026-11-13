import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { PrismaClient, type BillingDocumentKind, type InvoiceStatus } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportOverview, ReportSection } from '../src/modules/reports/reports.types.js';
import { TwoFirmFixture, assertDisposableTenantDatabase, type TenantFixture } from './helpers/two-firm-fixture.js';

const url = process.env.WAVE10_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
type View = { id: string; name: string; version: number };
const filters = { dateFrom: '2026-11-01', dateTo: '2026-11-09' };
const outboundWebhook = vi.hoisted(() => vi.fn());
vi.mock('../src/integrations/webhooks/index.js', async (original) => ({ ...(await original<typeof import('../src/integrations/webhooks/index.js')>()), sendWebhook: outboundWebhook }));

suite('Wave 10 authenticated reports on disposable MySQL', () => {
  let db: PrismaClient; let fixture: TwoFirmFixture; let a: TenantFixture; let b: TenantFixture;
  let server: Server; let base: string; let origin: string; let actorId: number; let planId: number; let planVersionId: number;
  let originalStorage: string | undefined; let temporaryStorage: string | undefined;
  const cookies = new Map<number, string>(); let failAudit = false;
  let policyRevision = 100;
  async function sign(actor: { id: number; role: 'ADMIN' }) {
    const { generateAccessToken } = await import('../src/modules/auth/security/auth.tokens.js');
    const { ACCESS_TOKEN_COOKIE_NAME } = await import('../src/modules/auth/auth.constants.js');
    const session = await db.authSession.create({ data: { userId: actor.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3600000) } });
    cookies.set(actor.id, `${ACCESS_TOKEN_COOKIE_NAME}=${generateAccessToken({ userId: actor.id, role: actor.role, sessionId: session.id })}`);
  }
  async function request(method: string, path: string, body?: unknown, actor = actorId) {
    return fetch(`${base}/api/v1${path}`, { method, headers: { Cookie: cookies.get(actor)!, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function data<T>(response: Response, status = 200): Promise<T> {
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json() as { data: T }).data;
  }
  function section(report: ReportOverview, key: ReportSection['key']) {
    const result = report.sections.find((row) => row.key === key);
    if (result?.status !== 'AVAILABLE') throw new Error(`Expected available ${key}`);
    return result.data;
  }
  const endpoint = (sections: string) => `/reports/overview?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}&sections=${sections}`;
  async function invoice(tenant: TenantFixture, currency: string, amount: string, kind: BillingDocumentKind = 'INVOICE', sourceInvoiceId?: number, status: InvoiceStatus = 'ISSUED') {
    return db.invoice.create({ data: {
      firmId: tenant.firm.id, companyId: tenant.company.id, currency, kind, sourceInvoiceId, status,
      invoiceDate: new Date('2026-11-05'), buyerSnapshot: { name: tenant.company.name }, customFieldSchema: {}, customFieldValues: {}, presentationSnapshot: {}, supplySnapshot: {}, financialPolicySnapshot: {},
      subtotal: amount, discountAmount: '0', taxableAmount: amount, taxAmount: '0', roundOffAmount: '0', grandTotal: amount,
      idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64), createdById: tenant.admin.id, updatedById: tenant.admin.id,
    } });
  }
  beforeAll(async () => {
    assertDisposableTenantDatabase(url!, '10');
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', url!); vi.stubEnv('JWT_ACCESS_SECRET', 'wave10-disposable-access-secret'); vi.stubEnv('JWT_REFRESH_SECRET', 'wave10-disposable-refresh-secret'); vi.stubEnv('OUTBOX_WORKER_ENABLED', 'false'); vi.stubEnv('WEBHOOK_ENCRYPTION_KEY', ''); vi.stubEnv('WEBHOOK_ALLOWED_HOSTS', '');
    db = new PrismaClient({ datasources: { db: { url: url! } } }); fixture = new TwoFirmFixture(db);
    const applied = await db.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE migration_name IN ('20261109110000_wave10_source_reporting', '20261109120000_wave10_basic_manufacturing', '20261109130000_wave10_import_lifecycle', '20261109140000_wave10_scoped_integrations', '20261109150000_wave10_accounting_mappings', '20261109160000_wave10_export_jobs') AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(applied).toHaveLength(6);
    db.$use(async (params, next) => {
      if (failAudit && params.model === 'AuditLog' && params.action === 'create' && ['SavedReportView', 'ReportExport', 'ReportExportJob', 'WorkOrder', 'BillOfMaterials', 'ImportBatch', 'ApiKey', 'AccountingMapping', 'AccountingExport'].includes(params.args.data.entityType)) throw new Error('Injected required Wave 10 audit failure');
      return next(params);
    });
    vi.doMock('../src/core/database/prisma.js', () => ({ prisma: db }));
    vi.doMock('../src/integrations/mail/index.js', () => ({ mailService: { send: vi.fn().mockRejectedValue(new Error('External mail disabled')) } }));
    vi.doMock('../src/integrations/documents/index.js', () => ({ renderAndStorePdf: vi.fn().mockRejectedValue(new Error('External rendering disabled')) }));
    const { storageConfig } = await import('../src/config/storage.config.js');
    originalStorage = storageConfig.root;
    temporaryStorage = await mkdtemp(path.join(tmpdir(), 'wave10-storage-'));
    storageConfig.root = temporaryStorage;
    a = await fixture.createTenant('report-A'); b = await fixture.createTenant('report-B');
    const { FEATURE_KEYS } = await import('../src/modules/entitlements/feature-registry.js');
    const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const plan = await db.plan.create({ data: { name: 'Wave10 fixture', slug: `wave10-${randomUUID()}`, versions: { create: { revision: 1, createdById: a.admin.id, policy: LEGACY_POLICY, features: { create: FEATURE_KEYS.map((featureKey) => ({ featureKey })) }, quotas: { create: ['users', 'documents', 'storageBytes', 'aiCredits'].map((resource) => ({ resource, limit: resource === 'documents' ? 0n : null })) } } } }, include: { versions: true } });
    await fixture.publishPlanVersion(plan.versions[0]!.id);
    planId = plan.id; planVersionId = plan.versions[0]!.id;
    for (const tenant of [a, b]) await db.firmSubscription.create({ data: { firmId: tenant.firm.id, planVersionId, status: 'ACTIVE', authorId: tenant.admin.id, reason: 'Disposable report fixture', effectiveFrom: new Date(Date.now() - 1000) } });
    await sign(a.reader); await sign(b.admin);
    origin = new URL((await import('../src/config/env.js')).env.FRONTEND_URL).origin;
    const { app } = await import('../src/bootstrap/app.js'); server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Disposable listener unavailable'); base = `http://127.0.0.1:${address.port}`;
    const source = await invoice(a, 'INR', '100'); await invoice(a, 'INR', '20', 'CREDIT_NOTE', source.id); await invoice(a, 'INR', '5', 'DEBIT_NOTE', source.id);
    await invoice(a, 'USD', '7.25'); await invoice(a, 'INR', '300', 'INVOICE', undefined, 'DRAFT'); await invoice(a, 'INR', '400', 'INVOICE', undefined, 'VOID');
    await invoice(b, 'USD', '8888.88');
    for (const [amount, reversed] of [['30', false], ['10', true]] as const) {
      const payment = await db.customerPayment.create({ data: { firmId: a.firm.id, companyId: a.company.id, currency: 'INR', amount, method: 'BANK_TRANSFER', receivedDate: new Date('2026-11-06'), idempotencyKey: randomUUID(), requestHash: 'b'.repeat(64), createdById: a.admin.id } });
      await db.paymentAllocation.create({ data: { firmId: a.firm.id, companyId: a.company.id, currency: 'INR', paymentId: payment.id, invoiceId: source.id, amount, requestKey: randomUUID(), requestHash: 'c'.repeat(64), createdById: a.admin.id } });
      if (reversed) await db.paymentReversal.create({ data: { firmId: a.firm.id, paymentId: payment.id, amount, reason: 'Fixture reversal', idempotencyKey: randomUUID(), requestHash: 'd'.repeat(64), createdById: a.admin.id } });
    }
    const warehouse = await db.warehouse.create({ data: { firmId: a.firm.id, name: 'Report warehouse', code: 'REPORT' } });
    const position = await db.stockPosition.create({ data: { firmId: a.firm.id, warehouseId: warehouse.id, itemId: a.item.id, currency: 'INR', onHand: '9', value: '90' } });
    for (const [line, quantity, value] of [[1, '10', '100'], [2, '-1', '-10']] as const) await db.stockMovement.create({ data: { firmId: a.firm.id, positionId: position.id, sourceType: 'FIXTURE', sourceId: position.id, sourceLineId: line, eventType: 'ADJUST', quantity, value, reason: 'Report source fixture', actorId: a.admin.id, postedAt: new Date('2026-11-05') } });
    await db.purchaseOrder.create({ data: { firmId: a.firm.id, supplierId: a.company.id, orderNumber: 'REPORT-PO', status: 'PARTIALLY_RECEIVED', currency: 'KWD', supplierSnapshot: {}, financialSnapshot: {}, total: '12.001', idempotencyKey: randomUUID(), requestHash: 'e'.repeat(64), actorId: a.admin.id, createdAt: new Date('2026-11-05') } });
  }, 60000);
  beforeEach(async () => {
    outboundWebhook.mockReset();
    // Each case gets an independent actor rate-limit bucket; fixture records remain shared.
    const actor = await fixture.createActor(a.firm.id, 'FIRM_ADMIN'); actorId = actor.id; await sign(actor);
  });
  afterAll(async () => {
    try {
      if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (fixture) await fixture.cleanup();
      if (planId) await db.plan.update({ where: { id: planId }, data: { archivedAt: new Date() } });
    } finally {
      try { if (db) await db.$disconnect(); }
      finally {
        if (originalStorage !== undefined) (await import('../src/config/storage.config.js')).storageConfig.root = originalStorage;
        vi.doUnmock('../src/core/database/prisma.js'); vi.doUnmock('../src/integrations/mail/index.js'); vi.doUnmock('../src/integrations/documents/index.js'); vi.unstubAllEnvs();
        if (temporaryStorage) await rm(temporaryStorage, { recursive: true, force: true });
      }
    }
  }, 60000);

  it('reconciles sales, adjustments, unreversed allocations, stock and purchases without currency mixing', async () => {
    const report = await data<ReportOverview>(await request('GET', endpoint('sales,receivables,stock,purchaseOrders')));
    expect(section(report, 'sales').metrics).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'netSales', currency: 'INR', value: '85.00' }), expect.objectContaining({ key: 'netSales', currency: 'USD', value: '7.25' })]));
    expect(section(report, 'receivables').metrics.filter((row) => row.key === 'outstanding')).toEqual(expect.arrayContaining([expect.objectContaining({ currency: 'INR', value: '55.00' }), expect.objectContaining({ currency: 'USD', value: '7.25' })]));
    expect(section(report, 'stock').metrics).toContainEqual(expect.objectContaining({ key: 'stockValue', value: '90.000000', currency: 'INR' }));
    expect(section(report, 'purchaseOrders').metrics).toContainEqual(expect.objectContaining({ key: 'amount', value: '12.001', currency: 'KWD' }));
    const other = await data<ReportOverview>(await request('GET', endpoint('sales'), undefined, b.admin.id));
    expect(section(other, 'sales').metrics).toContainEqual(expect.objectContaining({ value: '8888.88', currency: 'USD' }));
    expect(JSON.stringify(report)).not.toContain('8888.88');
    const csv = await request('GET', `/reports/export.csv?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}&sections=sales`);
    expect(csv.status).toBe(200); expect(csv.headers.get('cache-control')).toContain('no-store'); expect(await csv.text()).not.toContain('8888.88');
  });
  it('previews, commits, deduplicates and compensates customer imports without cross-firm access', async () => {
    type Detail = { batch: { id: number; version: number; status: string; successfulRecords: number; failedRecords: number }; rows: Array<{ id: number; status: string; targetId: number; compensatedAt: string | null }> };
    const externalId = `customer-${randomUUID()}`;
    const csv = `externalId,name\n${externalId},Imported customer\n${externalId.toUpperCase()},Duplicate customer\ninvalid key,Rejected customer`;
    const preview = await data<Detail>(await request('POST', '/imports/preview', { target: 'CUSTOMERS', csv }), 201);
    expect(preview.rows.map((row) => row.status)).toEqual(['APPROVED', 'REJECTED', 'REJECTED']);
    expect(preview.batch.failedRecords).toBe(2);
    expect(await db.company.count({ where: { firmId: a.firm.id, name: 'Imported customer' } })).toBe(0);
    expect((await request('GET', `/imports/${preview.batch.id}`, undefined, b.admin.id)).status).toBe(404);
    expect((await request('POST', `/imports/${preview.batch.id}/commit`, { expectedVersion: preview.batch.version }, b.admin.id)).status).toBe(404);
    const concurrent = await Promise.all([request('POST', `/imports/${preview.batch.id}/commit`, { expectedVersion: preview.batch.version }), request('POST', `/imports/${preview.batch.id}/commit`, { expectedVersion: preview.batch.version })]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
    const committed = await data<Detail>(await request('GET', `/imports/${preview.batch.id}`));
    expect(committed.batch).toMatchObject({ status: 'PARTIAL', successfulRecords: 1, failedRecords: 2 });
    expect(await db.company.count({ where: { firmId: a.firm.id, name: 'Imported customer' } })).toBe(1);
    const repeated = await data<Detail>(await request('POST', '/imports/preview', { target: 'CUSTOMERS', csv: `externalId,name\n${externalId},Different customer` }), 201);
    expect(repeated.rows[0]!.status).toBe('REJECTED');
    const row = committed.rows[0]!;
    const compensated = await data<Detail>(await request('POST', `/imports/${committed.batch.id}/rows/${row.id}/compensate`, { expectedVersion: committed.batch.version }));
    expect(compensated.rows[0]!.compensatedAt).toBeTruthy();
    expect(await db.company.findUnique({ where: { id: row.targetId } })).toMatchObject({ firmId: a.firm.id, isActive: false, deletedAt: null });
  });
  it('rejects foreign item references at preview and rolls back import provenance when audit fails', async () => {
    const preview = await data<{ rows: Array<{ status: string }>; batch: { id: number } }>(await request('POST', '/imports/preview', { target: 'ITEMS', csv: `externalId,name,categoryId,measurementUnitId\n${randomUUID()},Foreign item,${b.category.id},${b.unit.id}` }), 201);
    expect(preview.rows[0]!.status).toBe('REJECTED');
    const before = await db.importBatch.count({ where: { firmId: a.firm.id, startedById: actorId } });
    failAudit = true;
    try { expect((await request('POST', '/imports/preview', { target: 'CUSTOMERS', csv: `externalId,name\n${randomUUID()},Audit rollback` })).status).toBe(500); }
    finally { failAudit = false; }
    expect(await db.importBatch.count({ where: { firmId: a.firm.id, startedById: actorId } })).toBe(before);
  });
  it('limits public tokens by scope, fixed firm, issuer rights and immediate revocation', async () => {
    const result = await data<{ key: { id: string }; token: string }>(await request('POST', '/api-keys', { name: 'Read-only fixture', scopes: ['reports.read'], lifetimeDays: 1 }), 201);
    const stored = await db.apiKey.findUniqueOrThrow({ where: { id: result.key.id } });
    expect(stored.tokenHash).not.toBe(result.token); expect(stored.tokenHash).toHaveLength(64);
    const external = (path: string) => fetch(`${base}/api/v1/external/v1${path}`, { headers: { Authorization: `Bearer ${result.token}`, 'x-firm-id': String(b.firm.id) } });
    const report = await data<ReportOverview>(await external(`/reports/overview?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}&sections=sales`));
    expect(report.firmId).toBe(a.firm.id); expect(JSON.stringify(report)).not.toContain('8888.88');
    expect((await external(`/reports/export.csv?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}&sections=sales`)).status).toBe(403);
    expect((await request('POST', `/api-keys/${result.key.id}/revoke`, undefined, b.admin.id)).status).toBe(404);
    const listing = await request('GET', '/api-keys'); expect(await listing.text()).not.toContain(result.token);
    await request('POST', `/api-keys/${result.key.id}/revoke`);
    expect((await external(`/reports/overview?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}&sections=sales`)).status).toBe(401);
  });
  it('refuses compensation after a same-timestamp record edit', async () => {
    type Detail = { batch: { id: number; version: number }; rows: Array<{ id: number; targetId: number }> };
    const preview = await data<Detail>(await request('POST', '/imports/preview', { target: 'CUSTOMERS', csv: `externalId,name\n${randomUUID()},Original imported customer` }), 201);
    const imported = await data<Detail>(await request('POST', `/imports/${preview.batch.id}/commit`, { expectedVersion: preview.batch.version }));
    const row = imported.rows[0]!; const original = await db.company.findUniqueOrThrow({ where: { id: row.targetId } });
    await db.company.update({ where: { id: row.targetId }, data: { name: 'Changed customer', updatedAt: original.updatedAt } });
    expect((await request('POST', `/imports/${imported.batch.id}/rows/${row.id}/compensate`, { expectedVersion: imported.batch.version })).status).toBe(409);
    expect((await db.company.findUniqueOrThrow({ where: { id: row.targetId } })).isActive).toBe(true);
  });
  it('signs stable tenant events, retries with the original signing version and stops disabled deliveries', async () => {
    const { env } = await import('../src/config/env.js');
    const previous = { enabled: env.OUTBOX_WORKER_ENABLED, key: env.WEBHOOK_ENCRYPTION_KEY, hosts: env.WEBHOOK_ALLOWED_HOSTS };
    const { OutboxRepository } = await import('../src/core/outbox/index.js'); const { webhookHandler } = await import('../src/modules/connections/index.js');
    const { signWebhook } = await import('../src/integrations/webhooks/secrets.js');
    env.OUTBOX_WORKER_ENABLED = true; env.WEBHOOK_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64'); env.WEBHOOK_ALLOWED_HOSTS = ['hooks.example.com'];
    let endpointId: string | undefined;
    try {
      const created = await data<{ endpoint: { id: string }; secret: string }>(await request('POST', '/webhooks', { name: 'Fixture destination', url: 'https://hooks.example.com/events' }), 201); endpointId = created.endpoint.id;
      await data(await request('PUT', `/webhooks/${endpointId}`, { enabled: true }));
      expect((await request('GET', `/webhooks/${endpointId}/deliveries`, undefined, b.admin.id)).status).toBe(404);
      expect(await (await request('GET', '/webhooks')).text()).not.toContain(created.secret);
      const exported = await request('GET', `/reports/export.csv?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}&sections=sales`); expect(exported.status).toBe(200);
      const delivery = await db.webhookDelivery.findFirstOrThrow({ where: { firmId: a.firm.id, endpointId }, orderBy: { createdAt: 'desc' } });
      await data(await request('POST', `/webhooks/${endpointId}/rotate`));
      const worker = new OutboxRepository(db, { 'integrations.webhook.v1': webhookHandler });
      outboundWebhook.mockRejectedValueOnce(new Error('Injected private receiver failure')).mockResolvedValue(undefined);
      await db.outboxEvent.update({ where: { id: delivery.outboxEventId }, data: { availableAt: new Date(0) } });
      await worker.runOne('wave10-webhook-fixture');
      expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: delivery.outboxEventId } })).status).toBe('PENDING');
      const [destination, body, headers] = outboundWebhook.mock.calls[0]! as [string, string, Record<string, string>];
      expect(destination).toBe('https://hooks.example.com/events'); expect(JSON.parse(body)).toMatchObject({ firmId: a.firm.id, type: 'report.exported.v1' }); expect(body).not.toContain('8888.88');
      expect(headers['x-bhuminex-secret-version']).toBe('1'); expect(headers['x-bhuminex-signature']).toBe(`v1=${signWebhook(created.secret, Number(headers['x-bhuminex-timestamp']), delivery.id, body)}`);
      await db.outboxEvent.update({ where: { id: delivery.outboxEventId }, data: { availableAt: new Date(0) } }); await worker.runOne('wave10-webhook-fixture');
      expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: delivery.outboxEventId } })).status).toBe('SUCCEEDED');
      expect(outboundWebhook.mock.calls[1]![1]).toBe(body); expect(outboundWebhook.mock.calls[1]![2]['x-bhuminex-delivery']).toBe(delivery.id);
      await request('GET', `/reports/export.csv?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}&sections=sales`);
      const next = await db.webhookDelivery.findFirstOrThrow({ where: { firmId: a.firm.id, endpointId, id: { not: delivery.id } } });
      await data(await request('PUT', `/webhooks/${endpointId}`, { enabled: false }));
      await db.outboxEvent.update({ where: { id: next.outboxEventId }, data: { availableAt: new Date(0) } }); await worker.runOne('wave10-webhook-fixture');
      expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: next.outboxEventId } })).status).toBe('DEAD'); expect(outboundWebhook).toHaveBeenCalledTimes(2);
    } finally {
      if (endpointId) await db.webhookEndpoint.update({ where: { id: endpointId }, data: { enabled: false } });
      env.OUTBOX_WORKER_ENABLED = previous.enabled; env.WEBHOOK_ENCRYPTION_KEY = previous.key; env.WEBHOOK_ALLOWED_HOSTS = previous.hosts;
    }
  });
  it('creates private queued artifacts through the real outbox and releases storage on removal', async () => {
    const { env } = await import('../src/config/env.js'); const enabled = env.OUTBOX_WORKER_ENABLED;
    const { OutboxRepository } = await import('../src/core/outbox/index.js');
    const { reportExportHandler } = await import('../src/modules/reports/index.js');
    let jobId: string | undefined;
    env.OUTBOX_WORKER_ENABLED = true;
    try {
      type Job = { id: string; completedAt: string | null; fileSize: number | null };
      const input = { requestKey: randomUUID(), format: 'csv', filters: { ...filters, sections: ['sales'] } };
      const created = await data<{ job: Job }>(await request('POST', '/exports', input), 202); jobId = created.job.id;
      const repeated = await data<{ job: Job }>(await request('POST', '/exports', input), 202); expect(repeated.job.id).toBe(jobId);
      const pending = await db.reportExportJob.findUniqueOrThrow({ where: { id: jobId } });
      await db.outboxEvent.update({ where: { id: pending.eventId }, data: { availableAt: new Date(0) } });
      const before = await db.usageCounter.findUnique({ where: { firmId_resource: { firmId: a.firm.id, resource: 'storageBytes' } } });
      await new OutboxRepository(db, { 'reports.export.v1': reportExportHandler }).runOne('wave10-export-fixture');
      const generated = await db.reportExportJob.findUniqueOrThrow({ where: { id: jobId } });
      expect(generated.fileHash).toMatch(/^[a-f0-9]{64}$/); expect(generated.completedAt).not.toBeNull();
      const downloaded = await request('GET', `/exports/${jobId}/download`); expect(downloaded.status).toBe(200); expect(await downloaded.text()).not.toContain('8888.88');
      expect((await request('GET', `/exports/${jobId}/download`, undefined, b.admin.id)).status).toBe(404);
      expect((await request('DELETE', `/exports/${jobId}`, undefined, b.admin.id)).status).toBe(404);
      expect((await fetch(`${base}/storage/${generated.filePath}`)).status).toBe(404);
      const stored = await db.usageCounter.findUniqueOrThrow({ where: { firmId_resource: { firmId: a.firm.id, resource: 'storageBytes' } } });
      expect(stored.ready ? stored.used : stored.pendingDelta).toBe((before ? before.ready ? before.used : before.pendingDelta : 0n) + BigInt(generated.fileSize!));
      const { storageService } = await import('../src/integrations/storage/index.js');
      const removal = vi.spyOn(storageService, 'deleteStorageFile').mockRejectedValueOnce(new Error('Injected filesystem removal failure'));
      try { expect((await request('DELETE', `/exports/${jobId}`)).status).toBe(500); }
      finally { removal.mockRestore(); }
      expect(await storageService.fileExists(generated.filePath!)).toBe(true);
      expect((await request('GET', `/exports/${jobId}/download`)).status).toBe(404);
      const released = await db.usageCounter.findUniqueOrThrow({ where: { firmId_resource: { firmId: a.firm.id, resource: 'storageBytes' } } });
      expect(released.ready ? released.used : released.pendingDelta).toBe(before ? before.ready ? before.used : before.pendingDelta : 0n);
      await data(await request('DELETE', `/exports/${jobId}`));
      expect(await storageService.fileExists(generated.filePath!)).toBe(false);
      const repeatedRemoval = await db.usageCounter.findUniqueOrThrow({ where: { firmId_resource: { firmId: a.firm.id, resource: 'storageBytes' } } });
      expect(repeatedRemoval.ready ? repeatedRemoval.used : repeatedRemoval.pendingDelta).toBe(released.ready ? released.used : released.pendingDelta);
      expect(await db.auditLog.count({ where: { firmId: a.firm.id, entityType: 'ReportExportJob', entityId: jobId, action: 'DELETE' } })).toBe(1);
    } finally {
      if (jobId && await db.reportExportJob.findFirst({ where: { id: jobId, deletedAt: null } })) await request('DELETE', `/exports/${jobId}`);
      env.OUTBOX_WORKER_ENABLED = enabled;
    }
  });
  it.each(['quota', 'audit'] as const)('rolls export artifacts and storage usage back on %s failure and retries the same job', async (failure) => {
    const { env } = await import('../src/config/env.js'); const enabled = env.OUTBOX_WORKER_ENABLED;
    const { OutboxRepository } = await import('../src/core/outbox/index.js');
    const { reportExportHandler } = await import('../src/modules/reports/index.js');
    const { reconcileFirmUsage, withFirmEntitlementTransaction } = await import('../src/modules/entitlements/index.js');
    const { storageService } = await import('../src/integrations/storage/index.js');
    let jobId: string | undefined; let overrideId: number | undefined;
    env.OUTBOX_WORKER_ENABLED = true;
    try {
      await withFirmEntitlementTransaction(db, a.firm.id, (tx) => reconcileFirmUsage(tx, a.firm.id));
      const before = await db.usageCounter.findUniqueOrThrow({ where: { firmId_resource: { firmId: a.firm.id, resource: 'storageBytes' } } });
      if (failure === 'quota') {
        const limit = await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, authorId: actorId, target: 'quota:storageBytes', effect: 'LIMIT', limit: before.used, startsAt: new Date(Date.now() - 1000), reason: 'Disposable export quota failure fixture' } });
        overrideId = limit.id;
      }
      const created = await data<{ job: { id: string } }>(await request('POST', '/exports', { requestKey: randomUUID(), format: 'csv', filters: { ...filters, sections: ['sales'] } }), 202);
      jobId = created.job.id;
      const pending = await db.reportExportJob.findUniqueOrThrow({ where: { id: jobId } });
      await db.outboxEvent.update({ where: { id: pending.eventId }, data: { availableAt: new Date(0) } });
      failAudit = failure === 'audit';
      const worker = new OutboxRepository(db, { 'reports.export.v1': reportExportHandler });
      await worker.runOne('wave10-export-failure-fixture');
      failAudit = false;
      expect(await db.reportExportJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ filePath: null, fileHash: null, fileSize: null, completedAt: null });
      expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: pending.eventId } })).status).toBe('PENDING');
      expect(await readdir(storageService.resolveStoragePath(`report-exports/${a.firm.id}/${jobId}`))).toEqual([]);
      const unchanged = await db.usageCounter.findUniqueOrThrow({ where: { firmId_resource: { firmId: a.firm.id, resource: 'storageBytes' } } });
      expect(unchanged.used).toBe(before.used);
      expect(await db.usageEvent.count({ where: { firmId: a.firm.id, resource: 'storageBytes', eventId: `report-export:${jobId}` } })).toBe(0);
      expect((await request('GET', `/exports/${jobId}/download`)).status).toBe(409);
      if (overrideId !== undefined) { await db.firmFeatureOverride.delete({ where: { id: overrideId } }); overrideId = undefined; }
      await db.outboxEvent.update({ where: { id: pending.eventId }, data: { availableAt: new Date(0) } });
      await worker.runOne('wave10-export-recovery-fixture');
      expect((await db.reportExportJob.findUniqueOrThrow({ where: { id: jobId } })).completedAt).not.toBeNull();
      expect(await db.usageEvent.count({ where: { firmId: a.firm.id, resource: 'storageBytes', eventId: `report-export:${jobId}` } })).toBe(1);
    } finally {
      failAudit = false;
      if (overrideId !== undefined) await db.firmFeatureOverride.delete({ where: { id: overrideId } });
      if (jobId) await request('DELETE', `/exports/${jobId}`);
      env.OUTBOX_WORKER_ENABLED = enabled;
    }
  });
  it.each([
    ['imports', '/imports'], ['integrations.api', '/api-keys'], ['integrations.webhooks', '/webhooks'], ['accounting.exports', '/accounting-exports/mapping'], ['reports.exports', '/exports'],
  ] as const)('enforces role, hard-off, expiry and suspension for %s', async (feature, path) => {
    await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: [] } });
    expect((await request('GET', path, undefined, a.reader.id)).status).toBe(403);
    const previous = await db.platformFeatureSwitch.findUnique({ where: { key: feature } });
    await db.platformFeatureSwitch.upsert({ where: { key: feature }, create: { key: feature, hardDisabled: true, authorId: a.admin.id, reason: 'Disposable Wave10 feature hard-off' }, update: { hardDisabled: true } });
    try { expect((await request('GET', path)).status).toBe(403); }
    finally { if (previous) await db.platformFeatureSwitch.update({ where: { key: feature }, data: { hardDisabled: previous.hardDisabled } }); else await db.platformFeatureSwitch.delete({ where: { key: feature } }); }
    await db.firm.update({ where: { id: a.firm.id }, data: { status: 'SUSPENDED' } });
    try { expect((await request('GET', path)).status).toBe(403); }
    finally { await db.firm.update({ where: { id: a.firm.id }, data: { status: 'ACTIVE' } }); }
    expect((await request('GET', path)).status).toBe(200);
    const { FEATURE_KEYS } = await import('../src/modules/entitlements/feature-registry.js');
    const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const denied = await db.planVersion.create({ data: { planId, revision: policyRevision++, createdById: a.admin.id, policy: LEGACY_POLICY, features: { create: FEATURE_KEYS.filter((key) => key !== feature).map((featureKey) => ({ featureKey })) } } });
    await fixture.publishPlanVersion(denied.id);
    const subscription = await db.firmSubscription.findFirstOrThrow({ where: { firmId: a.firm.id } });
    await db.firmSubscription.update({ where: { id: subscription.id }, data: { planVersionId: denied.id } });
    const grant = await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: `feature:${feature}`, effect: 'ALLOW', authorId: a.admin.id, reason: 'Disposable Wave10 expiry matrix', startsAt: new Date(Date.now() - 10000), expiresAt: new Date(Date.now() - 1000) } });
    try {
      expect((await request('GET', path)).status).toBe(403);
      await db.firmFeatureOverride.update({ where: { id: grant.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
      expect((await request('GET', path)).status).toBe(200);
      await db.firmFeatureOverride.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
      expect((await request('GET', path)).status).toBe(403);
    } finally {
      await db.firmFeatureOverride.delete({ where: { id: grant.id } });
      await db.firmSubscription.update({ where: { id: subscription.id }, data: { planVersionId } });
    }
  });
  it('separates report access from source access and export permission', async () => {
    await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: ['reports.view'] } });
    const report = await data<ReportOverview>(await request('GET', endpoint('sales'), undefined, a.reader.id));
    expect(report.sections).toEqual([{ key: 'sales', status: 'UNAVAILABLE' }]);
    expect((await request('GET', `/reports/export.csv?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}`, undefined, a.reader.id)).status).toBe(403);
    await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: [] } });
    expect((await request('GET', endpoint('sales'), undefined, a.reader.id)).status).toBe(403);
  });
  it('keeps saved views private across firms and actors, including direct-ID probes', async () => {
    const foreign = (await data<{ view: View }>(await request('POST', '/reports/saved-views', { name: `Foreign ${randomUUID()}`, filters }, b.admin.id), 201)).view;
    const local = (await data<{ view: View }>(await request('POST', '/reports/saved-views', { name: 'Local', filters }), 201)).view;
    const listed = await data<{ views: View[]; pagination: { total: number } }>(await request('GET', '/reports/saved-views'));
    expect(listed.views.map((row) => row.id)).toEqual([local.id]); expect(listed.pagination.total).toBe(1);
    for (const method of ['PUT', 'DELETE']) {
      const body = method === 'PUT' ? { name: 'Probed', filters, expectedVersion: 1 } : { expectedVersion: 1 };
      expect((await request(method, `/reports/saved-views/${foreign.id}`, body)).status).toBe(404);
      expect((await request(method, `/reports/saved-views/${local.id}`, body, b.admin.id)).status).toBe(404);
    }
    expect((await request('GET', `${endpoint('sales')}&firmId=${b.firm.id}`)).status).toBe(400);
    expect(await db.auditLog.count({ where: { firmId: a.firm.id, entityType: 'SavedReportView', entityId: foreign.id } })).toBe(0);
  });
  it('serializes stale saved-view writes and rolls back metadata when required audit fails', async () => {
    const row = (await data<{ view: View }>(await request('POST', '/reports/saved-views', { name: 'Concurrent', filters }), 201)).view;
    const results = await Promise.all(['First', 'Second'].map((name) => request('PUT', `/reports/saved-views/${row.id}`, { name, filters, expectedVersion: 1 })));
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await db.savedReportView.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(2);
    failAudit = true;
    try {
      expect((await request('POST', '/reports/saved-views', { name: 'Rolled back', filters })).status).toBe(500);
      expect(await db.savedReportView.count({ where: { firmId: a.firm.id, actorId, name: 'Rolled back' } })).toBe(0);
      expect((await request('GET', `/reports/export.csv?dateFrom=${filters.dateFrom}&dateTo=${filters.dateTo}&sections=sales`)).status).toBe(500);
    } finally { failAudit = false; }
  });
  it('denies hard-off and suspended firms while preserving reads at exhausted document capacity', async () => {
    const previous = await db.platformFeatureSwitch.findUnique({ where: { key: 'reports' } });
    await db.platformFeatureSwitch.upsert({ where: { key: 'reports' }, create: { key: 'reports', hardDisabled: true, authorId: a.admin.id, reason: 'Disposable report hard-off fixture' }, update: { hardDisabled: true } });
    try { expect((await request('GET', endpoint('sales'))).status).toBe(403); }
    finally { if (previous) await db.platformFeatureSwitch.update({ where: { key: 'reports' }, data: { hardDisabled: previous.hardDisabled } }); else await db.platformFeatureSwitch.delete({ where: { key: 'reports' } }); }
    await db.firm.update({ where: { id: a.firm.id }, data: { status: 'SUSPENDED' } });
    try { expect((await request('GET', endpoint('sales'))).status).toBe(403); }
    finally { await db.firm.update({ where: { id: a.firm.id }, data: { status: 'ACTIVE' } }); }
    const before = await db.usageEvent.count({ where: { firmId: a.firm.id } });
    expect((await request('GET', endpoint('sales'))).status).toBe(200);
    expect(await db.usageEvent.count({ where: { firmId: a.firm.id } })).toBe(before);
  });
  it('enforces a request budget per actor and firm', async () => {
    for (let index = 0; index < 30; index++) expect((await request('GET', '/reports/saved-views')).status).toBe(200);
    const blocked = await request('GET', '/reports/saved-views'); expect(blocked.status).toBe(429); expect(blocked.headers.has('ratelimit-limit')).toBe(true);
    expect((await request('GET', '/reports/saved-views', undefined, b.admin.id)).status).toBe(200);
  });
  it('honors missing-plan access, expired grants and immediate revocation', async () => {
    const { FEATURE_KEYS } = await import('../src/modules/entitlements/feature-registry.js');
    const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const version = await db.planVersion.create({ data: { planId, revision: 2, createdById: a.admin.id, policy: LEGACY_POLICY,
      features: { create: FEATURE_KEYS.filter((key) => key !== 'reports' && key !== 'reports.exports').map((featureKey) => ({ featureKey })) },
    } });
    await fixture.publishPlanVersion(version.id);
    const subscription = await db.firmSubscription.findFirstOrThrow({ where: { firmId: a.firm.id } });
    await db.firmSubscription.update({ where: { id: subscription.id }, data: { planVersionId: version.id } });
    const grant = await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: 'feature:reports', effect: 'ALLOW', startsAt: new Date(Date.now() - 10000), expiresAt: new Date(Date.now() - 1000), authorId: a.admin.id, reason: 'Disposable expired report grant' } });
    try {
      expect((await request('GET', endpoint('sales'))).status).toBe(403);
      await db.firmFeatureOverride.update({ where: { id: grant.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
      expect((await request('GET', endpoint('sales'))).status).toBe(200);
      await db.firmFeatureOverride.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
      expect((await request('GET', endpoint('sales'))).status).toBe(403);
    } finally {
      await db.firmSubscription.update({ where: { id: subscription.id }, data: { planVersionId } });
      await db.firmFeatureOverride.delete({ where: { id: grant.id } });
    }
  });

  async function production(tenant = a) {
    const actor = tenant.firm.id === a.firm.id ? actorId : tenant.admin.id;
    const makeItem = (name: string) => db.item.create({ data: { firmId: tenant.firm.id, itemCode: randomUUID(), name, categoryId: tenant.category.id, measurementUnitId: tenant.unit.id, kind: 'GOODS', stockTracking: true } });
    const output = await makeItem(`Finished ${randomUUID()}`); const component = await makeItem(`Component ${randomUUID()}`);
    const warehouse = await db.warehouse.create({ data: { firmId: tenant.firm.id, name: 'Production warehouse', code: randomUUID() } });
    await data(await request('POST', '/stock/adjustments', { itemId: component.id, warehouseId: warehouse.id, direction: 'IN', quantity: '10', unitCost: '2.001', reason: 'Opening production component stock', idempotencyKey: randomUUID() }, actor), 201);
    const bomInput = { code: `BOM-${randomUUID()}`, name: 'Fixture assembly', outputItemId: output.id, outputQuantity: '1', components: [{ itemId: component.id, quantity: '1.001' }], idempotencyKey: randomUUID() };
    const bom = (await data<{ bom: { id: number; revision: number } }>(await request('POST', '/manufacturing/boms', bomInput, actor), 201)).bom;
    const input = { bomId: bom.id, warehouseId: warehouse.id, quantity: '2', idempotencyKey: randomUUID() };
    const order = (await data<{ order: { id: number; version: number; status: string } }>(await request('POST', '/manufacturing/work-orders', input, actor), 201)).order;
    return { bom, bomInput, input, order, component, output, warehouse, actor };
  }
  it('conserves actual component value through production, identical concurrent retries and cancellation', async () => {
    const row = await production(); const command = { expectedVersion: row.order.version, idempotencyKey: randomUUID(), reason: 'Complete approved fixture production' };
    const results = await Promise.all([request('POST', `/manufacturing/work-orders/${row.order.id}/complete`, command), request('POST', `/manufacturing/work-orders/${row.order.id}/complete`, command)]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect(await db.stockMovement.count({ where: { firmId: a.firm.id, workOrderId: row.order.id } })).toBe(2);
    const output = await db.stockPosition.findUniqueOrThrow({ where: { firmId_warehouseId_itemId: { firmId: a.firm.id, warehouseId: row.warehouse.id, itemId: row.output.id } } });
    expect(output.onHand.toFixed(3)).toBe('2.000'); expect(output.value.toFixed(6)).toBe('4.006002');
    const sum = await db.stockMovement.aggregate({ where: { firmId: a.firm.id, workOrderId: row.order.id }, _sum: { value: true } }); expect(sum._sum.value?.isZero()).toBe(true);
    const updated = (await data<{ order: { version: number } }>(await request('GET', `/manufacturing/work-orders/${row.order.id}`))).order;
    const cancel = { expectedVersion: updated.version, idempotencyKey: randomUUID(), reason: 'Cancel fixture production at original value' };
    await data(await request('POST', `/manufacturing/work-orders/${row.order.id}/cancel`, cancel));
    await data(await request('POST', `/manufacturing/work-orders/${row.order.id}/cancel`, cancel));
    const positions = await db.stockPosition.findMany({ where: { firmId: a.firm.id, warehouseId: row.warehouse.id } });
    expect(positions.find((position) => position.itemId === row.output.id)?.onHand.isZero()).toBe(true);
    expect(positions.find((position) => position.itemId === row.component.id)?.value.toFixed(6)).toBe('20.010000');
    expect(await db.stockMovement.count({ where: { firmId: a.firm.id, workOrderId: row.order.id } })).toBe(4);
  });
  it('rolls back all production movements on required audit failure, then permits the same retry', async () => {
    const row = await production(); const command = { expectedVersion: 1, idempotencyKey: randomUUID(), reason: 'Audited production completion' };
    failAudit = true;
    try {
      expect((await request('POST', `/manufacturing/work-orders/${row.order.id}/complete`, command)).status).toBe(500);
      expect(await db.stockMovement.count({ where: { firmId: a.firm.id, workOrderId: row.order.id } })).toBe(0);
      expect((await db.workOrder.findUniqueOrThrow({ where: { id: row.order.id } })).status).toBe('DRAFT');
      expect((await db.stockPosition.findUniqueOrThrow({ where: { firmId_warehouseId_itemId: { firmId: a.firm.id, warehouseId: row.warehouse.id, itemId: row.component.id } } })).onHand.toFixed(3)).toBe('10.000');
    } finally { failAudit = false; }
    await data(await request('POST', `/manufacturing/work-orders/${row.order.id}/complete`, command));
  });
  it('prevents cancellation after output consumption without restoring components twice', async () => {
    const row = await production();
    const completed = (await data<{ order: { version: number } }>(await request('POST', `/manufacturing/work-orders/${row.order.id}/complete`, { expectedVersion: 1, idempotencyKey: randomUUID(), reason: 'Complete fixture production' }))).order;
    await data(await request('POST', '/stock/adjustments', { itemId: row.output.id, warehouseId: row.warehouse.id, direction: 'OUT', quantity: '1', reason: 'Consume finished goods before cancellation', idempotencyKey: randomUUID() }), 201);
    expect((await request('POST', `/manufacturing/work-orders/${row.order.id}/cancel`, { expectedVersion: completed.version, idempotencyKey: randomUUID(), reason: 'Attempt cancellation after consumption' })).status).toBe(409);
    expect(await db.stockMovement.count({ where: { firmId: a.firm.id, workOrderId: row.order.id } })).toBe(2);
    expect((await db.workOrder.findUniqueOrThrow({ where: { id: row.order.id } })).status).toBe('COMPLETED');
  });
  it('rejects foreign BOM, warehouse, component and work-order IDs at each integration point', async () => {
    const own = await production(); const foreign = await production(b);
    expect((await request('POST', '/manufacturing/boms', { ...own.bomInput, idempotencyKey: randomUUID(), components: [{ itemId: foreign.component.id, quantity: '1' }] })).status).toBe(404);
    expect((await request('POST', '/manufacturing/work-orders', { ...own.input, idempotencyKey: randomUUID(), bomId: foreign.bom.id })).status).toBe(404);
    expect((await request('POST', '/manufacturing/work-orders', { ...own.input, idempotencyKey: randomUUID(), warehouseId: foreign.warehouse.id })).status).toBe(404);
    expect((await request('GET', `/manufacturing/work-orders/${foreign.order.id}`)).status).toBe(404);
    expect((await request('POST', `/manufacturing/work-orders/${foreign.order.id}/complete`, { expectedVersion: 1, idempotencyKey: randomUUID(), reason: 'Foreign work order probe' })).status).toBe(404);
    const listed = await data<{ records: Array<{ id: number }> }>(await request('GET', '/manufacturing/work-orders'));
    expect(listed.records.some((order) => order.id === foreign.order.id)).toBe(false);
    expect(await db.stockMovement.count({ where: { firmId: a.firm.id, workOrderId: foreign.order.id } })).toBe(0);
  });
  it('separates manufacturing viewing, planning, posting and plan availability', async () => {
    await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: ['manufacturing.view', 'inventory.view'] } });
    await data(await request('GET', '/manufacturing/boms', undefined, a.reader.id));
    expect((await request('POST', '/manufacturing/boms', {}, a.reader.id)).status).toBe(403);
    expect((await request('POST', '/manufacturing/work-orders/1/complete', {}, a.reader.id)).status).toBe(403);
    const denial = await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: 'feature:manufacturing', effect: 'DENY', startsAt: new Date(Date.now() - 1000), authorId: a.admin.id, reason: 'Disposable manufacturing denial' } });
    try { expect((await request('GET', '/manufacturing/boms')).status).toBe(403); }
    finally { await db.firmFeatureOverride.delete({ where: { id: denial.id } }); }
  });
});
