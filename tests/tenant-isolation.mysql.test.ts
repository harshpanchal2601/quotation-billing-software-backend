import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AccountType, Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { assertDisposableTenantDatabase, expectDenied, TwoFirmFixture, type TenantFixture } from './helpers/two-firm-fixture.js';

const testUrl = process.env.WAVE01_TEST_DATABASE_URL;
const databaseSuite = testUrl ? describe : describe.skip;
type Route = { method: string; path: string; source: string; required_permissions: string[] };
const inventory = JSON.parse(readFileSync(new URL('../docs/architecture/backend/WAVE01-SECURITY-MATRIX.json', import.meta.url), 'utf8')) as { routes: Route[] };
const firmRoutes = inventory.routes.filter((route) => !/^\/api\/v1\/(auth|platform|health)(?:\/|$)/.test(route.path));

databaseSuite('authenticated two-firm API isolation against disposable MySQL', () => {
  let db: PrismaClient;
  let fixtures: TwoFirmFixture;
  let a: TenantFixture;
  let b: TenantFixture;
  let server: Server;
  let baseUrl: string;
  let temporaryStorage: string;
  let originalStorage: string;
  let platformId: number;
  let platformCookie: string;
  let readerCookie: string;
  const cookies = new Map<number, string>();
  const quotations = new Map<number, number>();
  const documents = new Map<number, number>();
  const attachments = new Map<number, number>();
  const sendMail = vi.fn().mockRejectedValue(new Error('External mail is disabled in the isolation suite'));
  const generatePdf = vi.fn().mockRejectedValue(new Error('PDF provider is disabled in the isolation suite'));

  async function request(method: string, route: string, cookie = cookies.get(a.admin.id), body?: unknown, firmId?: string) {
    return fetch(`${baseUrl}${route}`, {
      method, redirect: 'manual', headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(firmId === undefined ? {} : { 'x-firm-id': firmId }),
      }, body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function quotationInput(tenant: TenantFixture) {
    return { companyId: tenant.company.id, quotationDate: '2026-10-22', currency: 'USD', taxMode: 'NONE',
      items: [{ itemId: tenant.item.id, quantity: '1', unitRate: '10', gstRate: 0 }] };
  }

  function probePath(route: string, tenant: TenantFixture) {
    const defaultId = route.startsWith('/api/v1/quotations') ? quotations.get(tenant.firm.id)! :
      route.includes('/categories') ? tenant.category.id : route.includes('/measurement-units') ? tenant.unit.id :
      route.includes('/items') ? tenant.item.id : route.includes('/roles') ? tenant.role.id :
      route.includes('/users') ? tenant.reader.id : route.includes('/bank-details') ? tenant.bank.id : tenant.company.id;
    return route.replace(/:(\w+)/g, (_match, key: string) => String(({
      companyId: tenant.company.id, contactId: tenant.contact.id, addressId: tenant.address.id,
      quotationId: quotations.get(tenant.firm.id), documentId: documents.get(tenant.firm.id),
      attachmentId: attachments.get(tenant.firm.id), id: defaultId,
    } as Record<string, number | undefined>)[key] ?? defaultId));
  }

  beforeAll(async () => {
    assertDisposableTenantDatabase(testUrl!);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', testUrl!);
    vi.stubEnv('JWT_ACCESS_SECRET', 'wave01-disposable-access-secret');
    vi.stubEnv('JWT_REFRESH_SECRET', 'wave01-disposable-refresh-secret');
    vi.stubEnv('JWT_ACCESS_EXPIRES_IN', '1h');
    vi.stubEnv('BCRYPT_SALT_ROUNDS', '10');
    db = new PrismaClient({ datasources: { db: { url: testUrl } } });
    const applied = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations
      WHERE migration_name = '20261022090000_wave01_identity_boundaries'
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(applied).toHaveLength(1);
    vi.doMock('../src/core/database/prisma.js', () => ({ prisma: db }));
    vi.doMock('../src/integrations/mail/index.js', () => ({ mailService: { send: sendMail } }));
    vi.doMock('../src/integrations/pdf/index.js', () => ({ pdfService: { generateBufferFromHtml: generatePdf } }));
    const { storageConfig } = await import('../src/config/storage.config.js');
    originalStorage = storageConfig.root;
    temporaryStorage = await mkdtemp(path.join(os.tmpdir(), 'wave01-storage-'));
    storageConfig.root = temporaryStorage;
    const { app } = await import('../src/bootstrap/app.js');
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing disposable HTTP listener');
    baseUrl = `http://127.0.0.1:${address.port}`;
    fixtures = new TwoFirmFixture(db);
    a = await fixtures.createTenant('A');
    b = await fixtures.createTenant('B');
    const platform = await fixtures.createActor(null, AccountType.SUPER_ADMIN);
    platformId = platform.id;
    const { generateAccessToken } = await import('../src/modules/auth/security/auth.tokens.js');
    const { ACCESS_TOKEN_COOKIE_NAME } = await import('../src/modules/auth/auth.constants.js');
    for (const actor of [a.admin, b.admin, a.reader, platform]) {
      const session = await db.authSession.create({ data: {
        userId: actor.id, refreshTokenHash: 'fixture', expiresAt: new Date(Date.now() + 3_600_000),
      } });
      cookies.set(actor.id, `${ACCESS_TOKEN_COOKIE_NAME}=${generateAccessToken({ userId: actor.id, role: actor.role, sessionId: session.id })}`);
    }
    readerCookie = cookies.get(a.reader.id)!;
    platformCookie = cookies.get(platform.id)!;
    for (const tenant of [a, b]) {
      const response = await request('POST', '/api/v1/quotations', cookies.get(tenant.admin.id), quotationInput(tenant));
      expect(response.status, await response.clone().text()).toBe(201);
      const result = await response.json() as { data: { quotation: { id: number } } };
      quotations.set(tenant.firm.id, result.data.quotation.id);
      const filePath = `quotation-documents/${tenant.firm.id}/fixture.pdf`;
      await mkdir(path.join(temporaryStorage, path.dirname(filePath)), { recursive: true });
      await writeFile(path.join(temporaryStorage, filePath), `%PDF-1.4\nPrivate ${tenant.firm.slug}`);
      const document = await db.generatedDocument.create({ data: {
        quotationId: result.data.quotation.id, versionNumber: 1, filePath, generatedById: tenant.admin.id,
      } });
      documents.set(tenant.firm.id, document.id);
      const attachmentPath = `quotation-attachments/${tenant.firm.id}/fixture.txt`;
      await mkdir(path.join(temporaryStorage, path.dirname(attachmentPath)), { recursive: true });
      await writeFile(path.join(temporaryStorage, attachmentPath), `Private ${tenant.firm.slug}`);
      const attachment = await db.quotationAttachment.create({ data: {
        quotationId: result.data.quotation.id, originalFilename: 'fixture.txt', storedFilename: 'fixture.txt',
        filePath: `storage/${attachmentPath}`, mimeType: 'text/plain', fileSize: 16, uploadedById: tenant.admin.id,
      } });
      attachments.set(tenant.firm.id, attachment.id);
    }
  }, 60_000);

  afterAll(async () => {
    try {
      if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (fixtures) await fixtures.cleanup();
    } finally {
      if (db) await db.$disconnect();
      if (temporaryStorage) {
        const { storageConfig } = await import('../src/config/storage.config.js');
        storageConfig.root = originalStorage;
        await rm(temporaryStorage, { recursive: true, force: true });
      }
      vi.doUnmock('../src/core/database/prisma.js');
      vi.doUnmock('../src/integrations/mail/index.js');
      vi.doUnmock('../src/integrations/pdf/index.js');
      vi.unstubAllEnvs();
    }
  }, 60_000);

  it.each(['locked', 'inactive', 'deleted-user', 'suspended', 'deleted-firm', 'revoked', 'expired'] as const)(
    'denies %s identity on every registered firm route', async (condition) => {
      const deniedStatus = ['deleted-user', 'revoked', 'expired'].includes(condition) ? 401 : 403;
      try {
        if (condition === 'locked' || condition === 'inactive') await db.user.update({ where: { id: a.admin.id }, data: { status: condition === 'locked' ? 'LOCKED' : 'INACTIVE' } });
        if (condition === 'deleted-user') await db.user.update({ where: { id: a.admin.id }, data: { deletedAt: new Date() } });
        if (condition === 'suspended') await db.firm.update({ where: { id: a.firm.id }, data: { status: 'SUSPENDED' } });
        if (condition === 'deleted-firm') await db.firm.update({ where: { id: a.firm.id }, data: { deletedAt: new Date() } });
        if (condition === 'revoked') await db.authSession.updateMany({ where: { userId: a.admin.id }, data: { revokedAt: new Date() } });
        if (condition === 'expired') await db.authSession.updateMany({ where: { userId: a.admin.id }, data: { expiresAt: new Date(0) } });
        for (const route of firmRoutes) {
          await expectDenied(await request(route.method, probePath(route.path, a)), deniedStatus);
        }
      } finally {
        await db.user.update({ where: { id: a.admin.id }, data: { status: 'ACTIVE', deletedAt: null } });
        await db.firm.update({ where: { id: a.firm.id }, data: { status: 'ACTIVE', deletedAt: null } });
        await db.authSession.updateMany({ where: { userId: a.admin.id }, data: { revokedAt: null, expiresAt: new Date(Date.now() + 3_600_000) } });
      }
    }, 60_000,
  );

  it('preserves quotation-view permission without document or attachment privileges', async () => {
    expect((await request('GET', '/api/v1/quotations', readerCookie)).status).toBe(200);
    expect((await request('GET', `/api/v1/quotations/${quotations.get(a.firm.id)}`, readerCookie)).status).toBe(200);
    await expectDenied(await request('GET', `/api/v1/quotations/${quotations.get(a.firm.id)}/attachments`, readerCookie), 403);
    await expectDenied(await request('GET', `/api/v1/quotations/${quotations.get(a.firm.id)}/pdf/${documents.get(a.firm.id)}/download`, readerCookie), 403);
    await expectDenied(await request('POST', '/api/v1/quotations', readerCookie, quotationInput(a)), 403);
  });

  it('enforces each registered route permission and accepts its own grant independently', async () => {
    const { PERMISSIONS, ASSIGNABLE_PERMISSIONS } = await import('../src/modules/auth/permissions.js');
    try {
      for (const route of firmRoutes.filter((entry) => entry.required_permissions.length > 0)) {
        const target = route.path.replace(/:\w+/g, '2147483647');
        await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: [] } });
        await expectDenied(await request(route.method, target, readerCookie), 403);
        for (const permission of route.required_permissions) {
          if (!ASSIGNABLE_PERMISSIONS.includes(PERMISSIONS[permission as keyof typeof PERMISSIONS])) continue;
          await db.firmRole.update({ where: { id: a.role.id }, data: {
            permissions: [PERMISSIONS[permission as keyof typeof PERMISSIONS]],
          } });
          const allowed = await request(route.method, target, readerCookie);
          // Missing payload/record is intentional: no provider call or financial
          // mutation is executed; this verifies the route's permission boundary.
          expect([200, 400, 404], `${route.method} ${route.path}: ${await allowed.text()}`).toContain(allowed.status);
        }
      }
    } finally {
      await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: ['quotations.view'] } });
    }
  }, 60_000);

  it.each(['companies', 'items', 'categories', 'measurement-units', 'quotations', 'administration/roles', 'administration/users', 'settings/bank-details', 'audit-logs'])(
    'scopes %s list and count despite a forged firm header', async (module) => {
      const response = await request('GET', `/api/v1/${module}`, undefined, undefined, String(b.firm.id));
      expect(response.status, await response.clone().text()).toBe(200);
      const text = await response.text();
      expect(text).not.toContain(b.company.name);
      expect(text).not.toContain(b.item.name);
      expect(text).not.toContain(b.admin.email);
      expect(text).not.toContain(b.reader.email);
      expect(text).not.toContain(b.firm.slug);
    },
  );

  it.each(['companies', 'items', 'categories', 'measurement-units', 'quotations'])(
    'rejects valid foreign %s IDs on detail, update and delete', async (module) => {
      const target = probePath(`/api/v1/${module}/:id`, b);
      await expectDenied(await request('GET', target));
      await expectDenied(await request('PUT', target, undefined, module === 'quotations' ? { remarks: 'foreign mutation' } : { name: 'Foreign mutation' }));
      await expectDenied(await request('DELETE', target));
    },
  );

  it('supports firm-owned CRUD and denies foreign mutations across all mutable business modules', async () => {
    const cases = [
      { route: 'companies', key: 'company', create: { name: 'Wave01 temporary company' }, update: { name: 'Wave01 updated company' } },
      { route: 'categories', key: 'category', create: { name: 'Wave01 temporary category' }, update: { name: 'Wave01 updated category' } },
      { route: 'measurement-units', key: 'measurementUnit', create: { name: 'Wave01 temporary unit', symbol: 'WTU' }, update: { name: 'Wave01 updated unit' } },
      { route: 'items', key: 'item', create: { name: 'Wave01 temporary item', categoryId: a.category.id, measurementUnitId: a.unit.id }, update: { name: 'Wave01 updated item' } },
      { route: 'administration/roles', key: 'role', create: { name: 'Wave01 temporary role', permissions: ['companies.view'] }, update: { name: 'Wave01 updated role' } },
      { route: 'administration/users', key: 'user', create: { name: 'Wave01 temporary user', username: `wave01.user.${a.firm.id}`, email: `wave01-user-${a.firm.id}@example.invalid`, roleId: a.role.id, temporaryPassword: 'FixtureStrong1!' }, update: { name: 'Wave01 updated user' } },
      { route: 'settings/bank-details', key: 'bankDetail', create: { bankName: 'Wave01 temporary bank', accountName: 'Fixture', accountNumber: '123456' }, update: { bankName: 'Wave01 updated bank' } },
      { route: 'quotations', key: 'quotation', create: quotationInput(a), update: { remarks: 'Wave01 updated quote' } },
    ];
    for (const entry of cases) {
      const response = await request('POST', `/api/v1/${entry.route}`, undefined, entry.create);
      expect(response.status, await response.clone().text()).toBe(201);
      const result = await response.json() as { data: Record<string, { id: number }> };
      const id = result.data[entry.key]!.id;
      const route = `/api/v1/${entry.route}/${id}`;
      await expectDenied(await request('PUT', route, cookies.get(b.admin.id), entry.update));
      await expectDenied(await request('DELETE', route, cookies.get(b.admin.id)));
      expect((await request('PUT', route, undefined, entry.update)).status).toBe(200);
      expect((await request('DELETE', route)).status).toBe(200);
    }
  }, 60_000);

  it('rejects foreign IDs on every remaining parameterized firm route', async () => {
    const routes = firmRoutes.filter((route) => route.path.includes(':') &&
      !(route.method === 'POST' && /\/(image|attachments)$/.test(route.path)));
    for (const route of routes) {
      let body: unknown;
      if (route.method === 'PUT') {
        body = route.path.includes('/quotations/') ? { remarks: 'Foreign' } :
          route.path.includes('/bank-details/') ? { bankName: 'Foreign' } :
          route.path.includes('/addresses/') ? { city: 'Foreign' } : { name: 'Foreign' };
      } else if (route.method === 'PATCH' && route.path.endsWith('/status')) {
        body = route.path.includes('/quotations/') ? { status: 'SENT' } : { isActive: false };
      } else if (route.method === 'POST' && route.path.endsWith('/reset-password')) {
        body = { temporaryPassword: 'FixtureStrong1!' };
      } else if (route.method === 'POST' && route.path.endsWith('/contacts')) {
        body = { name: 'Foreign contact' };
      } else if (route.method === 'POST' && route.path.endsWith('/addresses')) {
        body = { addressType: 'BILLING', addressLine1: 'Foreign', city: 'Ahmedabad', state: 'Gujarat', postalCode: '380001' };
      } else if (route.method === 'POST' && route.path.endsWith('/email')) {
        body = { generatedDocumentId: documents.get(b.firm.id), to: ['fixture@example.invalid'], subject: 'Probe', message: 'Probe' };
      }
      await expectDenied(await request(route.method, probePath(route.path, b), undefined, body));
    }
  }, 60_000);

  it('rejects foreign file uploads and cleans their temporary files', async () => {
    const { readdir } = await import('node:fs/promises');
    for (const [route, field, filename, mime] of [
      [`/api/v1/items/${b.item.id}/image`, 'image', 'probe.png', 'image/png'],
      [`/api/v1/quotations/${quotations.get(b.firm.id)}/attachments`, 'file', 'probe.txt', 'text/plain'],
    ]) {
      const form = new FormData();
      form.append(field!, new Blob(['fixture'], { type: mime }), filename);
      await expectDenied(await fetch(`${baseUrl}${route}`, { method: 'POST', headers: { Cookie: cookies.get(a.admin.id)! }, body: form }));
    }
    expect(await readdir(path.join(temporaryStorage, 'quotation-attachments', String(a.firm.id)))).toEqual(['fixture.txt']);
  });

  it('scopes singleton settings and dashboard aggregation to the authenticated firm', async () => {
    const before = await db.businessProfile.findUniqueOrThrow({ where: { firmId: b.firm.id } });
    const response = await request('PUT', '/api/v1/settings/business-profile', undefined, { displayName: 'Wave01 A profile' }, String(b.firm.id));
    expect(response.status).toBe(200);
    expect((await db.businessProfile.findUniqueOrThrow({ where: { firmId: b.firm.id } })).displayName).toBe(before.displayName);
    const dashboard = await request('GET', '/api/v1/dashboard/overview?period=CUSTOM&dateFrom=2026-10-01&dateTo=2026-10-31&currency=USD');
    expect(dashboard.status).toBe(200);
    const text = await dashboard.text();
    expect(text).not.toContain(b.company.name);
    expect(text).not.toContain(b.item.name);
    await expectDenied(await request('POST', '/api/v1/companies', undefined, { name: 'Client tenant', firmId: b.firm.id }), 400);
  });

  it('rejects cross-company contacts, addresses and foreign item inputs before quotation writes', async () => {
    const before = await db.quotation.count({ where: { firmId: a.firm.id } });
    for (const [override, status] of [
      [{ companyId: b.company.id }, 404], [{ companyContactId: b.contact.id }, 400],
      [{ billingAddressId: b.address.id }, 400], [{ shippingAddressId: b.address.id }, 400],
      [{ items: [{ itemId: b.item.id, quantity: '1', unitRate: '10' }] }, 409],
    ] as const) {
      await expectDenied(await request('POST', '/api/v1/quotations', undefined, { ...quotationInput(a), ...override }), status);
    }
    expect(await db.quotation.count({ where: { firmId: a.firm.id } })).toBe(before);
    await expectDenied(await request('PUT', `/api/v1/companies/${a.company.id}/contacts/${b.contact.id}`, undefined, { name: 'Foreign' }));
    await expectDenied(await request('PUT', `/api/v1/companies/${a.company.id}/addresses/${b.address.id}`, undefined, { city: 'Foreign' }));
    await expectDenied(await request('POST', '/api/v1/items', undefined, { name: 'Foreign catalog', categoryId: b.category.id, measurementUnitId: a.unit.id }), 409);
    await expectDenied(await request('POST', '/api/v1/items', undefined, { name: 'Foreign unit', categoryId: a.category.id, measurementUnitId: b.unit.id }), 409);
  });

  it('rejects foreign role assignment at the API and database boundaries', async () => {
    await expectDenied(await request('PUT', `/api/v1/administration/users/${a.reader.id}`, undefined, { roleId: b.role.id }));
    await expect(db.user.update({ where: { id: a.reader.id }, data: { firmRoleId: b.role.id } })).rejects.toThrow();
    await expect(db.user.update({ where: { id: a.reader.id }, data: { firmId: null } })).rejects.toThrow();
    expect((await db.user.findUniqueOrThrow({ where: { id: a.reader.id } })).firmRoleId).toBe(a.role.id);
  });

  it('keeps global platform mutations in platform audit scope', async () => {
    const response = await request('PUT', `/api/v1/platform/firms/${a.firm.id}`, platformCookie, { name: a.firm.name });
    expect(response.status).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'Firm', entityId: String(a.firm.id), userId: platformId }, orderBy: { id: 'desc' } });
    expect(audit.firmId).toBeNull();
  });

  it('rolls back a platform mutation and session revocation when required audit fails', async () => {
    const { PlatformRepository } = await import('../src/modules/platform/platform.repository.js');
    const target = new PlatformRepository(new Proxy(db, {
      get(client, key) {
        if (key === '$transaction') return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
          client.$transaction((tx) => callback(new Proxy(tx, {
            get(transaction, model) {
              if (model === 'auditLog') return { create: async () => { throw new Error('injected platform audit failure'); } };
              return Reflect.get(transaction, model);
            },
          })));
        const value = Reflect.get(client, key);
        return typeof value === 'function' ? value.bind(client) : value;
      },
    }));
    await expect(target.updateFirmStatus(a.firm.id, 'SUSPENDED', { userId: platformId })).rejects.toThrow('injected platform audit failure');
    expect((await db.firm.findUniqueOrThrow({ where: { id: a.firm.id } })).status).toBe('ACTIVE');
    expect(await db.authSession.count({ where: { userId: a.admin.id, revokedAt: { not: null } } })).toBe(0);
  });

  it('scopes filtered audit pagination, counts and attached identities to the firm', async () => {
    for (const tenant of [a, b]) {
      await db.auditLog.create({ data: { firmId: tenant.firm.id, userId: tenant.admin.id,
        entityType: 'Wave01Fixture', entityId: String(tenant.firm.id), action: 'UPDATE' } });
    }
    const filtered = await request('GET', '/api/v1/audit-logs?entityType=Wave01Fixture&action=UPDATE&limit=1');
    expect(await filtered.json()).toMatchObject({ data: {
      auditLogs: [{ firmId: a.firm.id, user: { id: a.admin.id, email: a.admin.email } }],
      pagination: { total: 1, totalPages: 1 },
    } });
    const foreign = await request('GET', `/api/v1/audit-logs?entityType=Wave01Fixture&userId=${b.admin.id}`);
    expect(await foreign.json()).toMatchObject({ data: { auditLogs: [], pagination: { total: 0 } } });
    await db.auditLog.create({ data: { firmId: a.firm.id, userId: b.admin.id,
      entityType: 'Wave01ForeignActor', entityId: 'fixture', action: 'UPDATE' } });
    const redacted = await request('GET', '/api/v1/audit-logs?entityType=Wave01ForeignActor');
    expect(await redacted.json()).toMatchObject({ data: { auditLogs: [{ user: null }] } });
  });

  it('requires explicit platform selection and appends an immutable platform-scope event', async () => {
    await expectDenied(await request('GET', '/api/v1/companies', platformCookie), 400);
    await expectDenied(await request('GET', '/api/v1/companies', platformCookie, undefined, 'invalid'), 400);
    const response = await request('GET', '/api/v1/companies', platformCookie, undefined, String(a.firm.id));
    expect(response.status).toBe(200);
    const event = await db.auditLog.findFirstOrThrow({ where: { entityType: 'PlatformFirmAccess', userId: platformId }, orderBy: { id: 'desc' } });
    expect(event.firmId).toBeNull();
    expect(event.newValues).toMatchObject({ actorId: platformId, selectedFirmId: a.firm.id, decision: 'FIRM_CONTEXT_GRANTED' });
    await expect(db.auditLog.update({ where: { id: event.id }, data: { entityType: 'Company' } })).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: event.id } })).rejects.toThrow();
    const tenantAudit = await request('GET', '/api/v1/audit-logs?entityType=PlatformFirmAccess');
    expect(await tenantAudit.json()).toMatchObject({ data: { auditLogs: [], pagination: { total: 0 } } });
    await expectDenied(await request('GET', '/api/v1/platform/firms'), 403);
  });

  it('keeps private downloads behind persisted ownership and excludes them from static storage', async () => {
    for (const tenant of [a, b]) {
      const quote = quotations.get(tenant.firm.id)!;
      const pdf = `/api/v1/quotations/${quote}/pdf/${documents.get(tenant.firm.id)}/download`;
      const attachment = `/api/v1/quotations/${quote}/attachments/${attachments.get(tenant.firm.id)}/download`;
      const ownCookie = cookies.get(tenant.admin.id);
      expect((await request('GET', pdf, ownCookie)).status).toBe(200);
      expect((await request('GET', attachment, ownCookie)).status).toBe(200);
      const foreignCookie = cookies.get(tenant === a ? b.admin.id : a.admin.id);
      await expectDenied(await request('GET', pdf, foreignCookie));
      await expectDenied(await request('GET', attachment, foreignCookie));
      for (const directory of ['quotation-documents', 'quotation-attachments']) {
        expect((await request('GET', `/storage/${directory}/${tenant.firm.id}/fixture.pdf`, '')).status).toBe(404);
      }
    }
    expect((await request('GET', '/storage/logos/..%2Fquotation-documents/fixture.pdf', '')).status).not.toBe(200);
    await mkdir(path.join(temporaryStorage, 'logos'), { recursive: true });
    await writeFile(path.join(temporaryStorage, 'logos', 'fixture.png'), 'public fixture');
    expect((await request('GET', '/storage/logos/fixture.png', '')).status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
    expect(generatePdf).not.toHaveBeenCalled();
  });
});
