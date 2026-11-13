import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TwoFirmFixture, assertDisposableTenantDatabase, type TenantFixture } from './helpers/two-firm-fixture.js';

const testUrl = process.env.WAVE06_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
type Order = { id: number; version: number; status: string; lines: Array<{ id: number; quantity: string; fulfilled: string; reserved: string; available: string }>; fulfillments: Array<{ id: number }> };
type Invoice = { id: number; version: number; grandTotal: string };
suite('Wave 06 authenticated two-firm sales and portal flows', () => {
  let db: PrismaClient; let fixture: TwoFirmFixture; let a: TenantFixture; let b: TenantFixture; let server: Server; let base: string; let origin: string; let planId: number; let planVersionId: number;
  const cookies = new Map<number, string>(); let failAudit = false;
  async function request(method: string, path: string, body?: unknown, actorId = a.admin.id) {
    return fetch(`${base}/api/v1${path}`, { method, headers: { Cookie: cookies.get(actorId)!, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function portal(method: string, path: string, cookie = '', body?: unknown, csrf = '') {
    return fetch(`${base}/api/v1/customer-portal${path}`, { method, headers: { Cookie: cookie, Origin: origin, 'x-portal-csrf': csrf, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function data<T>(response: Response, status = 200): Promise<T> { expect(response.status, await response.clone().text()).toBe(status); return (await response.json() as { data: T }).data; }
  async function quote(tenant = a, accepted = true) {
    const created = await data<{ quotation: { id: number } }>(await request('POST', '/quotations', { companyId: tenant.company.id, billingAddressId: tenant.address.id, quotationDate: new Date().toISOString().slice(0, 10), currency: 'INR', taxMode: 'NONE', internalNotes: `Private ${tenant.firm.id}`, items: [{ itemName: 'Accepted service', measurementUnit: 'HOUR', quantity: '10', unitRate: '10', gstRate: '0' }] }, tenant.admin.id), 201);
    await data(await request('PATCH', `/quotations/${created.quotation.id}/status`, { status: 'SENT' }, tenant.admin.id));
    if (accepted) await data(await request('PATCH', `/quotations/${created.quotation.id}/status`, { status: 'ACCEPTED' }, tenant.admin.id));
    return created.quotation.id;
  }
  async function order(tenant = a) { return (await data<{ order: Order }>(await request('POST', '/sales-orders/from-quotation', { sourceRevisionId: await quote(tenant), idempotencyKey: randomUUID() }, tenant.admin.id), 201)).order; }
  async function getOrder(id: number) { return (await data<{ order: Order }>(await request('GET', `/sales-orders/${id}`))).order; }
  function fulfillment(row: Order, quantity = '10') { return { salesOrderId: row.id, expectedVersion: row.version, idempotencyKey: randomUUID(), reference: randomUUID(), occurredAt: new Date().toISOString(), lines: [{ salesOrderLineId: row.lines[0]!.id, quantity }] }; }
  const supply = { isExempt: true, placeOfSupplyStateCode: '24', placeOfSupplyBasis: 'SERVICES_GENERAL', explanation: '' };
  function invoiceInput(row: Order, quantity: string) { return { salesOrderId: row.id, idempotencyKey: randomUUID(), supply, customFieldValues: {}, lines: [{ salesOrderLineId: row.lines[0]!.id, quantity, hsnCode: null, supplyType: 'SERVICE' }] }; }
  async function invite(tenant = a) {
    const invitation = await data<{ token: string; identityId: number; invitationId: number }>(await request('POST', '/portal-access/invitations', { companyId: tenant.company.id, contactId: tenant.contact.id, expiresAt: new Date(Date.now() + 3600000).toISOString() }, tenant.admin.id), 201);
    const response = await portal('POST', '/exchange', '', { token: invitation.token });
    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const session = await data<{ csrfToken: string }>(response);
    return { ...invitation, cookie, csrf: session.csrfToken };
  }
  async function share(identityId: number, quotationId: number, tenant = a, allowDecision = true) { return data<{ id: number; snapshotHash: string }>(await request('POST', '/portal-access/grants', { identityId, quotationId, allowDecision, expiresAt: new Date(Date.now() + 86400000).toISOString() }, tenant.admin.id), 201); }

  beforeAll(async () => {
    assertDisposableTenantDatabase(testUrl!, '06');
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', testUrl!); vi.stubEnv('JWT_ACCESS_SECRET', 'wave06-disposable-access-secret'); vi.stubEnv('JWT_REFRESH_SECRET', 'wave06-disposable-refresh-secret');
    db = new PrismaClient({ datasources: { db: { url: testUrl! } } });
    const applied = await db.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261108090000_wave06_sales_collaboration' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(applied).toHaveLength(1);
    db.$use(async (params, next) => { if (failAudit && params.model === 'AuditLog' && params.action === 'create') throw new Error('Injected audit failure'); return next(params); });
    vi.doMock('../src/core/database/prisma.js', () => ({ prisma: db }));
    vi.doMock('../src/integrations/mail/index.js', () => ({ mailService: { send: vi.fn().mockRejectedValue(new Error('External mail disabled')) } }));
    vi.doMock('../src/integrations/documents/index.js', () => ({ renderAndStorePdf: vi.fn().mockResolvedValue({ fileHash: '0'.repeat(64), fileSize: 20 }) }));
    fixture = new TwoFirmFixture(db); a = await fixture.createTenant('sales-A'); b = await fixture.createTenant('sales-B');
    for (const tenant of [a, b]) await db.companyContact.update({ where: { id: tenant.contact.id }, data: { email: `portal-${tenant.firm.id}@example.invalid` } });
    const { FEATURE_KEYS } = await import('../src/modules/entitlements/feature-registry.js'); const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const plan = await db.plan.create({ data: { name: 'Wave06 fixture', slug: `wave06-${randomUUID()}`, versions: { create: { revision: 1, createdById: a.admin.id, policy: LEGACY_POLICY, features: { create: FEATURE_KEYS.map((featureKey) => ({ featureKey })) }, quotas: { create: ['users','documents','storageBytes','aiCredits'].map((resource) => ({ resource, limit: null })) } } } }, include: { versions: true } });
    await fixture.publishPlanVersion(plan.versions[0]!.id); planId = plan.id; planVersionId = plan.versions[0]!.id;
    for (const tenant of [a, b]) await db.firmSubscription.create({ data: { firmId: tenant.firm.id, planVersionId, status: 'ACTIVE', authorId: tenant.admin.id, reason: 'Disposable sales fixture', effectiveFrom: new Date(Date.now() - 1000) } });
    const { generateAccessToken } = await import('../src/modules/auth/security/auth.tokens.js'); const { ACCESS_TOKEN_COOKIE_NAME } = await import('../src/modules/auth/auth.constants.js');
    for (const actor of [a.admin, a.reader, b.admin]) { const session = await db.authSession.create({ data: { userId: actor.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3600000) } }); cookies.set(actor.id, `${ACCESS_TOKEN_COOKIE_NAME}=${generateAccessToken({ userId: actor.id, role: actor.role, sessionId: session.id })}`); }
    origin = new URL((await import('../src/config/env.js')).env.FRONTEND_URL).origin;
    const { app } = await import('../src/bootstrap/app.js'); server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Disposable listener unavailable'); base = `http://127.0.0.1:${address.port}`;
    for (const tenant of [a, b]) await data(await request('PUT', '/billing-settings', { expectedVersion: 0, config: { schemaVersion: 1, registration: 'UNREGISTERED', sellerStateCode: '24', einvoiceRequired: false, prefixes: { INVOICE: 'INV', PROFORMA: 'PF', CREDIT_NOTE: 'CN', DEBIT_NOTE: 'DN' }, template: 'STANDARD', primaryColour: '#168A56', paymentInstructions: 'Fixture', termsAndConditions: '' } }, tenant.admin.id));
  }, 60000);
  afterAll(async () => { try { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); if (fixture) await fixture.cleanup(); if (planId) await db.plan.update({ where: { id: planId }, data: { archivedAt: new Date() } }); } finally { if (db) await db.$disconnect(); vi.doUnmock('../src/core/database/prisma.js'); vi.doUnmock('../src/integrations/mail/index.js'); vi.doUnmock('../src/integrations/documents/index.js'); vi.unstubAllEnvs(); } }, 60000);

  it('isolates CRM lists, foreign owners, customer joins, assignments and timelines', async () => {
    const createLead = (tenant: TenantFixture) => request('POST', '/leads', { name: `Lead ${tenant.firm.id}`, ownerId: tenant.admin.id }, tenant.admin.id);
    const own = (await data<{ record: { id: number; version: number } }>(await createLead(a), 201)).record;
    const other = (await data<{ record: { id: number } }>(await createLead(b), 201)).record;
    const list = await data<{ records: Array<{ id: number }>; pagination: { total: number } }>(await request('GET', '/leads'));
    expect(list.records.map((row) => row.id)).toContain(own.id); expect(list.records.map((row) => row.id)).not.toContain(other.id);
    expect(list.pagination.total).toBe(1);
    const audit = await data<{ auditLogs: Array<{ firmId: number; entityId: string }> }>(await request('GET', '/audit-logs?entityType=Lead&limit=100'));
    expect(audit.auditLogs.every((entry) => entry.firmId === a.firm.id)).toBe(true); expect(audit.auditLogs.some((entry) => entry.entityId === String(other.id))).toBe(false);
    expect((await request('PATCH', `/leads/${other.id}`, { expectedVersion: 1, name: 'Probe' })).status).toBe(404);
    expect((await request('POST', '/leads', { name: 'Foreign owner', ownerId: b.admin.id })).status).toBe(404);
    expect((await request('POST', '/opportunities', { title: 'Probe', companyId: b.company.id, ownerId: a.admin.id, value: '1', currency: 'INR' })).status).toBe(404);
    expect((await request('GET', `/customer-timeline?companyId=${b.company.id}`)).status).toBe(404);
    await data(await request('POST', `/leads/${own.id}/convert`, { companyId: a.company.id, expectedVersion: own.version, idempotencyKey: randomUUID() }));
    const opp = (await data<{ record: { id: number; version: number; probability: number } }>(await request('POST', '/opportunities', { title: 'Project', leadId: own.id, ownerId: a.admin.id, value: '100.00', currency: 'INR', stage: 'PROPOSAL' }), 201)).record;
    expect(opp.probability).toBe(50);
    const won = await data<{ record: { probability: number } }>(await request('PATCH', `/opportunities/${opp.id}`, { expectedVersion: opp.version, stage: 'WON', probability: 1 })); expect(won.record.probability).toBe(100);
    const task = (await data<{ record: { id: number; version: number; companyId: number } }>(await request('POST', '/tasks', { title: 'Call customer', opportunityId: opp.id, assignedToId: a.admin.id, dueAt: new Date(Date.now() + 86400000).toISOString(), reminderAt: new Date(Date.now() - 1000).toISOString() }), 201)).record;
    expect(task.companyId).toBe(a.company.id);
    await data(await request('PATCH', `/tasks/${task.id}`, { expectedVersion: task.version, status: 'DONE' }));
    const timeline = await data<{ records: Array<{ subject: string }> }>(await request('GET', `/customer-timeline?companyId=${a.company.id}`)); expect(timeline.records.some((row) => row.subject === 'Follow-up updated')).toBe(true);
  });
  it('converts explicitly to the shared Company workflow exactly once, including audit rollback', async () => {
    const lead = (await data<{ record: { id: number; version: number } }>(await request('POST', '/leads', { name: randomUUID(), ownerId: a.admin.id }), 201)).record;
    const body = { expectedVersion: lead.version, idempotencyKey: randomUUID(), newCompany: { name: `New ${randomUUID()}`, contacts: [{ name: 'Buyer', email: 'new-buyer@example.invalid', isPrimary: true }] }, confirmNewCompany: true };
    const responses = await Promise.all([request('POST', `/leads/${lead.id}/convert`, body), request('POST', `/leads/${lead.id}/convert`, body)]);
    const result = await Promise.all(responses.map((response) => data<{ record: { companyId: number } }>(response)));
    expect(result[0]!.record.companyId).toBe(result[1]!.record.companyId); expect(await db.company.count({ where: { firmId: a.firm.id, name: body.newCompany.name } })).toBe(1);
    const rollback = (await data<{ record: { id: number; version: number } }>(await request('POST', '/leads', { name: randomUUID(), ownerId: a.admin.id }), 201)).record;
    failAudit = true;
    try { expect((await request('POST', `/leads/${rollback.id}/convert`, { ...body, expectedVersion: rollback.version, idempotencyKey: randomUUID(), newCompany: { name: 'Audit rollback company' } })).status).toBe(500); } finally { failAudit = false; }
    expect(await db.company.count({ where: { firmId: a.firm.id, name: 'Audit rollback company' } })).toBe(0);
  });
  it('snapshots exact revisions and serializes duplicate conversion and completion events', async () => {
    const sourceRevisionId = await quote(); const body = { sourceRevisionId, idempotencyKey: randomUUID() };
    const converted = await Promise.all([request('POST', '/sales-orders/from-quotation', body), request('POST', '/sales-orders/from-quotation', body)]);
    const rows = await Promise.all(converted.map((response) => data<{ order: Order }>(response, 201))); const row = rows[0]!.order;
    expect(rows[1]!.order.id).toBe(row.id);
    const before = await db.salesOrder.findUniqueOrThrow({ where: { id: row.id } });
    await db.company.update({ where: { id: a.company.id }, data: { name: 'Master changed after order' } });
    expect((await db.salesOrder.findUniqueOrThrow({ where: { id: row.id } })).snapshot).toEqual(before.snapshot);
    const event = fulfillment(row, '4'); const completed = (await data<{ order: Order }>(await request('POST', '/fulfillments', event), 201)).order;
    await data(await request('POST', '/fulfillments', event), 201); expect(await db.fulfillment.count({ where: { salesOrderId: row.id } })).toBe(1); expect(completed.status).toBe('PARTIALLY_FULFILLED');
    expect((await request('POST', '/fulfillments', fulfillment(completed, '7'))).status).toBe(409);
    expect((await request('GET', `/sales-orders/${(await order(b)).id}`)).status).toBe(404);
    expect((await request('POST', '/fulfillments', { ...fulfillment(completed, '1'), lines: [{ salesOrderLineId: (await order(b)).lines[0]!.id, quantity: '1' }] })).status).toBe(404);
    const cancelled = (await data<{ order: Order }>(await request('POST', `/fulfillments/${completed.fulfillments[0]!.id}/cancel`, { expectedVersion: completed.version, reason: 'Delivery cancelled' }))).order;
    expect(cancelled.status).toBe('OPEN'); expect(cancelled.lines[0]!.fulfilled).toBe('0.000');
  });
  it('caps invoice reservations at completed quantities and releases cancelled drafts', async () => {
    let row = await order(); row = (await data<{ order: Order }>(await request('POST', '/fulfillments', fulfillment(row)), 201)).order;
    const concurrent = await Promise.all([request('POST', '/invoices/from-sales-order', invoiceInput(row, '6')), request('POST', '/invoices/from-sales-order', invoiceInput(row, '6'))]);
    expect(concurrent.filter((response) => response.status === 201)).toHaveLength(1); expect(concurrent.filter((response) => response.status === 409)).toHaveLength(1);
    const invoice = (await data<{ document: Invoice }>(concurrent.find((response) => response.status === 201)!, 201)).document;
    expect((await getOrder(row.id)).lines[0]!.available).toBe('4.000');
    expect((await request('POST', `/fulfillments/${row.fulfillments[0]!.id}/cancel`, { expectedVersion: row.version, reason: 'Cannot remove billed delivery' })).status).toBe(409);
    const cancel = { expectedVersion: invoice.version, reason: 'Abandoned invoice draft' };
    await data(await request('POST', `/invoices/${invoice.id}/cancel-order-draft`, cancel)); await data(await request('POST', `/invoices/${invoice.id}/cancel-order-draft`, cancel));
    expect((await getOrder(row.id)).lines[0]!.available).toBe('10.000');
    const full = (await data<{ document: Invoice }>(await request('POST', '/invoices/from-sales-order', invoiceInput(row, '10')), 201)).document;
    expect(full.grandTotal).toBe('100.00');
    const issued = (await data<{ document: Invoice }>(await request('POST', `/invoices/${full.id}/issue`, { expectedVersion: full.version, confirmedTotal: full.grandTotal }))).document;
    const quota = await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: 'quota:documents', effect: 'LIMIT', limit: 0n, startsAt: new Date(Date.now() - 1000), authorId: a.admin.id, reason: 'Disposable order PDF quota' } });
    try { expect((await request('POST', `/invoices/${issued.id}/pdf`, {})).status).toBe(409); expect(await db.invoiceDocument.count({ where: { invoiceId: issued.id } })).toBe(0); } finally { await db.firmFeatureOverride.delete({ where: { id: quota.id } }); }
    await data(await request('POST', `/invoices/${issued.id}/void`, { expectedVersion: issued.version, reason: 'Cancelled unreported same-day sale', notReportedAndSupplyCancelled: true }));
    expect((await getOrder(row.id)).lines[0]!.available).toBe('10.000');
  });
  it('keeps direct service quotation invoicing available without an order', async () => {
    const sourceRevisionId = await quote(); const quoteRow = await db.quotation.findUniqueOrThrow({ where: { id: sourceRevisionId }, include: { items: true } });
    await data(await request('POST', '/invoices/from-quotation', { sourceRevisionId, idempotencyKey: randomUUID(), supply, customFieldValues: {}, lineMetadata: quoteRow.items.map((line) => ({ lineNumber: line.lineNumber, hsnCode: null, supplyType: 'SERVICE' })) }), 201);
    expect((await request('POST', '/sales-orders/from-quotation', { sourceRevisionId, idempotencyKey: randomUUID() })).status).toBe(409);
  });
  it('restricts portal grants to the invited company and prevents object probing and CSRF', async () => {
    const session = await invite(); const foreign = await quote(b, false);
    expect((await request('POST', '/portal-access/grants', { identityId: session.identityId, quotationId: foreign, expiresAt: new Date(Date.now() + 86400000).toISOString() })).status).toBe(404);
    const shared = await share(session.identityId, await quote(a, false));
    const otherSession = await invite(b); const otherGrant = await share(otherSession.identityId, foreign, b);
    expect((await portal('GET', `/documents/${otherGrant.id}`, session.cookie)).status).toBe(404);
    const content = await data<{ snapshot: Record<string, unknown>; consent: string }>(await portal('GET', `/documents/${shared.id}`, session.cookie));
    expect(content.snapshot).not.toHaveProperty('internalNotes'); expect(content.snapshot).not.toHaveProperty('createdBy');
    expect((await portal('POST', '/decisions', session.cookie, { grantId: shared.id, snapshotHash: shared.snapshotHash, decision: 'ACCEPTED', consent: content.consent, idempotencyKey: randomUUID() }, 'invalid')).status).toBe(403);
    expect((await portal('POST', '/exchange', '', { token: session.token })).status).toBe(401);
    expect((await fetch(`${base}/api/v1/companies`, { headers: { Cookie: session.cookie } })).status).toBe(401);
  });
  it('records immutable revision acceptance once and fails closed on revoked, expired or stale access', async () => {
    const session = await invite(); const revision = await quote(a, false); const grant = await share(session.identityId, revision);
    const document = await data<{ consent: string }>(await portal('GET', `/documents/${grant.id}`, session.cookie));
    const body = { grantId: grant.id, snapshotHash: grant.snapshotHash, decision: 'ACCEPTED', consent: document.consent, idempotencyKey: randomUUID() };
    await data(await portal('POST', '/decisions', session.cookie, body, session.csrf)); await data(await portal('POST', '/decisions', session.cookie, body, session.csrf));
    expect(await db.documentAcceptance.count({ where: { quotationId: revision } })).toBe(1);
    expect(await db.documentAcceptance.findFirstOrThrow({ where: { quotationId: revision } })).toMatchObject({ identityId: session.identityId, companyId: a.company.id, snapshotHash: grant.snapshotHash, consent: document.consent });
    expect((await db.quotation.findUniqueOrThrow({ where: { id: revision } })).status).toBe('ACCEPTED');
    await data(await request('POST', `/portal-access/grant/${grant.id}/revoke`, {})); expect((await portal('GET', `/documents/${grant.id}`, session.cookie)).status).toBe(404);
    const next = await invite(); const staleId = await quote(a, false); const stale = await share(next.identityId, staleId);
    await db.quotation.update({ where: { id: staleId }, data: { paymentTerms: 'Changed terms' } });
    expect((await portal('POST', '/decisions', next.cookie, { ...body, grantId: stale.id, snapshotHash: stale.snapshotHash, idempotencyKey: randomUUID() }, next.csrf)).status).toBe(409);
    await db.portalSession.updateMany({ where: { identityId: next.identityId }, data: { expiresAt: new Date(Date.now() - 1000) } }); expect((await portal('GET', '/documents', next.cookie)).status).toBe(401);
    const expired = await data<{ token: string; invitationId: number }>(await request('POST', '/portal-access/invitations', { companyId: a.company.id, contactId: a.contact.id, expiresAt: new Date(Date.now() + 3600000).toISOString() }), 201);
    await db.portalInvitation.update({ where: { id: expired.invitationId }, data: { expiresAt: new Date(Date.now() - 1000) } }); expect((await portal('POST', '/exchange', '', { token: expired.token })).status).toBe(401);
  });
  it('rotates sessions on invitation exchange and denies revoked invitations and read-only decisions', async () => {
    const first = await invite();
    const replacement = await data<{ token: string; invitationId: number }>(await request('POST', '/portal-access/invitations', { companyId: a.company.id, contactId: a.contact.id, expiresAt: new Date(Date.now() + 3600000).toISOString() }), 201);
    const response = await portal('POST', '/exchange', first.cookie, { token: replacement.token }); const cookie = response.headers.get('set-cookie')!.split(';')[0]!; const next = await data<{ csrfToken: string }>(response);
    expect(cookie).not.toBe(first.cookie); expect((await portal('GET', '/documents', first.cookie)).status).toBe(401);
    const readonly = await share(first.identityId, await quote(a, false), a, false);
    const content = await data<{ consent: string }>(await portal('GET', `/documents/${readonly.id}`, cookie));
    expect((await portal('POST', '/decisions', cookie, { grantId: readonly.id, snapshotHash: readonly.snapshotHash, decision: 'ACCEPTED', consent: content.consent, idempotencyKey: randomUUID() }, next.csrfToken)).status).toBe(403);
    await data(await request('POST', `/portal-access/invitation/${replacement.invitationId}/revoke`, {})); expect((await portal('GET', '/documents', cookie)).status).toBe(401);
    const revoked = await data<{ token: string; invitationId: number }>(await request('POST', '/portal-access/invitations', { companyId: a.company.id, contactId: a.contact.id, expiresAt: new Date(Date.now() + 3600000).toISOString() }), 201);
    await data(await request('POST', `/portal-access/invitation/${revoked.invitationId}/revoke`, {})); expect((await portal('POST', '/exchange', '', { token: revoked.token })).status).toBe(401);
  });
  it('rolls back portal decisions when required audit fails and rejects conflicting replays', async () => {
    const session = await invite(); const revision = await quote(a, false); const grant = await share(session.identityId, revision);
    const content = await data<{ consent: string }>(await portal('GET', `/documents/${grant.id}`, session.cookie));
    const body = { grantId: grant.id, snapshotHash: grant.snapshotHash, decision: 'ACCEPTED', consent: content.consent, idempotencyKey: randomUUID() };
    failAudit = true; try { expect((await portal('POST', '/decisions', session.cookie, body, session.csrf)).status).toBe(500); } finally { failAudit = false; }
    expect(await db.documentAcceptance.count({ where: { quotationId: revision } })).toBe(0); expect((await db.quotation.findUniqueOrThrow({ where: { id: revision } })).status).toBe('SENT');
    const responses = await Promise.all([portal('POST', '/decisions', session.cookie, body, session.csrf), portal('POST', '/decisions', session.cookie, body, session.csrf)]);
    for (const response of responses) await data(response);
    expect(await db.documentAcceptance.count({ where: { quotationId: revision } })).toBe(1);
    expect((await portal('POST', '/decisions', session.cookie, { ...body, decision: 'REJECTED' }, session.csrf)).status).toBe(409);
  });
  it('enforces assigned CRM scope, roles, denied plans, expired overrides, global kills and firm suspension', async () => {
    const paths = ['/leads', '/opportunities', '/tasks', '/sales-orders', '/portal-access'];
    for (const path of paths) expect((await request('GET', path, undefined, a.reader.id)).status).toBe(403);
    await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: ['crm.view', 'crm.manage'] } });
    try { const list = await data<{ records: unknown[] }>(await request('GET', '/leads', undefined, a.reader.id)); expect(list.records).toHaveLength(0); } finally { await db.firmRole.update({ where: { id: a.role.id }, data: { permissions: ['quotations.view'] } }); }
    const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const excluded = await db.planVersion.create({ data: { planId, revision: 2, createdById: a.admin.id, policy: LEGACY_POLICY, features: { create: [{ featureKey: 'firm.core' }, { featureKey: 'companies' }] } } });
    await fixture.publishPlanVersion(excluded.id);
    const sub = await db.firmSubscription.findFirstOrThrow({ where: { firmId: a.firm.id } }); await db.firmSubscription.update({ where: { id: sub.id }, data: { planVersionId: excluded.id } });
    try {
      for (const key of ['crm', 'sales.orders', 'customer.portal']) await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: `feature:${key}`, effect: 'ALLOW', authorId: a.admin.id, reason: 'Expired fixture', startsAt: new Date(Date.now() - 20000), expiresAt: new Date(Date.now() - 10000) } });
      for (const path of paths) expect((await request('GET', path)).status).toBe(403);
    } finally { await db.firmFeatureOverride.deleteMany({ where: { firmId: a.firm.id } }); await db.firmSubscription.update({ where: { id: sub.id }, data: { planVersionId } }); }
    for (const [key, path] of [['crm','/leads'],['sales.orders','/sales-orders'],['customer.portal','/portal-access']] as const) {
      await db.platformFeatureSwitch.create({ data: { key, hardDisabled: true, authorId: a.admin.id, reason: 'Disposable kill' } }); try { expect((await request('GET', path)).status).toBe(403); } finally { await db.platformFeatureSwitch.delete({ where: { key } }); }
    }
    await db.firm.update({ where: { id: a.firm.id }, data: { status: 'SUSPENDED' } }); try { for (const path of paths) expect((await request('GET', path)).status).toBe(403); } finally { await db.firm.update({ where: { id: a.firm.id }, data: { status: 'ACTIVE' } }); }
  });
});
