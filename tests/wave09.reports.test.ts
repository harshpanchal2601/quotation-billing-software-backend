import { Prisma, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors/AppError.js';
import { readAssistantSales, searchAssistantInvoices } from '../src/modules/invoices/assistant-read.repository.js';

import { searchAssistantCustomers } from '../src/modules/companies/assistant-read.repository.js';
import { searchAssistantItems } from '../src/modules/items/assistant-read.repository.js';
import { searchAssistantQuotations } from '../src/modules/quotations/assistant-read.repository.js';
import { searchAssistantOrders } from '../src/modules/sales-orders/assistant-read.repository.js';
import { searchAssistantPayments } from '../src/modules/payments/assistant-read.repository.js';
import { readAssistantAudit } from '../src/modules/audit-logs/assistant-read.repository.js';
import { AssistantRepository } from '../src/modules/assistant/assistant.repository.js';
import { executeAssistantRead } from '../src/modules/assistant/assistant.tools.js';
import { searchToolSchema } from '../src/modules/assistant/assistant.schema.js';
import { LEGACY_POLICY } from '../src/modules/entitlements/entitlements.schema.js';
import { companyListQuerySchema } from '../src/modules/companies/companies.schema.js';
import { itemListQuerySchema } from '../src/modules/items/items.schema.js';
import { quotationListQuerySchema } from '../src/modules/quotations/quotations.schema.js';
import { customerOptionQuerySchema, invoiceListSchema } from '../src/modules/invoices/invoices.schema.js';

const guards = vi.hoisted(() => ({ actor: vi.fn(), feature: vi.fn(), entitlements: vi.fn(), permissions: vi.fn() }));
const reads = vi.hoisted(() => ({ customers: vi.fn(), items: vi.fn(), quotations: vi.fn(), invoices: vi.fn(), orders: vi.fn(), payments: vi.fn(), audit: vi.fn() }));
vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/config/env.js', () => ({ env: { OUTBOX_WORKER_ENABLED: false } }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: guards.actor, resolveUserPermissions: guards.permissions }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: guards.feature, loadEntitlements: guards.entitlements, recordUsage: vi.fn(), withFirmEntitlementTransaction: (db: PrismaClient, _firmId: number, work: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(work) }));
vi.mock('../src/modules/companies/companies.repository.js', () => ({ companiesRepository: { listCompanies: reads.customers } }));
vi.mock('../src/modules/items/items.repository.js', () => ({ itemsRepository: { listItems: reads.items } }));
vi.mock('../src/modules/quotations/quotations.repository.js', () => ({ quotationsRepository: { listQuotations: reads.quotations } }));
vi.mock('../src/modules/invoices/invoices.repository.js', () => ({ invoicesRepository: { list: reads.invoices } }));
vi.mock('../src/modules/sales-orders/sales-orders.repository.js', () => ({ salesOrdersRepository: { list: reads.orders } }));
vi.mock('../src/modules/payments/payments.repository.js', () => ({ paymentsRepository: { list: reads.payments } }));
vi.mock('../src/modules/payments/receivables.repository.js', () => ({ receivablesRepository: {} }));
vi.mock('../src/modules/audit-logs/audit-logs.repository.js', () => ({ auditLogsRepository: { list: reads.audit } }));
vi.mock('../src/modules/companies/index.js', () => import('../src/modules/companies/assistant-read.repository.js'));
vi.mock('../src/modules/items/index.js', () => import('../src/modules/items/assistant-read.repository.js'));
vi.mock('../src/modules/quotations/index.js', () => import('../src/modules/quotations/assistant-read.repository.js'));
vi.mock('../src/modules/invoices/index.js', () => import('../src/modules/invoices/assistant-read.repository.js'));
vi.mock('../src/modules/sales-orders/index.js', () => import('../src/modules/sales-orders/assistant-read.repository.js'));
vi.mock('../src/modules/payments/index.js', () => import('../src/modules/payments/assistant-read.repository.js'));
vi.mock('../src/modules/audit-logs/index.js', () => import('../src/modules/audit-logs/assistant-read.repository.js'));
vi.mock('../src/modules/settings/index.js', () => ({}));
vi.mock('../src/modules/automation/runtime.js', () => ({}));
vi.mock('../src/modules/assistant/assistant.commands.js', () => ({ authorizeAssistantCommand: vi.fn(), executeAssistantCommand: vi.fn(), prepareAssistantCommand: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  guards.actor.mockResolvedValue({ id: 10, firmId: 1, accountType: 'FIRM_ADMIN' });
  guards.permissions.mockReturnValue(['assistant.local']);
  guards.entitlements.mockResolvedValue({ limits: { aiCredits: null }, context: { firmActive: true, legacy: false, now: new Date(), hardDisabled: new Set(), overrides: [], features: new Set(['firm.core', 'assistant.local']), subscription: { status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'), effectiveUntil: null, trialEndsAt: null, graceEndsAt: null, currentPeriodEndsAt: null, policy: LEGACY_POLICY } } });
});
describe('Wave 09 domain sales report accuracy', () => {
  function fixture() {
    const groupBy = vi.fn().mockResolvedValue([
      { currency: 'INR', kind: 'INVOICE', _sum: { grandTotal: new Prisma.Decimal('900719925474099312345.12') }, _count: { _all: 2 } },
      { currency: 'INR', kind: 'CREDIT_NOTE', _sum: { grandTotal: new Prisma.Decimal('0.01') }, _count: { _all: 1 } },
      { currency: 'USD', kind: 'INVOICE', _sum: { grandTotal: new Prisma.Decimal('1.25') }, _count: { _all: 1 } },
      { currency: 'KWD', kind: 'DEBIT_NOTE', _sum: { grandTotal: new Prisma.Decimal('0.001') }, _count: { _all: 1 } },
    ]);
    const tx = { invoice: { groupBy } };
    const db = { $transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
    return { db, groupBy };
  }
  it('preserves precision beyond Number and keeps currencies separate after credits', async () => {
    const { db, groupBy } = fixture();
    const report = await readAssistantSales(1, 10, { dateFrom: '2026-11-01', dateTo: '2026-11-09' }, db);
    expect(report.currencies).toEqual([{ currency: 'INR', netSales: '900719925474099312345.11', documents: 3 }, { currency: 'USD', netSales: '1.25', documents: 1 }, { currency: 'KWD', netSales: '0.001', documents: 1 }]);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ firmId: 1, status: 'ISSUED', kind: { in: ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'] }, invoiceDate: { gte: new Date('2026-11-01'), lte: new Date('2026-11-09') } }) }));
  });
  it('denies the report before reading when adjustment access is revoked', async () => {
    const { db, groupBy } = fixture();
    guards.actor.mockResolvedValueOnce({ id: 10 }).mockRejectedValueOnce(new AppError('Adjustment access denied', 403));
    await expect(readAssistantSales(1, 10, {}, db)).rejects.toMatchObject({ statusCode: 403 }); expect(groupBy).not.toHaveBeenCalled();
  });
  it('returns an empty report without inventing totals', async () => {
    const { db, groupBy } = fixture(); groupBy.mockResolvedValue([]);
    expect((await readAssistantSales(1, 10, {}, db)).currencies).toEqual([]);
  });
});

describe('Wave 09 assistant search domain pagination contracts', () => {
  const fixtures = [
    { resource: 'CUSTOMERS', read: 'customers', key: 'companies', args: [1], row: { id: 7, name: 'QA customer', companyCode: 'COMP-7', isActive: true }, expected: { id: 7, label: 'QA customer', code: 'COMP-7', status: 'ACTIVE', href: '/companies/7' }, legacy: () => searchAssistantCustomers(1, 'QA', 2) },
    { resource: 'ITEMS', read: 'items', key: 'items', args: [1], row: { id: 7, name: 'QA item', itemCode: 'ITEM-7', isActive: true, defaultRate: '25.01', measurementUnit: { symbol: 'PCS' } }, expected: { id: 7, label: 'QA item', code: 'ITEM-7', status: 'ACTIVE', unitRate: '25.01', unit: 'PCS', href: '/items/7' }, legacy: () => searchAssistantItems(1, 'QA', 2) },
    { resource: 'QUOTATIONS', read: 'quotations', key: 'quotations', args: [1], row: { id: 7, quotationNumber: 'QUO-7', companyNameSnapshot: 'QA customer', status: 'DRAFT', currency: 'INR', grandTotal: '25.01' }, expected: { id: 7, label: 'QUO-7', customer: 'QA customer', status: 'DRAFT', currency: 'INR', total: '25.01', href: '/quotations/7' }, legacy: () => searchAssistantQuotations(1, 'QA', 2) },
    { resource: 'INVOICES', read: 'invoices', key: 'documents', args: [1, 'INVOICE'], row: { id: 7, documentNumber: null, buyerSnapshot: { name: 'QA customer' }, status: 'DRAFT', currency: 'INR', grandTotal: '25.01', version: 1 }, expected: { id: 7, label: 'Draft 7', customer: 'QA customer', status: 'DRAFT', currency: 'INR', total: '25.01', version: 1, href: '/invoices/7' }, legacy: () => searchAssistantInvoices(1, 'QA', 2) },
    { resource: 'ORDERS', read: 'orders', key: 'orders', args: [1, 10], row: { id: 7, orderNumber: 'SO-7', company: { name: 'QA customer' }, status: 'OPEN', currency: 'INR' }, expected: { id: 7, label: 'SO-7', customer: 'QA customer', status: 'OPEN', currency: 'INR', href: '/sales-orders/7' }, legacy: () => searchAssistantOrders(1, 10, 'QA', 2) },
    { resource: 'PAYMENTS', read: 'payments', key: 'payments', args: [1, 10], row: { id: 7, reference: 'PAY-7', companyName: 'QA customer', status: 'RECORDED', currency: 'INR', amount: '25.01' }, expected: { id: 7, label: 'PAY-7', customer: 'QA customer', status: 'RECORDED', currency: 'INR', total: '25.01', href: '/payments/7' }, legacy: () => searchAssistantPayments(1, 10, 'QA', 2) },
    { resource: 'AUDIT', read: 'audit', key: 'auditLogs', args: [1], row: { id: 7, entityType: 'Invoice', entityId: '5', action: 'UPDATE', createdAt: new Date('2026-11-09T12:00:00Z') }, expected: { id: 7, label: 'Invoice 5', action: 'UPDATE', createdAt: '2026-11-09T12:00:00.000Z', href: '/audit-logs' }, legacy: () => readAssistantAudit(1, 2) },
  ] as const;
  it.each(fixtures)('passes $resource sorting through the actual tool and wrapper before domain pagination', async ({ resource, read, key, args, row, expected }) => {
    const pagination = { page: 2, limit: 20, total: 27 };
    for (const sortOrder of ['asc', 'desc'] as const) {
      reads[read].mockResolvedValue({ [key]: [row], pagination });
      const result = await executeAssistantRead(1, 10, searchToolSchema.parse({ tool: 'SEARCH', resource, query: 'QA', page: 2, sortBy: 'id', sortOrder }));
      expect(reads[read]).toHaveBeenLastCalledWith(...args, expect.objectContaining({ page: 2, limit: 20, sortBy: 'id', sortOrder, ...(resource === 'AUDIT' ? {} : { search: 'QA' }) }));
      expect(result).toEqual({ records: [expected], pagination });
    }
  });
  it.each(fixtures)('preserves the old positional $resource wrapper signature and domain defaults', async ({ read, key, args, legacy }) => {
    const pagination = { page: 2, limit: 20, total: 0 };
    reads[read].mockResolvedValue({ [key]: [], pagination });
    expect(await legacy()).toEqual({ records: [], pagination });
    const query = reads[read].mock.lastCall!.at(-1);
    expect(reads[read].mock.lastCall!.slice(0, -1)).toEqual(args);
    expect(query).toMatchObject({ page: 2, limit: 20 });
    if (['customers', 'items', 'quotations', 'invoices'].includes(read)) expect(query).toMatchObject({ sortBy: 'createdAt', sortOrder: 'desc' });
    else expect(query).toMatchObject({ sortBy: undefined, sortOrder: undefined });
  });
});

describe('Wave 09 conversation history pagination ordering', () => {
  function fixture() {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = { assistantConversation: { findMany }, assistantSetting: { findUnique: vi.fn().mockResolvedValue(null) }, usageCounter: { findUnique: vi.fn().mockResolvedValue(null) }, assistantMessage: { count: vi.fn().mockResolvedValue(0) } };
    const db = { $transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
    return { repository: new AssistantRepository(db), findMany };
  }
  it('preserves default ordering, firm/actor fencing and stable bounded child ordering', async () => {
    const { repository, findMany } = fixture();
    expect(await repository.history(1, 10, 2)).toEqual({ conversations: [], page: 2, hasMore: false });
    expect(guards.actor).toHaveBeenCalledWith(expect.anything(), 1, 10, 'assistant.local');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 1, actorId: 10, deletedAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: 20, take: 20, select: expect.objectContaining({ messages: expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }), proposals: expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }) }) }));
  });
  it.each(['asc', 'desc'] as const)('orders on the server before pagination in %s direction', async (sortOrder) => {
    const { repository, findMany } = fixture();
    await repository.history(1, 10, 3, { sortBy: 'createdAt', sortOrder });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ createdAt: sortOrder }, { id: sortOrder }], skip: 40, take: 20 }));
    await repository.history(1, 10, 3, { sortBy: 'id', sortOrder });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ id: sortOrder }], skip: 40, take: 20 }));
  });
  it('rejects denied and foreign actors before reading any conversation', async () => {
    const { repository, findMany } = fixture();
    guards.actor.mockRejectedValue(new AppError('Denied', 403));
    await expect(repository.history(1, 10, 1, { sortBy: 'id', sortOrder: 'asc' })).rejects.toMatchObject({ statusCode: 403 });
    guards.actor.mockResolvedValue({ id: 10, firmId: 2, accountType: 'FIRM_ADMIN' });
    await expect(repository.history(1, 10, 1)).rejects.toMatchObject({ statusCode: 403 });
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('Wave 09 ID search ordering reaches domain database queries', () => {
  function fixture(model: 'company' | 'item' | 'quotation' | 'invoice') {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(27);
    const db = { [model]: { findMany, count }, $transaction: (operations: Promise<unknown>[]) => Promise.all(operations) } as unknown as PrismaClient;
    return { db, findMany, count };
  }
  it.each(['asc', 'desc'] as const)('sorts customer records by ID before applying the %s second page', async (sortOrder) => {
    const { CompaniesRepository } = await vi.importActual<typeof import('../src/modules/companies/companies.repository.js')>('../src/modules/companies/companies.repository.js');
    const { db, findMany, count } = fixture('company');
    await new CompaniesRepository(db).listCompanies(1, companyListQuerySchema.parse({ page: 2, limit: 20, search: 'QA', sortBy: 'id', sortOrder }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ firmId: 1, deletedAt: null }), orderBy: [{ id: sortOrder }], skip: 20, take: 20 }));
    expect(count).toHaveBeenCalledWith({ where: findMany.mock.lastCall![0].where });
  });
  it.each(['asc', 'desc'] as const)('sorts catalog records by ID before applying the %s second page', async (sortOrder) => {
    const { ItemsRepository } = await vi.importActual<typeof import('../src/modules/items/items.repository.js')>('../src/modules/items/items.repository.js');
    const { db, findMany } = fixture('item');
    await new ItemsRepository(db).listItems(1, itemListQuerySchema.parse({ page: 2, limit: 20, search: 'QA', sortBy: 'id', sortOrder }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ firmId: 1, deletedAt: null }), orderBy: [{ id: sortOrder }], skip: 20, take: 20 }));
  });
  it.each(['asc', 'desc'] as const)('keeps latest-revision quotation fencing and %s database pagination', async (sortOrder) => {
    const { QuotationsRepository } = await vi.importActual<typeof import('../src/modules/quotations/quotations.repository.js')>('../src/modules/quotations/quotations.repository.js');
    const { db, findMany } = fixture('quotation');
    await new QuotationsRepository(db).listQuotations(1, quotationListQuerySchema.parse({ page: 2, limit: 20, search: 'QA', sortBy: 'id', sortOrder }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ firmId: 1, isLatestRevision: true, deletedAt: null }), orderBy: [{ id: sortOrder }], skip: 20, take: 20 }));
  });
  it.each(['asc', 'desc'] as const)('keeps invoice scope and non-conflicting %s ID order before pagination', async (sortOrder) => {
    const { InvoicesRepository } = await vi.importActual<typeof import('../src/modules/invoices/invoices.repository.js')>('../src/modules/invoices/invoices.repository.js');
    const { db, findMany } = fixture('invoice');
    await new InvoicesRepository(db).list(1, 'INVOICE', invoiceListSchema.parse({ page: 2, limit: 20, search: 'QA', sortBy: 'id', sortOrder }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ firmId: 1, kind: { in: ['INVOICE'] } }), orderBy: [{ id: sortOrder }], skip: 20, take: 20 }));
  });
});

