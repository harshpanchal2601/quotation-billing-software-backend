import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TwoFirmFixture, assertDisposableTenantDatabase, type TenantFixture } from './helpers/two-firm-fixture.js';

const testUrl = process.env.WAVE07_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
type Order = { id: number; version: number; status: string; lines: Array<{ id: number; quantity: string; receivedQuantity: string }> };
type Receipt = { id: number; lines: Array<{ id: number; purchaseOrderLineId: number; quantity: string; returnedQuantity: string }> };
type Sale = { id: number; version: number; status: string; lines: Array<{ id: number }>; fulfillments: Array<{ id: number }> };
type Bill = { id: number; version: number; status: string; total: string };

suite('Wave 07 authenticated inventory and purchasing with disposable MySQL', () => {
  let db: PrismaClient; let fixture: TwoFirmFixture; let a: TenantFixture; let b: TenantFixture; let server: Server; let base: string; let origin: string; let planId: number; let planVersionId: number;
  const cookies = new Map<number, string>(); let failAudit = false;
  const warehouses = new Map<number, number>();
  async function request(method: string, path: string, body?: unknown, actorId = a.admin.id) { return fetch(`${base}/api/v1${path}`, { method, headers: { Cookie: cookies.get(actorId)!, Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  async function data<T>(response: Response, status = 200): Promise<T> { expect(response.status, await response.clone().text()).toBe(status); return (await response.json() as { data: T }).data; }
  async function item(tenant = a, tracking = true, kind: 'GOODS' | 'SERVICE' = 'GOODS') { return db.item.create({ data: { firmId: tenant.firm.id, itemCode: randomUUID(), name: `Inventory ${randomUUID()}`, categoryId: tenant.category.id, measurementUnitId: tenant.unit.id, kind, stockTracking: tracking } }); }
  async function purchase(itemId: number, quantity = '10', unitCost = '2.00', tenant = a) {
    const created = (await data<{ record: Order }>(await request('POST', '/purchase-orders', { supplierId: tenant.company.id, taxMode: 'NONE', idempotencyKey: randomUUID(), lines: [{ itemId, description: 'Purchased goods', quantity, unitCost, taxRate: '0' }] }, tenant.admin.id), 201)).record;
    return (await data<{ record: Order }>(await request('POST', `/purchase-orders/${created.id}/approve`, { expectedVersion: created.version, reason: 'Approved fixture purchase' }, tenant.admin.id))).record;
  }
  async function receive(order: Order, quantity = '10', tenant = a) {
    const body = { purchaseOrderId: order.id, expectedVersion: order.version, warehouseId: warehouses.get(tenant.firm.id), reference: randomUUID(), idempotencyKey: randomUUID(), lines: [{ purchaseOrderLineId: order.lines[0]!.id, quantity }] };
    const row = (await data<{ record: Receipt }>(await request('POST', '/goods-receipts', body, tenant.admin.id), 201)).record;
    return { row, body };
  }
  async function order(id: number) { return (await data<{ record: Order }>(await request('GET', `/purchase-orders/${id}`))).record; }
  async function availability(itemId: number) { return data<{ positions: Array<{ id: number; onHand: string; available: string; reserved: string; value: string; reconciled: boolean; lowStock: boolean; openingQuantity: string; closingQuantity: string }>; pagination: { total: number } }>(await request('GET', `/stock/availability?itemId=${itemId}`)); }
  async function sale(itemId: number, quantity = '20') {
    const quotation = (await data<{ quotation: { id: number } }>(await request('POST', '/quotations', { companyId: a.company.id, billingAddressId: a.address.id, quotationDate: new Date().toISOString().slice(0, 10), currency: 'INR', taxMode: 'NONE', items: [{ itemId, itemName: 'Tracked sale', measurementUnit: 'KG', quantity, unitRate: '10', gstRate: '0' }] }), 201)).quotation;
    await data(await request('PATCH', `/quotations/${quotation.id}/status`, { status: 'SENT' })); await data(await request('PATCH', `/quotations/${quotation.id}/status`, { status: 'ACCEPTED' }));
    return (await data<{ order: Sale }>(await request('POST', '/sales-orders/from-quotation', { sourceRevisionId: quotation.id, idempotencyKey: randomUUID() }), 201)).order;
  }
  function dispatch(row: Sale, quantity: string) { return { salesOrderId: row.id, expectedVersion: row.version, reference: randomUUID(), occurredAt: new Date().toISOString(), idempotencyKey: randomUUID(), lines: [{ salesOrderLineId: row.lines[0]!.id, quantity, warehouseId: warehouses.get(a.firm.id) }] }; }
  function bill(receipt: Receipt, supplierId = a.company.id, quantity = '10') { return { supplierId, supplierReference: randomUUID(), billDate: new Date().toISOString().slice(0, 10), taxMode: 'NONE', idempotencyKey: randomUUID(), lines: [{ goodsReceiptLineId: receipt.lines[0]!.id, description: 'Purchased goods', quantity, unitCost: '2.00', taxRate: '0' }] }; }

  beforeAll(async () => {
    assertDisposableTenantDatabase(testUrl!, '07');
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', testUrl!); vi.stubEnv('JWT_ACCESS_SECRET', 'wave07-disposable-access-secret'); vi.stubEnv('JWT_REFRESH_SECRET', 'wave07-disposable-refresh-secret');
    db = new PrismaClient({ datasources: { db: { url: testUrl! } } });
    const applied = await db.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE migration_name = '20261108120000_wave07_inventory_purchasing' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(applied).toHaveLength(1);
    db.$use(async (params, next) => { if (failAudit && params.model === 'AuditLog' && params.action === 'create') throw new Error('Injected audit failure'); return next(params); });
    vi.doMock('../src/core/database/prisma.js', () => ({ prisma: db }));
    vi.doMock('../src/integrations/mail/index.js', () => ({ mailService: { send: vi.fn().mockRejectedValue(new Error('External mail disabled')) } }));
    vi.doMock('../src/integrations/documents/index.js', () => ({ renderAndStorePdf: vi.fn().mockRejectedValue(new Error('External rendering disabled')) }));
    fixture = new TwoFirmFixture(db); a = await fixture.createTenant('inventory-A'); b = await fixture.createTenant('inventory-B');
    const { FEATURE_KEYS } = await import('../src/modules/entitlements/feature-registry.js'); const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const plan = await db.plan.create({ data: { name: 'Wave07 fixture', slug: `wave07-${randomUUID()}`, versions: { create: { revision: 1, createdById: a.admin.id, policy: LEGACY_POLICY, features: { create: FEATURE_KEYS.map((featureKey) => ({ featureKey })) }, quotas: { create: ['users', 'documents', 'storageBytes', 'aiCredits'].map((resource) => ({ resource, limit: null })) } } } }, include: { versions: true } });
    await fixture.publishPlanVersion(plan.versions[0]!.id); planId = plan.id; planVersionId = plan.versions[0]!.id;
    for (const tenant of [a, b]) { await db.firmSubscription.create({ data: { firmId: tenant.firm.id, planVersionId, status: 'ACTIVE', authorId: tenant.admin.id, reason: 'Disposable inventory fixture', effectiveFrom: new Date(Date.now() - 1000) } }); await db.company.update({ where: { id: tenant.company.id }, data: { isSupplier: true } }); await db.measurementUnit.update({ where: { id: tenant.unit.id }, data: { allowDecimal: true } }); }
    const { generateAccessToken } = await import('../src/modules/auth/security/auth.tokens.js'); const { ACCESS_TOKEN_COOKIE_NAME } = await import('../src/modules/auth/auth.constants.js');
    for (const actor of [a.admin, a.reader, b.admin]) { const session = await db.authSession.create({ data: { userId: actor.id, refreshTokenHash: 'unused', expiresAt: new Date(Date.now() + 3600000) } }); cookies.set(actor.id, `${ACCESS_TOKEN_COOKIE_NAME}=${generateAccessToken({ userId: actor.id, role: actor.role, sessionId: session.id })}`); }
    origin = new URL((await import('../src/config/env.js')).env.FRONTEND_URL).origin;
    const { app } = await import('../src/bootstrap/app.js'); server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Disposable listener unavailable'); base = `http://127.0.0.1:${address.port}`;
    for (const tenant of [a, b]) { const row = await data<{ warehouse: { id: number } }>(await request('POST', '/warehouses', { code: `WH-${tenant.firm.id}`, name: `Warehouse ${tenant.firm.id}` }, tenant.admin.id), 201); warehouses.set(tenant.firm.id, row.warehouse.id); }
  }, 60000);
  afterAll(async () => { try { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); if (fixture) await fixture.cleanup(); if (planId) await db.plan.update({ where: { id: planId }, data: { archivedAt: new Date() } }); } finally { if (db) await db.$disconnect(); vi.doUnmock('../src/core/database/prisma.js'); vi.doUnmock('../src/integrations/mail/index.js'); vi.doUnmock('../src/integrations/documents/index.js'); vi.unstubAllEnvs(); } }, 60000);

  it('keeps catalog defaults untracked and rejects service inventory and foreign item probes', async () => {
    expect(a.item.stockTracking).toBe(false); expect(a.item.kind).toBe('GOODS');
    const service = await item(a, false, 'SERVICE');
    expect((await request('PUT', `/items/${service.id}/inventory`, { stockTracking: true })).status).toBe(409);
    expect((await request('PUT', `/items/${b.item.id}/inventory`, { stockTracking: true })).status).toBe(404);
    await data(await request('PUT', `/items/${a.item.id}/inventory`, { stockTracking: true }));
    const empty = await availability(a.item.id); expect(empty.positions).toHaveLength(0);
  });
  it('receives partial orders exactly once under concurrent retries and reconciles every posting', async () => {
    const sku = await item(); const po = await purchase(sku.id);
    const first = await receive(po, '4');
    await data(await request('POST', '/goods-receipts', first.body), 201);
    const partial = await order(po.id); expect(partial.status).toBe('PARTIALLY_RECEIVED');
    const next = { ...first.body, expectedVersion: partial.version, idempotencyKey: randomUUID(), lines: [{ purchaseOrderLineId: po.lines[0]!.id, quantity: '6' }] };
    const responses = await Promise.all([request('POST', '/goods-receipts', next), request('POST', '/goods-receipts', next)]);
    const received = await Promise.all(responses.map((response) => data<{ record: Receipt }>(response, 201)));
    expect(received[0]!.record.id).toBe(received[1]!.record.id);
    expect((await order(po.id)).status).toBe('RECEIVED');
    const position = (await availability(sku.id)).positions[0]!; expect(position).toMatchObject({ onHand: '10.000', value: '20.000000', reconciled: true });
    expect(await db.stockMovement.count({ where: { firmId: a.firm.id, positionId: position.id, eventType: 'RECEIVE' } })).toBe(2);
    expect((await request('POST', '/goods-receipts', { ...next, idempotencyKey: randomUUID() })).status).toBe(409);
  });
  it('prevents parallel reservation oversubscription, consumes once on dispatch and compensates cancellation', async () => {
    const sku = await item(); await receive(await purchase(sku.id)); const so = await sale(sku.id);
    const reserve = { salesOrderId: so.id, salesOrderLineId: so.lines[0]!.id, warehouseId: warehouses.get(a.firm.id), quantity: '7', idempotencyKey: randomUUID() };
    const attempts = await Promise.all([request('POST', '/stock/reservations', reserve), request('POST', '/stock/reservations', { ...reserve, idempotencyKey: randomUUID() })]);
    expect(attempts.map((response) => response.status).sort()).toEqual([201, 409]);
    const event = dispatch(so, '7'); const completed = await Promise.all([request('POST', '/fulfillments', event), request('POST', '/fulfillments', event)]);
    const result = await Promise.all(completed.map((response) => data<{ order: Sale }>(response, 201)));
    const after = (await availability(sku.id)).positions[0]!; expect(after).toMatchObject({ onHand: '3.000', reserved: '0.000', value: '6.000000', reconciled: true });
    expect(await db.stockMovement.count({ where: { positionId: after.id, eventType: 'DISPATCH' } })).toBe(1);
    const row = result[0]!.order; await data(await request('POST', `/fulfillments/${row.fulfillments[0]!.id}/cancel`, { expectedVersion: row.version, reason: 'Cancelled physical dispatch' }));
    expect((await availability(sku.id)).positions[0]).toMatchObject({ onHand: '10.000', reserved: '0.000', reconciled: true });
  });
  it('releases order reservations on cancellation and blocks unreserved negative dispatch', async () => {
    const sku = await item(); await receive(await purchase(sku.id)); const so = await sale(sku.id);
    await data(await request('POST', '/stock/reservations', { salesOrderId: so.id, salesOrderLineId: so.lines[0]!.id, warehouseId: warehouses.get(a.firm.id), quantity: '10', idempotencyKey: randomUUID() }), 201);
    await data(await request('POST', `/sales-orders/${so.id}/cancel`, { expectedVersion: so.version, reason: 'Customer cancelled order' }));
    expect((await availability(sku.id)).positions[0]).toMatchObject({ reserved: '0.000', available: '10.000', reconciled: true });
    const other = await sale(sku.id); expect((await request('POST', '/fulfillments', dispatch(other, '11'))).status).toBe(409);
    expect((await availability(sku.id)).positions[0]!.onHand).toBe('10.000');
  });
  it('balances transfers, caps returns and restores partial receipt commitments', async () => {
    const sku = await item(); const po = await purchase(sku.id); const { row: receipt } = await receive(po);
    const warehouse = (await data<{ warehouse: { id: number } }>(await request('POST', '/warehouses', { code: `SECOND-${sku.id}`, name: 'Secondary location' }), 201)).warehouse;
    const transfer = { fromWarehouseId: warehouses.get(a.firm.id), toWarehouseId: warehouse.id, itemId: sku.id, quantity: '3', reason: 'Transfer and receive fixture', idempotencyKey: randomUUID() };
    await data(await request('POST', '/stock/transfers', transfer), 201); await data(await request('POST', '/stock/transfers', transfer), 201);
    const movements = await db.stockMovement.findMany({ where: { firmId: a.firm.id, position: { itemId: sku.id }, eventType: { in: ['TRANSFER_OUT', 'TRANSFER_IN'] } } });
    expect(movements).toHaveLength(2); expect(movements[0]!.quantity.add(movements[1]!.quantity).isZero()).toBe(true); expect(movements[0]!.value.add(movements[1]!.value).isZero()).toBe(true);
    const beforeForeignTransfer = (await availability(sku.id)).positions;
    expect((await request('POST', '/stock/transfers', { ...transfer, toWarehouseId: warehouses.get(b.firm.id), idempotencyKey: randomUUID() })).status).toBe(404);
    expect((await availability(sku.id)).positions).toEqual(beforeForeignTransfer);
    const ret = { receiptLineId: receipt.lines[0]!.id, quantity: '2', reason: 'Supplier accepted defective goods', idempotencyKey: randomUUID() };
    await data(await request('POST', `/goods-receipts/${receipt.id}/returns`, ret), 201); await data(await request('POST', `/goods-receipts/${receipt.id}/returns`, ret), 201);
    expect((await order(po.id)).lines[0]!.receivedQuantity).toBe('8');
    expect((await request('POST', `/goods-receipts/${receipt.id}/returns`, { ...ret, quantity: '9', idempotencyKey: randomUUID() })).status).toBe(409);
    expect((await availability(sku.id)).positions.every((row) => row.reconciled)).toBe(true);
  });
  it('matches supplier bills without sales revenue and serializes duplicate receipt billing', async () => {
    const sku = await item(); const po = await purchase(sku.id); const receipt = (await receive(po)).row;
    const countBefore = await db.invoice.count({ where: { firmId: a.firm.id } });
    const body = bill(receipt);
    const draft = (await data<{ record: Bill }>(await request('POST', '/supplier-bills', body), 201)).record;
    const another = (await data<{ record: Bill }>(await request('POST', '/supplier-bills', { ...body, supplierReference: randomUUID(), idempotencyKey: randomUUID() }), 201)).record;
    const posted = await Promise.all([request('POST', `/supplier-bills/${draft.id}/post`, { expectedVersion: draft.version, reason: 'Supplier bill approved' }), request('POST', `/supplier-bills/${another.id}/post`, { expectedVersion: another.version, reason: 'Supplier bill approved' })]);
    expect(posted.map((response) => response.status).sort()).toEqual([200, 409]); expect(await db.invoice.count({ where: { firmId: a.firm.id } })).toBe(countBefore);
    expect((await request('POST', `/goods-receipts/${receipt.id}/returns`, { receiptLineId: receipt.lines[0]!.id, quantity: '1', reason: 'Billed goods return', idempotencyKey: randomUUID() })).status).toBe(409);
    expect((await request('POST', '/supplier-bills', { ...body, idempotencyKey: randomUUID() })).status).toBe(409);
  });
  it('isolates lists, direct and nested identifiers, reference options, ledger and audit history', async () => {
    const foreignSku = await item(b); const foreignPo = await purchase(foreignSku.id, '10', '2.00', b); const foreignReceipt = (await receive(foreignPo, '10', b)).row;
    const foreignBill = (await data<{ record: Bill }>(await request('POST', '/supplier-bills', bill(foreignReceipt, b.company.id), b.admin.id), 201)).record;
    for (const path of [`/purchase-orders/${foreignPo.id}`, `/goods-receipts/${foreignReceipt.id}`, `/supplier-bills/${foreignBill.id}`]) expect((await request('GET', path)).status).toBe(404);
    for (const path of ['/stock/availability', '/stock/movements', '/stock/reports', '/stock/reservations']) {
      const result = await data<Record<string, unknown>>(await request('GET', `${path}?warehouseId=${warehouses.get(b.firm.id)}`));
      expect((result.pagination as { total: number }).total).toBe(0);
    }
    expect((await request('POST', '/goods-receipts', { purchaseOrderId: foreignPo.id, expectedVersion: foreignPo.version, reference: 'Foreign receipt probe', idempotencyKey: randomUUID(), lines: [{ purchaseOrderLineId: foreignPo.lines[0]!.id, quantity: '1' }] })).status).toBe(404);
    const billCounts = async () => Promise.all([db.supplierBill.count(), db.supplierBillLine.count(), db.auditLog.count({ where: { entityType: 'SupplierBill' } })]);
    const beforeDeniedBills = await billCounts();
    expect((await request('POST', '/supplier-bills', bill(foreignReceipt))).status).toBe(404);
    const foreignOrderBill = bill(foreignReceipt);
    expect((await request('POST', '/supplier-bills', { ...foreignOrderBill, lines: foreignOrderBill.lines.map((line) => ({ description: line.description, quantity: line.quantity, unitCost: line.unitCost, taxRate: line.taxRate, purchaseOrderLineId: foreignPo.lines[0]!.id })) })).status).toBe(404);
    expect(await billCounts()).toEqual(beforeDeniedBills);
    expect((await request('POST', '/stock/transfers', { fromWarehouseId: warehouses.get(b.firm.id), toWarehouseId: warehouses.get(a.firm.id), itemId: foreignSku.id, quantity: '1', reason: 'Foreign warehouse probe', idempotencyKey: randomUUID() })).status).toBe(404);
    const list = await data<{ records: Array<{ id: number }> }>(await request('GET', `/purchase-orders?supplierId=${b.company.id}`)); expect(list.records).toHaveLength(0);
    const options = await data<{ suppliers: Array<{ id: number }>; items: Array<{ id: number }> }>(await request('GET', '/purchase-orders/reference-options')); expect(options.suppliers.some((row) => row.id === b.company.id)).toBe(false); expect(options.items.some((row) => row.id === foreignSku.id)).toBe(false);
    const audit = await data<{ auditLogs: Array<{ firmId: number }> }>(await request('GET', '/audit-logs?entityType=SupplierBill')); expect(audit.auditLogs.every((row) => row.firmId === a.firm.id)).toBe(true);
  });
  it('requires both plan and role, honors global kills, expired grants and suspended firms', async () => {
    let excludedRevision = 2;
    const { FEATURE_KEYS } = await import('../src/modules/entitlements/feature-registry.js');
    const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    for (const [featureKey, path, writePath] of [['inventory', '/stock/availability', '/stock/adjustments'], ['purchasing', '/purchase-orders', '/purchase-orders'], ['purchasing.bills', '/supplier-bills', '/supplier-bills'], ['expenses', '/expenses', '/expenses']] as const) {
      await data(await request('GET', path)); expect((await request('GET', path, undefined, a.reader.id)).status).toBe(403);
      expect((await request('POST', writePath, {}, a.reader.id)).status).toBe(403);
      const excluded = await db.planVersion.create({ data: { planId, revision: excludedRevision++, createdById: a.admin.id, policy: LEGACY_POLICY, features: { create: FEATURE_KEYS.filter((key) => key !== featureKey).map((key) => ({ featureKey: key })) } } });
      await fixture.publishPlanVersion(excluded.id);
      const subscription = await db.firmSubscription.findFirstOrThrow({ where: { firmId: a.firm.id } });
      await db.firmSubscription.update({ where: { id: subscription.id }, data: { planVersionId: excluded.id } });
      try {
        expect((await request('GET', path)).status).toBe(403);
        expect((await request('POST', writePath, {})).status).toBe(403);
        const grant = await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: `feature:${featureKey}`, effect: 'ALLOW', startsAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000), authorId: a.admin.id, reason: 'Expired fixture override' } });
        try { expect((await request('GET', path)).status).toBe(403); } finally { await db.firmFeatureOverride.delete({ where: { id: grant.id } }); }
      } finally { await db.firmSubscription.update({ where: { id: subscription.id }, data: { planVersionId } }); }
      await db.platformFeatureSwitch.create({ data: { key: featureKey, hardDisabled: true, authorId: a.admin.id, reason: 'Disposable feature kill' } });
      try { expect((await request('GET', path)).status).toBe(403); expect((await request('POST', writePath, {})).status).toBe(403); } finally { await db.platformFeatureSwitch.delete({ where: { key: featureKey } }); }
    }
    await db.firm.update({ where: { id: a.firm.id }, data: { status: 'SUSPENDED' } });
    try { for (const path of ['/stock/availability', '/purchase-orders', '/supplier-bills', '/expenses']) expect((await request('GET', path)).status).toBe(403); } finally { await db.firm.update({ where: { id: a.firm.id }, data: { status: 'ACTIVE' } }); }
  });
  it('rolls back ledger and source documents on required audit failure and allows exact retry', async () => {
    const sku = await item(); const po = await purchase(sku.id);
    const body = { purchaseOrderId: po.id, expectedVersion: po.version, reference: randomUUID(), warehouseId: warehouses.get(a.firm.id), idempotencyKey: randomUUID(), lines: [{ purchaseOrderLineId: po.lines[0]!.id, quantity: '10' }] };
    failAudit = true; try { expect((await request('POST', '/goods-receipts', body)).status).toBe(500); } finally { failAudit = false; }
    expect(await db.goodsReceipt.count({ where: { firmId: a.firm.id, idempotencyKey: body.idempotencyKey } })).toBe(0); expect((await availability(sku.id)).positions).toHaveLength(0);
    await data(await request('POST', '/goods-receipts', body), 201); expect((await availability(sku.id)).positions[0]!.reconciled).toBe(true);
  });
  it('records service purchases, standalone expenses and period/threshold reports without stock requirements', async () => {
    const service = await item(a, false, 'SERVICE'); const po = await purchase(service.id, '0.125');
    const receipt = { purchaseOrderId: po.id, expectedVersion: po.version, reference: randomUUID(), idempotencyKey: randomUUID(), lines: [{ purchaseOrderLineId: po.lines[0]!.id, quantity: '0.125' }] };
    await data(await request('POST', '/goods-receipts', receipt), 201); expect((await availability(service.id)).positions).toHaveLength(0);
    const recorded = (await data<{ record: Receipt }>(await request('POST', '/goods-receipts', receipt), 201)).record;
    const serviceReturn = { receiptLineId: recorded.lines[0]!.id, quantity: '0.025', reason: 'Partial non-stock supplier return', idempotencyKey: randomUUID() };
    const returned = (await data<{ record: { id: number } }>(await request('POST', `/goods-receipts/${recorded.id}/returns`, serviceReturn), 201)).record;
    const replay = (await data<{ record: { id: number } }>(await request('POST', `/goods-receipts/${recorded.id}/returns`, serviceReturn), 201)).record;
    expect(replay.id).toBe(returned.id); expect((await availability(service.id)).positions).toHaveLength(0);
    const returnHistory = await data<{ records: Array<{ id: number }> }>(await request('GET', `/goods-receipts/${recorded.id}/returns`)); expect(returnHistory.records.map((row) => row.id)).toContain(returned.id);
    const expense = { reference: randomUUID(), expenseDate: '2026-11-01', category: 'Office', description: 'Office expense', amount: '1.23', taxRate: '0', taxMode: 'NONE', idempotencyKey: randomUUID() };
    const first = (await data<{ record: { id: number } }>(await request('POST', '/expenses', expense), 201)).record; const repeated = (await data<{ record: { id: number } }>(await request('POST', '/expenses', expense), 201)).record; expect(repeated.id).toBe(first.id);
    const sku = await item(); await receive(await purchase(sku.id)); await data(await request('PUT', '/stock/reorder-level', { warehouseId: warehouses.get(a.firm.id), itemId: sku.id, quantity: '10' })); expect((await availability(sku.id)).positions[0]!.lowStock).toBe(true);
    const report = await data<{ positions: Array<{ openingQuantity: string; closingQuantity: string; reconciled: boolean }> }>(await request('GET', `/stock/reports?itemId=${sku.id}&from=2000-01-01&to=2099-12-31`)); expect(report.positions[0]).toMatchObject({ openingQuantity: '0.000', closingQuantity: '10.000', reconciled: true });
  });
  it('compensates receipt cancellation and preserves historical catalog/financial policy contracts', async () => {
    const sku = await item(); const po = await purchase(sku.id); const receipt = (await receive(po)).row;
    const current = await order(po.id);
    await data(await request('POST', `/goods-receipts/${receipt.id}/cancel`, { expectedVersion: current.version, reason: 'Receipt entered in error' }));
    expect((await availability(sku.id)).positions[0]).toMatchObject({ onHand: '0.000', value: '0.000000', reconciled: true });
    expect((await order(po.id)).status).toBe('APPROVED');
    expect((await request('DELETE', `/items/${sku.id}`)).status).toBe(409);
    expect((await request('PUT', `/items/${sku.id}`, { kind: 'SERVICE' })).status).toBe(409);
    expect((await request('PUT', `/items/${sku.id}/inventory`, { stockTracking: false })).status).toBe(409);
    expect((await request('DELETE', `/companies/${a.company.id}`)).status).toBe(409);
    expect((await request('PUT', `/measurement-units/${a.unit.id}`, { allowDecimal: false })).status).toBe(409);
  });
  it('keeps generated-document quota separate from operational stock without creating customer AR', async () => {
    const quota = await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: 'quota:documents', effect: 'LIMIT', limit: 0n, startsAt: new Date(), authorId: a.admin.id, reason: 'Exhausted generated-document quota' } });
    try {
      const before = await db.invoice.count({ where: { firmId: a.firm.id } });
      const sku = await item(); await receive(await purchase(sku.id));
      expect((await availability(sku.id)).positions[0]!.reconciled).toBe(true);
      expect(await db.invoice.count({ where: { firmId: a.firm.id } })).toBe(before);
      expect(await db.invoiceDocument.count({ where: { firmId: a.firm.id } })).toBe(0);
    } finally { await db.firmFeatureOverride.delete({ where: { id: quota.id } }); }
  });
  it('keeps service purchasing and returns usable when the inventory feature is disabled', async () => {
    const block = await db.firmFeatureOverride.create({ data: { firmId: a.firm.id, target: 'feature:inventory', effect: 'DENY', startsAt: new Date(), authorId: a.admin.id, reason: 'Service firm without inventory' } });
    try {
      const sku = await item(a, false, 'SERVICE'); const po = await purchase(sku.id, '1');
      const receipt = (await data<{ record: Receipt }>(await request('POST', '/goods-receipts', { purchaseOrderId: po.id, expectedVersion: po.version, reference: randomUUID(), idempotencyKey: randomUUID(), lines: [{ purchaseOrderLineId: po.lines[0]!.id, quantity: '1' }] }), 201)).record;
      await data(await request('POST', `/goods-receipts/${receipt.id}/returns`, { receiptLineId: receipt.lines[0]!.id, quantity: '0.125', reason: 'Service purchase adjustment', idempotencyKey: randomUUID() }), 201);
      expect(await db.stockMovement.count({ where: { firmId: a.firm.id, position: { itemId: sku.id } } })).toBe(0);
    } finally { await db.firmFeatureOverride.delete({ where: { id: block.id } }); }
  });
});
