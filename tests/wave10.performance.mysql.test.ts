import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TwoFirmFixture, assertDisposableTenantDatabase, type TenantFixture } from './helpers/two-firm-fixture.js';

const url = process.env.WAVE10_PERF_DATABASE_URL;
const suite = process.env.WAVE10_PERF_ENABLED === '1' && url ? describe : describe.skip;

suite('Wave 10 opt-in large-tenant source reporting baseline', () => {
  let db: PrismaClient; let fixture: TwoFirmFixture; let a: TenantFixture; let b: TenantFixture;
  let planId: number;
  let reports: import('../src/modules/reports/reports.repository.js').ReportsRepository;
  beforeAll(async () => {
    assertDisposableTenantDatabase(url!, '10');
    if (!/^\/wave10_test_perf_[a-zA-Z0-9_]+$/.test(new URL(url!).pathname)) throw new Error('Performance fixtures require a dedicated local wave10_test_perf_<suffix> database');
    vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('DATABASE_URL', url!); vi.stubEnv('OUTBOX_WORKER_ENABLED', 'false');
    db = new PrismaClient({ datasources: { db: { url: url! } } }); fixture = new TwoFirmFixture(db);
    vi.doMock('../src/core/database/prisma.js', () => ({ prisma: db }));
    a = await fixture.createTenant('performance-A'); b = await fixture.createTenant('performance-B');
    const { FEATURE_KEYS } = await import('../src/modules/entitlements/feature-registry.js');
    const { LEGACY_POLICY } = await import('../src/modules/entitlements/entitlements.schema.js');
    const plan = await db.plan.create({ data: { name: 'Disposable performance fixture', slug: `perf-${randomUUID()}`, versions: { create: { revision: 1, publishedAt: new Date(), createdById: a.admin.id, policy: LEGACY_POLICY, features: { create: FEATURE_KEYS.map((featureKey) => ({ featureKey })) } } } }, include: { versions: true } }); planId = plan.id;
    for (const tenant of [a, b]) await db.firmSubscription.create({ data: { firmId: tenant.firm.id, planVersionId: plan.versions[0]!.id, status: 'ACTIVE', authorId: tenant.admin.id, reason: 'Disposable performance fixture', effectiveFrom: new Date(Date.now() - 1000) } });
    const { ReportsRepository } = await import('../src/modules/reports/reports.repository.js'); reports = new ReportsRepository(db);
    for (const tenant of [a, b]) {
      const unitValue = tenant.firm.id === a.firm.id ? '1' : '2';
      for (let offset = 0; offset < 100_000; offset += 1000) {
        const rows: Prisma.InvoiceCreateManyInput[] = Array.from({ length: 1000 }, (_, index) => ({ firmId: tenant.firm.id, companyId: tenant.company.id, kind: 'INVOICE', status: 'ISSUED', invoiceDate: new Date('2026-11-05'), currency: (offset + index) % 2 ? 'USD' : 'INR', buyerSnapshot: {}, customFieldSchema: [], customFieldValues: {}, presentationSnapshot: {}, supplySnapshot: {}, financialPolicySnapshot: {}, subtotal: unitValue, discountAmount: '0', taxableAmount: unitValue, taxAmount: '0', roundOffAmount: '0', grandTotal: unitValue, idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64), createdById: tenant.admin.id, updatedById: tenant.admin.id }));
        await db.invoice.createMany({ data: rows });
      }
      const warehouse = await db.warehouse.create({ data: { firmId: tenant.firm.id, name: 'Performance source warehouse', code: randomUUID() } });
      const position = await db.stockPosition.create({ data: { firmId: tenant.firm.id, warehouseId: warehouse.id, itemId: tenant.item.id, currency: 'INR', onHand: '1000000', value: unitValue === '1' ? '1000000' : '2000000' } });
      for (let offset = 0; offset < 1_000_000; offset += 2000) await db.stockMovement.createMany({ data: Array.from({ length: 2000 }, (_, index) => ({ firmId: tenant.firm.id, positionId: position.id, sourceType: 'PERFORMANCE_FIXTURE', sourceId: position.id, sourceLineId: offset + index + 1, eventType: 'ADJUST', quantity: '1', value: unitValue, reason: 'Disposable performance source fixture', actorId: tenant.admin.id, postedAt: new Date('2026-11-05') })) });
    }
  }, 1_800_000);
  afterAll(async () => {
    try { if (fixture) await fixture.cleanup(); if (planId) await db.plan.update({ where: { id: planId }, data: { archivedAt: new Date() } }); }
    finally { if (db) await db.$disconnect(); vi.doUnmock('../src/core/database/prisma.js'); vi.unstubAllEnvs(); }
  }, 180_000);
  it('reconciles 100000 invoices and 1000000 movements per tenant under concurrent reads', async () => {
    const budget = Number(process.env.WAVE10_PERF_REPORT_BUDGET_MS);
    if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error('Set the owner-approved WAVE10_PERF_REPORT_BUDGET_MS before running the performance gate');
    const { reportQuerySchema } = await import('../src/modules/reports/reports.schema.js');
    const query = reportQuerySchema.parse({ dateFrom: '2026-11-01', dateTo: '2026-11-09', sections: 'sales,stock' });
    const durations: number[] = [];
    for (let sample = 0; sample < 20; sample++) await Promise.all([a, b].map(async (tenant) => {
      const start = performance.now(); const report = await reports.overview(tenant.firm.id, tenant.admin.id, query); durations.push(performance.now() - start);
      expect(report.firmId).toBe(tenant.firm.id);
      const sales = report.sections.find((section) => section.key === 'sales'); const stock = report.sections.find((section) => section.key === 'stock');
      if (sales?.status !== 'AVAILABLE' || stock?.status !== 'AVAILABLE') throw new Error('Expected authorized source reports');
      const ownTenant = tenant.firm.id === a.firm.id;
      expect(sales.data.metrics.filter((metric) => metric.key === 'netSales')).toEqual(expect.arrayContaining([expect.objectContaining({ currency: 'INR', value: ownTenant ? '50000.00' : '100000.00' }), expect.objectContaining({ currency: 'USD', value: ownTenant ? '50000.00' : '100000.00' })]));
      expect(stock.data.metrics).toContainEqual(expect.objectContaining({ key: 'stockValue', currency: 'INR', value: ownTenant ? '1000000.000000' : '2000000.000000' }));
    }));
    durations.sort((left, right) => left - right); const p95 = durations[Math.ceil(durations.length * .95) - 1]!;
    console.info(JSON.stringify({ event: 'wave10.reporting.performance', samples: durations.length, concurrentTenants: 2, invoicesPerTenant: 100000, movementsPerTenant: 1000000, p95Ms: p95, budgetMs: budget }));
    expect(p95).toBeLessThanOrEqual(budget);
  }, 180_000);
});