describe('billing selected-customer options used by assistant and draft editors', () => {
  it('resolves a selected ID independently of the bounded name search with the same firm, active and projection fences', async () => {
    const { InvoicesRepository } = await vi.importActual<typeof import('../src/modules/invoices/invoices.repository.js')>('../src/modules/invoices/invoices.repository.js');
    const customer = { id: 125, name: 'Outside first page customer', gstin: null };
    const findMany = vi.fn().mockResolvedValue([customer]);
    const db = { company: { findMany } } as unknown as PrismaClient;
    const query = customerOptionQuerySchema.parse({ search: 'Different name', limit: '30', selectedId: '125' });
    expect(await new InvoicesRepository(db).options(1, 'customers', query.search, query.limit, query.selectedId)).toEqual([customer]);
    expect(guards.feature).toHaveBeenCalledWith(db, 1, 'billing.invoices');
    expect(findMany).toHaveBeenCalledWith({ where: { firmId: 1, deletedAt: null, isActive: true, id: 125 }, select: { id: true, name: true, gstin: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 1 });
  });
  it('keeps the existing option search signature and limits when no selected ID is supplied', async () => {
    const { InvoicesRepository } = await vi.importActual<typeof import('../src/modules/invoices/invoices.repository.js')>('../src/modules/invoices/invoices.repository.js');
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { company: { findMany } } as unknown as PrismaClient;
    await new InvoicesRepository(db).options(1, 'customers', 'QA', 30);
    expect(findMany).toHaveBeenCalledWith({ where: { firmId: 1, deletedAt: null, isActive: true, name: { contains: 'QA' } }, select: { id: true, name: true, gstin: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 30 });
  });
  it('does not read options when the billing feature is denied', async () => {
    const { InvoicesRepository } = await vi.importActual<typeof import('../src/modules/invoices/invoices.repository.js')>('../src/modules/invoices/invoices.repository.js');
    const findMany = vi.fn();
    const db = { company: { findMany } } as unknown as PrismaClient;
    guards.feature.mockRejectedValue(new AppError('Billing unavailable', 403));
    await expect(new InvoicesRepository(db).options(1, 'customers', '', 30, 125)).rejects.toMatchObject({ statusCode: 403 });
    expect(findMany).not.toHaveBeenCalled();
  });
  it('validates selected customer IDs and retains option bounds', () => {
    expect(customerOptionQuerySchema.parse({})).toEqual({ search: '', limit: 30 });
    for (const selectedId of [0, -1, 1.5, 'NaN', '1 OR 1=1', ['1', '2']]) expect(customerOptionQuerySchema.safeParse({ selectedId }).success).toBe(false);
    expect(customerOptionQuerySchema.safeParse({ selectedId: 125, limit: 101 }).success).toBe(false);
  });
});
