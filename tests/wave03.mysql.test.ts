import fs from 'node:fs';
import { PrismaClient, TaxMode } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reserveDocumentSequence } from '../src/core/sequences/index.js';
import { OutboxRepository } from '../src/core/outbox/index.js';
import { BusinessPolicyRepository, DEFAULT_BUSINESS_POLICY } from '../src/modules/settings/business-policy/business-policy.repository.js';
import { inAppNotificationHandler, listNotifications } from '../src/modules/notifications/notifications.repository.js';
import { NotificationJobsRepository } from '../src/modules/notifications/jobs.repository.js';
import { QuotationsRepository } from '../src/modules/quotations/quotations.repository.js';
import { TwoFirmFixture, assertDisposableTenantDatabase, type TenantFixture } from './helpers/two-firm-fixture.js';

// Opt in only after applying the schema to a dedicated, local disposable DB.
// Never uses DATABASE_URL or applies DDL/migrations.
const testUrl = process.env.WAVE03_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
suite('Wave 03 transactional MySQL contracts', () => {
  let db: PrismaClient; let fixture: TwoFirmFixture; let a: TenantFixture; let b: TenantFixture;
  beforeAll(async () => {
    assertDisposableTenantDatabase(testUrl!, '03');
    db = new PrismaClient({ datasources: { db: { url: testUrl! } } });
    fixture = new TwoFirmFixture(db);
    a = await fixture.createTenant('wave03-a'); b = await fixture.createTenant('wave03-b');
  });
  afterAll(async () => { try { if (fixture) await fixture.cleanup(); } finally { if (db) await db.$disconnect(); } });

  it('serializes concurrent first reservations independently by firm, type and reset period', async () => {
    for (const documentType of ['INVOICE', 'QUOTATION']) {
      const values = await Promise.all(Array.from({ length: 8 }, () => db.$transaction((tx) => reserveDocumentSequence(tx, { firmId: a.firm.id, documentType, period: 'FY:2026:4' }))));
      expect(values.map(String).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    }
    expect(await db.$transaction((tx) => reserveDocumentSequence(tx, { firmId: b.firm.id, documentType: 'INVOICE', period: 'FY:2026:4' }))).toBe(1n);
    expect(await db.$transaction((tx) => reserveDocumentSequence(tx, { firmId: a.firm.id, documentType: 'INVOICE', period: 'FY:2027:4' }))).toBe(1n);
  });

  it('rolls a failed resource transaction and its reservation back together', async () => {
    await expect(db.$transaction(async (tx) => { await reserveDocumentSequence(tx, { firmId: a.firm.id, documentType: 'ROLLBACK', period: 'ALL' }); throw new Error('resource failure'); })).rejects.toThrow('resource failure');
    expect(await db.$transaction((tx) => reserveDocumentSequence(tx, { firmId: a.firm.id, documentType: 'ROLLBACK', period: 'ALL' }))).toBe(1n);
  });

  it('backfills legacy high-water marks and continues through a financial-year boundary', async () => {
    const repository = new QuotationsRepository(db);
    const create = (date: string) => repository.createQuotation(a.firm.id, { companyId: a.company.id, quotationDate: date, taxMode: TaxMode.NONE, items: [{ itemName: 'Fixture', quantity: '1', unitRate: '10.10' }] }, { firmId: a.firm.id, userId: a.admin.id }, a.admin.id);
    const historical = await create('2026-03-30');
    await db.quotation.update({ where: { id: historical.id }, data: { quotationNumber: 'LEGACY/2025-26/000099' } });
    await db.documentSequence.deleteMany({ where: { firmId: a.firm.id, documentType: 'QUOTATION', period: 'LEGACY' } });
    // Exercise only the migration's seed DML on this suite's own fixture.
    const sql = fs.readFileSync(new URL('../prisma/migrations/20261027090000_wave03_business_infrastructure/migration.sql', import.meta.url), 'utf8');
    const seed = sql.match(/INSERT INTO `document_sequences`[\s\S]+?;/)?.[0];
    if (!seed) throw new Error('Sequence migration seed missing');
    await db.$executeRawUnsafe(`${seed.slice(0, -1)} WHERE p.firm_id = ?`, a.firm.id);
    expect((await create('2026-03-31')).quotationNumber).toMatch(/\/2025-26\/000100$/);
    expect((await create('2026-04-01')).quotationNumber).toMatch(/\/2026-27\/000101$/);
  });

  it('commits a policy and outbox event atomically, then delivers exactly one tenant inbox effect', async () => {
    const policy = new BusinessPolicyRepository(db);
    await policy.update(a.firm.id, a.admin.id, 0, DEFAULT_BUSINESS_POLICY, {});
    const worker = new OutboxRepository(db, { 'notifications.in-app.v1': inAppNotificationHandler });
    await Promise.all([worker.runOne('fixture-a'), worker.runOne('fixture-b')]);
    await worker.runOne('fixture-c');
    const own = await listNotifications(db, a.firm.id, a.admin.id);
    expect(own).toHaveLength(1);
    expect(await listNotifications(db, b.firm.id, a.admin.id)).toHaveLength(0);
    expect(await listNotifications(db, a.firm.id, b.admin.id)).toHaveLength(0);
    const event = await db.outboxEvent.findFirstOrThrow({ where: { firmId: a.firm.id } });
    expect(event.status).toBe('SUCCEEDED');
    expect(await db.jobAttempt.count({ where: { eventId: event.id, outcome: 'SUCCEEDED' } })).toBe(1);
    expect(await new NotificationJobsRepository(db).list(b.firm.id)).toHaveLength(0);
    await expect(new NotificationJobsRepository(db).retry(b.firm.id, b.admin.id, event.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('revalidates a suspended firm before worker execution', async () => {
    await new BusinessPolicyRepository(db).update(b.firm.id, b.admin.id, 0, DEFAULT_BUSINESS_POLICY, {});
    await db.firm.update({ where: { id: b.firm.id }, data: { status: 'SUSPENDED' } });
    try {
      await new OutboxRepository(db, { 'notifications.in-app.v1': inAppNotificationHandler }).runOne('fixture-suspended');
      expect(await db.notificationDelivery.count({ where: { firmId: b.firm.id } })).toBe(0);
      expect((await db.outboxEvent.findFirstOrThrow({ where: { firmId: b.firm.id } })).status).toBe('DEAD');
    } finally { await db.firm.update({ where: { id: b.firm.id }, data: { status: 'ACTIVE' } }); }
  });
});
