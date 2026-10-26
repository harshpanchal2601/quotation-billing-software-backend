import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AccountType, Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertDisposableTenantDatabase, expectDenied, TwoFirmFixture, type TenantFixture } from './helpers/two-firm-fixture.js';
import { FEATURE_KEYS, FEATURE_REGISTRY } from '../src/modules/entitlements/feature-registry.js';
import { evaluateFeature } from '../src/modules/entitlements/entitlement-evaluator.js';
import { LEGACY_POLICY } from '../src/modules/entitlements/entitlements.schema.js';
import type { PlanVersionInput, SubscriptionAssignmentInput } from '../src/modules/platform/platform-subscriptions.schema.js';

const testUrl = process.env.WAVE02_TEST_DATABASE_URL;
const databaseSuite = testUrl ? describe : describe.skip;
const reason = 'Disposable Wave02 regression fixture';
const baselineFeatures = FEATURE_KEYS.filter((key) => FEATURE_REGISTRY[key].legacy);

databaseSuite('platform entitlements against disposable MySQL', () => {
  let db: PrismaClient;
  let fixture: TwoFirmFixture;
  let a: TenantFixture;
  let b: TenantFixture;
  let platformId: number;
  let baseUrl: string;
  let server: Server;
  let temporaryStorage: string;
  let originalStorage: string;
  let baselineVersion: number;
  const cookies = new Map<number, string>();

  async function request(method: string, route: string, actorId = platformId, body?: unknown, selectedFirm?: number) {
    return fetch(`${baseUrl}/api/v1${route}`, { method, headers: {
      Cookie: cookies.get(actorId)!, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(selectedFirm === undefined ? {} : { 'x-firm-id': String(selectedFirm) }),
    }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function data<T>(response: Response, status = 200): Promise<T> {
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json() as { data: T }).data;
  }
  async function published(features = baselineFeatures, quotas: PlanVersionInput['quotas'] = { users: '4', documents: null, storageBytes: null, aiCredits: '0' }) {
    const plan = await data<{ id: number }>(await request('POST', '/platform/plans', platformId, { name: 'Fixture plan', slug: `fixture-${randomUUID()}`, reason }), 201);
    const version = await data<{ versionId: number }>(await request('POST', `/platform/plans/${plan.id}/versions`, platformId, { features, quotas, policy: { ...LEGACY_POLICY, trialDays: 7, graceDays: 3 }, price: '10.10', currency: 'USD', reason }), 201);
    await data(await publishVersion(plan.id, version.versionId));
    return { planId: plan.id, id: version.versionId };
  }
  async function publishVersion(planId: number, versionId: number) {
    const preview = await data<{ previewToken: string }>(await request('GET', `/platform/plans/${planId}/versions/${versionId}/preview`));
    return request('POST', `/platform/plans/${planId}/versions/${versionId}/publish`, platformId, { reason, previewToken: preview.previewToken });
  }
  async function assignment(tenant: TenantFixture, versionId: number, update: Partial<SubscriptionAssignmentInput> = {}) {
    const current = await db.firmSubscription.findFirst({ where: { firmId: tenant.firm.id, effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' } });
    return { planVersionId: versionId, expectedSubscriptionId: current?.id ?? null,
      status: 'ACTIVE', effectiveFrom: new Date(), effectiveUntil: null, trialEndsAt: null,
      graceEndsAt: null, currentPeriodEndsAt: null, renewalAt: null, reason, ...update } satisfies SubscriptionAssignmentInput;
  }
  async function assign(tenant: TenantFixture, versionId: number, update: Partial<SubscriptionAssignmentInput> = {}) {
    const input = await assignment(tenant, versionId, update);
    return data<{ id: number }>(await request('PUT', `/platform/firms/${tenant.firm.id}/subscription`, platformId, input));
  }

  beforeAll(async () => {
    assertDisposableTenantDatabase(testUrl!, '02');
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', testUrl!);
    vi.stubEnv('JWT_ACCESS_SECRET', 'wave02-disposable-access-secret'); vi.stubEnv('JWT_REFRESH_SECRET', 'wave02-disposable-refresh-secret');
    vi.stubEnv('BCRYPT_SALT_ROUNDS', '10'); vi.stubEnv('JWT_ACCESS_EXPIRES_IN', '1h');
    db = new PrismaClient({ datasources: { db: { url: testUrl } } });
    const migrations = await db.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE migration_name IN ('20261022090000_wave01_identity_boundaries', '20261026090000_wave02_platform_entitlements') AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(migrations).toHaveLength(2);
    vi.doMock('../src/core/database/prisma.js', () => ({ prisma: db }));
    vi.doMock('../src/integrations/mail/index.js', () => ({ mailService: { send: vi.fn().mockRejectedValue(new Error('External mail is disabled')) } }));
    vi.doMock('../src/integrations/pdf/index.js', () => ({ pdfService: { generateBufferFromHtml: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4\nfixture')) } }));
    const { storageConfig } = await import('../src/config/storage.config.js');
    originalStorage = storageConfig.root;
    temporaryStorage = await mkdtemp(path.join(os.tmpdir(), 'wave02-storage-'));
    storageConfig.root = temporaryStorage;
    fixture = new TwoFirmFixture(db, { platformLedger: true });
    a = await fixture.createTenant('Wave02 A'); b = await fixture.createTenant('Wave02 B');
    const platform = await fixture.createActor(null, AccountType.SUPER_ADMIN); platformId = platform.id;
    const { initializeLegacySubscription } = await import('../src/modules/entitlements/index.js');
    for (const tenant of [a, b]) await db.$transaction((tx) => initializeLegacySubscription(tx, tenant.firm.id, platformId));
    const { generateAccessToken } = await import('../src/modules/auth/security/auth.tokens.js');
    const { ACCESS_TOKEN_COOKIE_NAME } = await import('../src/modules/auth/auth.constants.js');
    for (const actor of [platform, a.admin, a.reader, b.admin]) {
      const session = await db.authSession.create({ data: { userId: actor.id, refreshTokenHash: 'fixture', expiresAt: new Date(Date.now() + 3_600_000) } });
      cookies.set(actor.id, `${ACCESS_TOKEN_COOKIE_NAME}=${generateAccessToken({ userId: actor.id, role: actor.role, sessionId: session.id })}`);
    }
    const { app } = await import('../src/bootstrap/app.js');
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing disposable listener');
    baseUrl = `http://127.0.0.1:${address.port}`;
    baselineVersion = (await published()).id;
  }, 60_000);

  afterAll(async () => {
    try {
      if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (fixture) await fixture.cleanup();
    } finally {
      if (db) await db.$disconnect();
      if (temporaryStorage) { const { storageConfig } = await import('../src/config/storage.config.js'); storageConfig.root = originalStorage; await rm(temporaryStorage, { recursive: true, force: true }); }
      vi.doUnmock('../src/core/database/prisma.js'); vi.doUnmock('../src/integrations/mail/index.js'); vi.doUnmock('../src/integrations/pdf/index.js'); vi.unstubAllEnvs();
    }
  }, 60_000);

  it('preserves baseline access and ignores tenant attempts to select another firm', async () => {
    const access = await data<{ firmId: number; quotas: Array<{ resource: string; limit: string }> }>(await request('GET', `/entitlements/me?firmId=${b.firm.id}`, a.admin.id, undefined, b.firm.id));
    expect(access.firmId).toBe(a.firm.id);
    expect(access.quotas.find((quota) => quota.resource === 'users')?.limit).toBe('4');
    await data(await request('GET', '/companies', a.admin.id));
    for (const route of ['/platform/plans', '/platform/features', `/platform/firms/${b.firm.id}/subscription`, `/platform/firms/${b.firm.id}/overrides`, `/platform/usage?firmId=${b.firm.id}`, `/platform/firms/${b.firm.id}/usage/events`, `/platform/audit?firmId=${b.firm.id}`]) await expectDenied(await request('GET', route, a.admin.id), 403);
    await expectDenied(await request('PUT', `/platform/firms/${b.firm.id}/subscription`, a.admin.id, {}), 403);
    await expectDenied(await request('POST', `/platform/firms/${b.firm.id}/overrides`, a.admin.id, {}), 403);
  });

  it('denies excluded features, independent RBAC, global kills, and suspended firms', async () => {
    const narrow = await published(['firm.core', 'dashboard']);
    await assign(a, narrow.id);
    await expectDenied(await request('GET', '/items', a.admin.id), 403);
    await data(await request('GET', '/dashboard/overview', a.admin.id));
    await expectDenied(await request('GET', '/dashboard/overview', a.reader.id), 403);
    const exception = await data<{ id: number }>(await request('POST', `/platform/firms/${a.firm.id}/overrides`, platformId, { target: 'feature:dashboard', effect: 'ALLOW', limit: null, startsAt: new Date(), expiresAt: null, reason }), 201);
    try {
      await data(await request('PATCH', '/platform/features/dashboard', platformId, { hardDisabled: true, reason }));
      await expectDenied(await request('GET', '/dashboard/overview', a.admin.id), 403);
      await expectDenied(await request('DELETE', `/platform/firms/${b.firm.id}/overrides/${exception.id}`, platformId, { reason }), 404);
    } finally {
      await data(await request('PATCH', '/platform/features/dashboard', platformId, { hardDisabled: false, reason }));
      await data(await request('DELETE', `/platform/firms/${a.firm.id}/overrides/${exception.id}`, platformId, { reason }));
    }
    await db.firm.update({ where: { id: a.firm.id }, data: { status: 'SUSPENDED' } });
    try { await expectDenied(await request('GET', '/dashboard/overview', a.admin.id), 403); }
    finally { await db.firm.update({ where: { id: a.firm.id }, data: { status: 'ACTIVE' } }); }
  });

  it('serializes concurrent user creation against one remaining seat', async () => {
    const limited = await published(baselineFeatures, { users: '3', documents: null, storageBytes: null, aiCredits: '0' });
    await assign(a, limited.id);
    const results = await Promise.all(Array.from({ length: 5 }, () => {
      const unique = randomUUID(); return request('POST', '/administration/users', a.admin.id, { name: 'Quota actor', email: `${unique}@example.invalid`, username: unique, roleId: a.role.id, temporaryPassword: 'FixturePassword123!' });
    }));
    expect(results.filter((result) => result.status === 201)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(4);
    expect(await db.user.count({ where: { firmId: a.firm.id, deletedAt: null } })).toBe(3);
    expect((await db.usageCounter.findUniqueOrThrow({ where: { firmId_resource: { firmId: a.firm.id, resource: 'users' } } })).used).toBe(3n);
  });

  it('normalizes future/expired overrides and subscription suspension without reviving older grants', async () => {
    const core = await published(['firm.core']);
    await assign(a, core.id);
    const { loadEntitlements } = await import('../src/modules/entitlements/index.js');
    const end = new Date(Date.now() + 3_600_000);
    await data(await request('POST', `/platform/firms/${a.firm.id}/overrides`, platformId, { target: 'feature:dashboard', effect: 'ALLOW', limit: null, startsAt: new Date(), expiresAt: end, reason }), 201);
    await data(await request('GET', '/dashboard/overview', a.admin.id));
    expect(evaluateFeature((await loadEntitlements(db, a.firm.id, end)).context, 'dashboard').allowed).toBe(false);
    const future = await data<{ id: number }>(await request('POST', `/platform/firms/${a.firm.id}/overrides`, platformId, { target: 'feature:dashboard', effect: 'DENY', limit: null, startsAt: new Date(Date.now() + 60_000), expiresAt: null, reason }), 201);
    await data(await request('GET', '/dashboard/overview', a.admin.id));
    await data(await request('DELETE', `/platform/firms/${a.firm.id}/overrides/${future.id}`, platformId, { reason }));
    expect(evaluateFeature((await loadEntitlements(db, a.firm.id, end)).context, 'dashboard').allowed).toBe(false);
    await assign(a, core.id, { status: 'SUSPENDED' });
    await expectDenied(await request('GET', '/settings/business-profile', a.admin.id), 403);
    await assign(a, core.id);
  });

  it('accounts idempotently and rolls back usage on resource failure', async () => {
    const ai = await published([...baselineFeatures, 'ai.credits'], { users: '4', documents: null, storageBytes: null, aiCredits: '10' });
    await assign(a, ai.id);
    const { recordUsage, withFirmEntitlementTransaction } = await import('../src/modules/entitlements/index.js');
    const eventId = `fixture:${randomUUID()}`;
    expect(await withFirmEntitlementTransaction(db, a.firm.id, (tx) => recordUsage(tx, a.firm.id, 'aiCredits', 1n, eventId))).toBe(true);
    expect(await withFirmEntitlementTransaction(db, a.firm.id, (tx) => recordUsage(tx, a.firm.id, 'aiCredits', 1n, eventId))).toBe(false);
    await expect(withFirmEntitlementTransaction(db, a.firm.id, (tx) => recordUsage(tx, a.firm.id, 'aiCredits', 2n, eventId))).rejects.toMatchObject({ statusCode: 409 });
    const failedEvent = `fixture:${randomUUID()}`;
    await expect(withFirmEntitlementTransaction(db, a.firm.id, async (tx) => { await recordUsage(tx, a.firm.id, 'aiCredits', 2n, failedEvent); throw new Error('resource failure'); })).rejects.toThrow('resource failure');
    expect(await db.usageEvent.count({ where: { firmId: a.firm.id, eventId: failedEvent } })).toBe(0);
    expect((await db.usageCounter.findUniqueOrThrow({ where: { firmId_resource: { firmId: a.firm.id, resource: 'aiCredits' } } })).used).toBe(1n);
    await expect(db.usageEvent.updateMany({ where: { firmId: a.firm.id, eventId }, data: { delta: 9n } })).rejects.toThrow();
  });

  it('pins published revisions and rolls back assignment when required audit fails', async () => {
    await assign(a, baselineVersion);
    const before = await db.firmSubscription.findFirstOrThrow({ where: { firmId: a.firm.id }, orderBy: { effectiveFrom: 'desc' } });
    const { PlatformSubscriptionsRepository } = await import('../src/modules/platform/platform-subscriptions.repository.js');
    const failing = new PrismaClient({ datasources: { db: { url: testUrl } }, log: [] });
    const injected = new Proxy(failing, { get(target, key) {
      if (key === '$transaction') return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { isolationLevel: Prisma.TransactionIsolationLevel; timeout: number }) => target.$transaction((tx) => work(new Proxy(tx, { get(transaction, model) {
        if (model === 'subscriptionEvent') return { create: async () => { throw new Error('required audit failure'); } };
        return Reflect.get(transaction, model);
      } })), options);
      return Reflect.get(target, key);
    } });
    try {
      await expect(new PlatformSubscriptionsRepository(injected).assign(a.firm.id, await assignment(a, baselineVersion), platformId)).rejects.toThrow('required audit failure');
      expect(await db.firmSubscription.findUnique({ where: { id: before.id } })).toEqual(before);
      const version = await db.planVersion.findUniqueOrThrow({ where: { id: baselineVersion } });
      const newer = await data<{ versionId: number }>(await request('POST', `/platform/plans/${version.planId}/versions`, platformId, { features: ['firm.core'], quotas: { users: '1', documents: '0', storageBytes: null, aiCredits: '0' }, policy: LEGACY_POLICY, price: null, currency: null, reason }), 201);
      await data(await publishVersion(version.planId, newer.versionId));
      const access = await data<{ subscription: { planVersionId: number } }>(await request('GET', '/entitlements/me', a.admin.id));
      expect(access.subscription.planVersionId).toBe(baselineVersion);
      await expect(db.planVersion.update({ where: { id: baselineVersion }, data: { price: '999.00' } })).rejects.toThrow();
      await expect(db.planQuota.update({ where: { planVersionId_resource: { planVersionId: baselineVersion, resource: 'users' } }, data: { limit: 1n } })).rejects.toThrow();
    } finally { await failing.$disconnect(); }
  });

  it('honors trial expiry and restores the exact preceding end after cancelling a scheduled change', async () => {
    const trial = await published();
    const end = new Date(Date.now() + 86_400_000);
    await assign(a, trial.id, { status: 'TRIAL', trialEndsAt: end, effectiveUntil: end });
    const { loadEntitlements } = await import('../src/modules/entitlements/index.js');
    expect(evaluateFeature((await loadEntitlements(db, a.firm.id, end)).context, 'dashboard').allowed).toBe(false);
    const scheduled = await assign(a, baselineVersion, { effectiveFrom: new Date(Date.now() + 3_600_000) });
    await expectDenied(await request('DELETE', `/platform/firms/${b.firm.id}/subscription/${scheduled.id}`, platformId, { reason }), 404);
    await data(await request('DELETE', `/platform/firms/${a.firm.id}/subscription/${scheduled.id}`, platformId, { reason }));
    const current = await db.firmSubscription.findFirstOrThrow({ where: { firmId: a.firm.id }, orderBy: { effectiveFrom: 'desc' } });
    expect(current.effectiveUntil?.getTime()).toBe(end.getTime());
  });

  it('meters PDF quotas atomically while retaining access to existing PDFs at the limit', async () => {
    const limited = await published(baselineFeatures, { users: '4', documents: '1', storageBytes: null, aiCredits: '0' });
    await assign(a, limited.id);
    const quotation = await data<{ quotation: { id: number } }>(await request('POST', '/quotations', a.admin.id, { companyId: a.company.id, quotationDate: '2026-10-26', currency: 'USD', taxMode: 'NONE', items: [{ itemName: 'Fixture service', quantity: '1', unitRate: '10', gstRate: 0 }] }), 201);
    const document = await data<{ document: { id: number } }>(await request('POST', `/quotations/${quotation.quotation.id}/pdf`, a.admin.id), 201);
    await expectDenied(await request('POST', `/quotations/${quotation.quotation.id}/pdf`, a.admin.id), 409);
    expect((await request('GET', `/quotations/${quotation.quotation.id}/pdf/${document.document.id}/preview`, a.admin.id)).status).toBe(200);
    expect(await db.generatedDocument.count({ where: { quotationId: quotation.quotation.id } })).toBe(1);
    const pending = await db.usageCounter.findUniqueOrThrow({ where: { firmId_resource: { firmId: a.firm.id, resource: 'storageBytes' } } });
    expect(pending.ready).toBe(false); expect(pending.pendingDelta > 0n).toBe(true);
    await data(await request('POST', `/platform/firms/${a.firm.id}/usage/reconcile`, platformId, { reason }));
    const measured = await db.usageCounter.findUniqueOrThrow({ where: { firmId_resource: { firmId: a.firm.id, resource: 'storageBytes' } } });
    expect(measured.ready).toBe(true); expect(measured.pendingDelta).toBe(0n);
    const ledger = await db.usageEvent.aggregate({ where: { firmId: a.firm.id, resource: 'storageBytes' }, _sum: { delta: true } });
    expect(ledger._sum.delta).toBe(measured.used);
    expect((await db.usageCounter.findUniqueOrThrow({ where: { firmId_resource: { firmId: a.firm.id, resource: 'documents' } } })).used).toBe(1n);
  });

  it('requires storage reconciliation and rejects invalid plan publications', async () => {
    const finite = await published(baselineFeatures, { users: '4', documents: null, storageBytes: '1000', aiCredits: '0' });
    await expectDenied(await request('PUT', `/platform/firms/${b.firm.id}/subscription`, platformId, await assignment(b, finite.id)), 409);
    await data(await request('POST', `/platform/firms/${b.firm.id}/usage/reconcile`, platformId, { reason }));
    await assign(b, finite.id);
    const plan = await data<{ id: number }>(await request('POST', '/platform/plans', platformId, { name: 'Invalid fixture plan', slug: `invalid-${randomUUID()}`, reason }), 201);
    for (const features of [['firm.core', 'unknown'], ['firm.core', 'items']]) {
      const draft = await data<{ versionId: number }>(await request('POST', `/platform/plans/${plan.id}/versions`, platformId, { features, quotas: { users: '1', documents: '0', storageBytes: null, aiCredits: '0' }, policy: LEGACY_POLICY, price: null, currency: null, reason }), 201);
      await expectDenied(await publishVersion(plan.id, draft.versionId), 422);
    }
    const input = { features: ['firm.core'], quotas: { users: '4', documents: '0', storageBytes: null, aiCredits: '0' }, policy: LEGACY_POLICY, price: null, currency: null, reason };
    const draft = await data<{ versionId: number }>(await request('POST', `/platform/plans/${plan.id}/versions`, platformId, input), 201);
    const preview = await data<{ previewToken: string }>(await request('GET', `/platform/plans/${plan.id}/versions/${draft.versionId}/preview`));
    await data(await request('PUT', `/platform/plans/${plan.id}/versions/${draft.versionId}`, platformId, { ...input, quotas: { ...input.quotas, users: '5' } }));
    await expectDenied(await request('POST', `/platform/plans/${plan.id}/versions/${draft.versionId}/publish`, platformId, { reason, previewToken: preview.previewToken }), 409);
    await data(await publishVersion(plan.id, draft.versionId));
  });

  it('preserves decimal amounts, duplicate/partial/refund events and charge ownership under contention', async () => {
    const chargeInput = { idempotencyKey: randomUUID(), amount: '100.20', currency: 'USD', reason };
    const charge = await data<{ id: number; amount: string }>(await request('POST', `/platform/firms/${a.firm.id}/charges`, platformId, chargeInput), 201);
    expect((await data<{ id: number }>(await request('POST', `/platform/firms/${a.firm.id}/charges`, platformId, chargeInput), 201)).id).toBe(charge.id);
    const payment = { idempotencyKey: randomUUID(), kind: 'PAYMENT', amount: '30.10', reference: 'fixture receipt', reason };
    const first = await data<{ id: number }>(await request('POST', `/platform/firms/${a.firm.id}/charges/${charge.id}/payments`, platformId, payment), 201);
    expect((await data<{ id: number }>(await request('POST', `/platform/firms/${a.firm.id}/charges/${charge.id}/payments`, platformId, payment), 201)).id).toBe(first.id);
    await expectDenied(await request('POST', `/platform/firms/${b.firm.id}/charges/${charge.id}/payments`, platformId, { ...payment, idempotencyKey: randomUUID() }), 404);
    await data(await request('POST', `/platform/firms/${a.firm.id}/charges/${charge.id}/payments`, platformId, { ...payment, kind: 'REFUND', amount: '10.10', idempotencyKey: randomUUID() }), 201);
    const results = await Promise.all([1, 2].map(() => request('POST', `/platform/firms/${a.firm.id}/charges/${charge.id}/payments`, platformId, { ...payment, amount: '60.20', idempotencyKey: randomUUID() })));
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const events = await db.paymentEvent.findMany({ where: { chargeId: charge.id } });
    expect(events.reduce((total, event) => event.kind === 'PAYMENT' ? total.plus(event.amount) : total.minus(event.amount), new Prisma.Decimal(0)).toFixed(2)).toBe('80.20');
  });
});
