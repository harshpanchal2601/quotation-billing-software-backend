import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, QuotationStatus, TaxMode } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { QuotationsRepository } from '../src/modules/quotations/quotations.repository.js';

// Opt in only after applying the repository schema to a dedicated disposable database.
// This suite neither applies migrations nor uses the application's DATABASE_URL.
const testUrl = process.env.WAVE00_TEST_DATABASE_URL;
const databaseSuite = testUrl ? describe : describe.skip;

databaseSuite('quotation integrity against disposable MySQL', () => {
  let db: PrismaClient;
  let repository: QuotationsRepository;
  const firms: Array<{ id: number; userId: number; companyId: number }> = [];

  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (url.protocol !== 'mysql:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !/^\/wave00_test_[a-zA-Z0-9_]+$/.test(url.pathname)) {
      throw new Error('Use a local disposable MySQL database named wave00_test_<suffix>');
    }
    db = new PrismaClient({ datasources: { db: { url: testUrl } } });
    repository = new QuotationsRepository(db);
    for (const label of ['a', 'b']) {
      const unique = randomUUID();
      const firm = await db.firm.create({ data: { name: `Wave00 ${label}`, slug: `wave00-${unique}` } });
      // Register ownership immediately so partial fixture setup can also be cleaned up.
      const fixture = { id: firm.id, userId: 0, companyId: 0 };
      firms.push(fixture);
      const user = await db.user.create({ data: {
        firmId: firm.id, name: 'Integration actor', email: `${unique}@example.invalid`,
        username: unique, passwordHash: 'unused-integration-fixture',
      } });
      fixture.userId = user.id;
      const company = await db.company.create({ data: {
        firmId: firm.id, companyCode: 'TEST-1', name: `Customer ${label}`, createdById: user.id,
      } });
      fixture.companyId = company.id;
    }
  });

  afterAll(async () => {
    if (!db) return;
    try {
      for (const firm of firms) {
        const ids = (await db.quotation.findMany({ where: { firmId: firm.id }, select: { id: true } }))
          .map((quotation) => quotation.id);
        await db.quotationStatusHistory.deleteMany({ where: { quotationId: { in: ids } } });
        await db.quotationVersion.deleteMany({ where: { quotationId: { in: ids } } });
        await db.quotationItem.deleteMany({ where: { quotationId: { in: ids } } });
        await db.quotation.updateMany({ where: { firmId: firm.id }, data: { rootQuotationId: null, previousRevisionId: null } });
        await db.quotation.deleteMany({ where: { firmId: firm.id } });
        await db.auditLog.deleteMany({ where: { firmId: firm.id } });
        await db.company.deleteMany({ where: { firmId: firm.id } });
        await db.quotationSetting.deleteMany({ where: { businessProfile: { firmId: firm.id } } });
        await db.businessProfile.deleteMany({ where: { firmId: firm.id } });
        await db.user.deleteMany({ where: { firmId: firm.id } });
        await db.firm.delete({ where: { id: firm.id } });
      }
    } finally {
      await db.$disconnect();
    }
  });

  function create(firm = firms[0]!, target = repository) {
    return target.createQuotation(firm.id, {
      companyId: firm.companyId, quotationDate: '2026-10-21', currency: 'USD', taxMode: TaxMode.NONE,
      items: [{ itemName: 'Custom service', quantity: '1', unitRate: '10.10', gstRate: 0 }],
    }, { firmId: firm.id, userId: firm.userId }, firm.userId);
  }

  function withFailure(delegate: 'auditLog' | 'quotationStatusHistory') {
    return new QuotationsRepository(new Proxy(db, {
      get(target, key) {
        if (key === '$transaction') {
          return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            target.$transaction((tx) => callback(new Proxy(tx, {
              get(transaction, model) {
                if (model === delegate) return { create: async () => { throw new Error('injected persistence failure'); } };
                return Reflect.get(transaction, model);
              },
            })));
        }
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }));
  }

  it('reserves unique quotation numbers under concurrent creates', async () => {
    // Initialise lazy firm settings before testing contention on the sequence row.
    await create();
    const quotations = await Promise.all(Array.from({ length: 6 }, () => create()));
    expect(new Set(quotations.map((quotation) => quotation.quotationNumber)).size).toBe(6);
    expect(await db.quotationStatusHistory.count({ where: { quotationId: { in: quotations.map((quotation) => quotation.id) } } })).toBe(6);
  });

  it('allows only one conflicting terminal transition and records its actual predecessor', async () => {
    const quotation = await create();
    const firm = firms[0]!;
    const metadata = { firmId: firm.id, userId: firm.userId };
    await repository.updateQuotationStatus(firm.id, quotation.id, { status: QuotationStatus.SENT }, metadata, firm.userId);
    const results = await Promise.allSettled([QuotationStatus.ACCEPTED, QuotationStatus.REJECTED].map((status) =>
      repository.updateQuotationStatus(firm.id, quotation.id, { status }, metadata, firm.userId)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const stored = await db.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    const history = await db.quotationStatusHistory.findMany({ where: { quotationId: quotation.id }, orderBy: { id: 'asc' } });
    expect(history).toHaveLength(3);
    expect(history[2]).toMatchObject({ fromStatus: QuotationStatus.SENT, toStatus: stored.status });
  });

  it.each(['auditLog', 'quotationStatusHistory'] as const)('rolls back status on %s failure', async (delegate) => {
    const quotation = await create();
    const firm = firms[0]!;
    await expect(withFailure(delegate).updateQuotationStatus(firm.id, quotation.id,
      { status: QuotationStatus.SENT }, { firmId: firm.id, userId: firm.userId }, firm.userId,
    )).rejects.toThrow('injected persistence failure');
    expect((await db.quotation.findUniqueOrThrow({ where: { id: quotation.id } })).status).toBe(QuotationStatus.DRAFT);
    expect(await db.quotationStatusHistory.count({ where: { quotationId: quotation.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { firmId: firm.id, entityId: String(quotation.id), action: 'STATUS_CHANGE' } })).toBe(0);
  });

  it('rolls back a failed create and its sequence reservation together', async () => {
    const firm = firms[0]!;
    await create();
    const where = { businessProfile: { firmId: firm.id } };
    const before = await db.quotationSetting.findFirstOrThrow({ where });
    const countBefore = await db.quotation.count({ where: { firmId: firm.id } });
    await expect(create(firm, withFailure('auditLog'))).rejects.toThrow('injected persistence failure');
    expect((await db.quotationSetting.findFirstOrThrow({ where })).nextSequenceNumber).toBe(before.nextSequenceNumber);
    expect(await db.quotation.count({ where: { firmId: firm.id } })).toBe(countBefore);
  });

  it('denies firm A direct read, mutation and foreign company joins into firm B', async () => {
    const foreign = await create(firms[1]!);
    const firm = firms[0]!;
    await expect(repository.getQuotation(firm.id, foreign.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(repository.updateQuotationStatus(firm.id, foreign.id, { status: QuotationStatus.SENT },
      { firmId: firm.id, userId: firm.userId }, firm.userId)).rejects.toMatchObject({ statusCode: 404 });
    await expect(repository.createQuotation(firm.id, {
      companyId: firms[1]!.companyId, quotationDate: '2026-10-21',
      items: [{ itemName: 'Custom', quantity: 1, unitRate: 1 }],
    }, { firmId: firm.id, userId: firm.userId }, firm.userId)).rejects.toMatchObject({ statusCode: 404 });
    const listed = await repository.listQuotations(firm.id, { page: 1, limit: 100, sortBy: 'createdAt', sortOrder: 'desc' });
    expect(listed.quotations.some((quotation) => quotation.id === foreign.id)).toBe(false);
  });
});
