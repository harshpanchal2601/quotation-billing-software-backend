import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { decimal } from '../src/core/money/index.js';
import { availableOrderQuantity, fulfillmentStatus } from '../src/modules/sales-orders/order-quantities.js';
import { fulfillmentSchema } from '../src/modules/sales-orders/sales-orders.schema.js';
import { leadConversionSchema, leadCreateSchema, opportunityCreateSchema, OPPORTUNITY_STAGES, taskCreateSchema } from '../src/modules/crm/crm.schema.js';
import { PORTAL_CONSENT, portalAccessListSchema, portalCompanyOptionsSchema, portalDecisionSchema, portalDocumentListSchema, portalDocumentOptionsSchema, portalGrantSchema } from '../src/modules/customer-portal/portal.schema.js';
import { PortalRepository } from '../src/modules/customer-portal/portal.repository.js';
import { AppError } from '../src/core/errors/AppError.js';
import { matchesPortalToken, newPortalToken, portalCsrfToken, portalTokenHash } from '../src/modules/customer-portal/portal-tokens.js';
import { partialQuotationLine } from '../src/modules/invoices/quotation-billing-lines.js';
import type { InvoiceLineSnapshot } from '../src/modules/invoices/invoice-calculations.js';
import { businessPolicySchema } from '../src/modules/settings/business-policy/business-policy.schema.js';
import { isCustomerQuotationDecisionOpen } from '../src/modules/quotations/quotation-customer.js';
import { requestHash } from '../src/core/idempotency/request-hash.js';

describe('Wave 06 domain invariants', () => {
  it('uses Decimal for completed quantity caps and status projection', () => {
    expect(availableOrderQuantity('1.003', '0.303', '0.300').toFixed(3)).toBe('0.003');
    expect(() => availableOrderQuantity('1', '1.001', '0')).toThrow();
    expect(() => availableOrderQuantity('1', '0.3', '0.301')).toThrow();
    expect(fulfillmentStatus([{ quantity: '1', fulfilled: '0' }])).toBe('OPEN');
    expect(fulfillmentStatus([{ quantity: '1', fulfilled: '0.5' }])).toBe('PARTIALLY_FULFILLED');
    expect(fulfillmentStatus([{ quantity: '1', fulfilled: '1' }])).toBe('FULFILLED');
  });
  it('requires deliberate company creation and rejects tenant/actor authority in inputs', () => {
    expect(leadCreateSchema.safeParse({ name: 'Prospect', ownerId: 1, firmId: 2 }).success).toBe(false);
    expect(leadConversionSchema.safeParse({ expectedVersion: 1, idempotencyKey: 'conversion-key', newCompany: { name: 'Example' } }).success).toBe(false);
    expect(leadConversionSchema.safeParse({ expectedVersion: 1, idempotencyKey: 'conversion-key', companyId: 1, newCompany: { name: 'Example' }, confirmNewCompany: true }).success).toBe(false);
    expect(leadConversionSchema.parse({ expectedVersion: 1, idempotencyKey: 'conversion-key', newCompany: { name: 'Example' }, confirmNewCompany: true }).newCompany?.isActive).toBe(true);
  });
  it('validates pipeline stages, exact values and follow-up reminders', () => {
    expect(OPPORTUNITY_STAGES).toMatchObject({ NEW: 10, WON: 100, LOST: 0 });
    expect(opportunityCreateSchema.parse({ title: 'Project', ownerId: 1, value: '999999999999.003', currency: 'KWD' }).stage).toBe('NEW');
    expect(taskCreateSchema.safeParse({ title: 'Follow up', assignedToId: 1, dueAt: '2026-11-08T10:00:00.000Z', reminderAt: '2026-11-08T11:00:00.000Z' }).success).toBe(false);
    expect(fulfillmentSchema.safeParse({ salesOrderId: 1, expectedVersion: 1, idempotencyKey: 'dispatch-key', reference: 'Delivery', occurredAt: '2026-11-08T10:00:00.000Z', lines: [{ salesOrderLineId: 1, quantity: '1' }, { salesOrderLineId: 1, quantity: '1' }] }).success).toBe(false);
  });
  it('limits each portal grant to one document and records explicit consent', () => {
    const base = { identityId: 1, expiresAt: '2026-11-09T10:00:00.000Z' };
    expect(portalGrantSchema.safeParse({ ...base, quotationId: 1, invoiceId: 2 }).success).toBe(false);
    expect(portalGrantSchema.safeParse({ ...base, invoiceId: 2, allowDecision: true }).success).toBe(false);
    expect(portalDecisionSchema.safeParse({ grantId: 1, snapshotHash: 'a'.repeat(64), decision: 'ACCEPTED', consent: PORTAL_CONSENT, idempotencyKey: 'decision-key', actorId: 1 }).success).toBe(false);
  });
  it('uses independent opaque invitation/session tokens and a stable session-specific CSRF proof', () => {
    const first = newPortalToken(); const second = newPortalToken();
    expect(first).toHaveLength(43); expect(second).not.toBe(first);
    expect(matchesPortalToken(first, portalTokenHash(first))).toBe(true);
    expect(matchesPortalToken(second, portalTokenHash(first))).toBe(false);
    expect(matchesPortalToken('', portalTokenHash(first))).toBe(false);
    expect(portalCsrfToken(first)).toHaveLength(43); expect(portalCsrfToken(first)).not.toBe(portalCsrfToken(second));
    expect(portalTokenHash(first)).not.toContain(first);
  });
  it('preserves pennies and supports cancellation/reallocation without reusing consumed money', () => {
    const line: InvoiceLineSnapshot = { lineNumber: 1, itemId: null, itemCode: null, itemName: 'Service', description: null, hsnCode: null, supplyType: 'SERVICE', measurementUnit: 'HOUR', quantity: '3', unitRate: '0.01', discountType: 'NONE', discountValue: '0', taxRate: '0', baseAmount: '0.02', discountAmount: '0.00', taxableAmount: '0.02', cgstAmount: '0.00', sgstAmount: '0.00', igstAmount: '0.00', taxAmount: '0.00', lineTotal: '0.02' };
    const a = partialQuotationLine(line, '0', '1', 'INR');
    const b = partialQuotationLine(line, '1', '1', 'INR', a);
    const consumed = { baseAmount: decimal(a.baseAmount).add(b.baseAmount).toString(), discountAmount: '0', cgstAmount: '0', sgstAmount: '0', igstAmount: '0' };
    const c = partialQuotationLine(line, '2', '1', 'INR', consumed);
    expect(decimal(a.lineTotal).add(b.lineTotal).add(c.lineTotal).toFixed(2)).toBe('0.02');
    const replacement = partialQuotationLine(line, '1', '2', 'INR', b);
    expect(decimal(b.lineTotal).add(replacement.lineTotal).toFixed(2)).toBe('0.02');
  });
  it('preserves old policy shape and validates firm-level sales presets', () => {
    const old = { schemaVersion: 1, currency: 'INR', rounding: 'HALF_UP', grandTotal: 'WHOLE_UNIT', tax: { id: 'none', version: 1 }, inAppNotifications: true };
    expect(businessPolicySchema.parse(old)).toEqual(old);
    expect(businessPolicySchema.parse({ ...old, sales: { preset: 'SERVICE', ordersEnabled: false, portalEnabled: true } }).sales?.ordersEnabled).toBe(false);
  });
  it('ends portal decisions on the existing Indian business-day boundary', () => {
    const source = { isLatestRevision: true, status: 'SENT', validUntil: new Date('2026-11-08T00:00:00Z') };
    expect(isCustomerQuotationDecisionOpen(source, new Date('2026-11-08T18:29:59Z'))).toBe(true);
    expect(isCustomerQuotationDecisionOpen(source, new Date('2026-11-08T18:30:00Z'))).toBe(false);
    expect(isCustomerQuotationDecisionOpen({ ...source, isLatestRevision: false }, new Date('2026-11-08T12:00:00Z'))).toBe(false);
  });
});

function portalReadFixture() {
  const identity = { id: 8, companyId: 42, email: 'contact@example.invalid', revokedAt: null, company: { deletedAt: null, isActive: true }, contact: { deletedAt: null, email: 'contact@example.invalid' } };
  const tx = { portalIdentity: { findMany: vi.fn().mockResolvedValue([{ _count: { invitations: 45, grants: 25 } }]), findFirst: vi.fn().mockResolvedValue(identity), count: vi.fn().mockResolvedValue(1) }, company: { findMany: vi.fn().mockResolvedValue([]) }, companyContact: { findMany: vi.fn().mockResolvedValue([]) }, invoice: { findMany: vi.fn().mockResolvedValue([{ id: 11, documentNumber: 'INV-11', status: 'ISSUED' }]) }, quotation: { findMany: vi.fn().mockResolvedValue([]) }, salesOrder: { findMany: vi.fn().mockResolvedValue([]) } };
  const db = { $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
  const repository = new PortalRepository(db);
  const authorization = repository as unknown as { staff: (client: unknown, firmId: number, actorId: number) => Promise<void>; documentAccess: (client: unknown, firmId: number, actorId: number, kind: string) => Promise<void> };
  const staff = vi.spyOn(authorization, 'staff').mockResolvedValue();
  const documentAccess = vi.spyOn(authorization, 'documentAccess').mockResolvedValue();
  return { repository, tx, staff, documentAccess };
}
describe('portal access read projections', () => {
  it('keeps management IDs available but excludes source metadata when its current permission or feature is denied', async () => {
    const { repository, tx, documentAccess } = portalReadFixture();
    documentAccess.mockImplementation(async (_, firmId, actorId, kind) => {
      expect([firmId, actorId]).toEqual([3, 6]);
      if (kind !== 'invoice') throw new AppError('Source access unavailable', 403);
    });
    await repository.staffList(3, 6, portalAccessListSchema.parse({}));
    expect(tx.portalIdentity.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ grants: expect.objectContaining({ select: expect.objectContaining({ quotationId: true, quotation: false, invoiceId: true, invoice: { select: { documentNumber: true } }, salesOrderId: true, salesOrder: false, acceptances: expect.any(Object) }) }) }) }));
    tx.portalIdentity.findMany.mockClear();
    documentAccess.mockRejectedValue(new Error('Source lookup unavailable'));
    await expect(repository.staffList(3, 6, portalAccessListSchema.parse({}))).rejects.toThrow('Source lookup unavailable');
    expect(tx.portalIdentity.findMany).not.toHaveBeenCalled();
  });
  it('uses allowlisted stable server sorts for firm-scoped contacts and nested history windows', async () => {
    const { repository, tx, staff } = portalReadFixture();
    const result = await repository.staffList(3, 6, portalAccessListSchema.parse({ identityId: '8', page: '1', historyPage: '2', sortBy: 'name', sortOrder: 'asc', historySortBy: 'expiresAt', historySortOrder: 'asc' }));
    expect(staff).toHaveBeenCalledWith(tx, 3, 6);
    expect(tx.portalIdentity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 3, id: 8, companyId: undefined }, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: 0, take: 20, select: expect.objectContaining({ company: { select: { name: true, companyCode: true } }, invitations: expect.objectContaining({ orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }], skip: 20, take: 20 }), grants: expect.objectContaining({ orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }], skip: 20, take: 20 }) }) }));
    expect(result.hasMoreHistory).toBe(true);
    expect(portalAccessListSchema.safeParse({ sortBy: 'tokenHash' }).success).toBe(false);
    expect(portalAccessListSchema.safeParse({ historySortBy: 'snapshot' }).success).toBe(false);
    expect(portalAccessListSchema.safeParse({ historyPage: '1.5' }).success).toBe(false);
  });
  it('limits company and contact options to authorized firm metadata with searchable names', async () => {
    const { repository, tx, staff } = portalReadFixture();
    await repository.companies(3, 6, portalCompanyOptionsSchema.parse({ search: 'QA' }));
    expect(staff).toHaveBeenCalledWith(tx, 3, 6);
    expect(tx.company.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 3, deletedAt: null, OR: [{ name: { contains: 'QA' } }, { companyCode: { contains: 'QA' } }] }, select: { id: true, name: true, companyCode: true, isActive: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100 }));
    await repository.contacts(3, 6, 42, 'named');
    expect(tx.companyContact.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: 42, deletedAt: null, email: { not: null }, company: { firmId: 3, deletedAt: null, isActive: true }, OR: [{ name: { contains: 'named' } }, { email: { contains: 'named' } }] }, select: { id: true, name: true, email: true } }));
    expect(portalCompanyOptionsSchema.safeParse({ search: '', firmId: 99 }).success).toBe(false);
  });
  it('fences document options by the selected identity company and separately checks document access', async () => {
    const { repository, tx, documentAccess } = portalReadFixture();
    const query = portalDocumentOptionsSchema.parse({ identityId: '8', kind: 'invoiceId', search: 'INV' });
    expect(await repository.documentOptions(3, 6, query)).toEqual([{ id: 11, label: 'INV-11', status: 'ISSUED', allowDecision: false }]);
    expect(tx.portalIdentity.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 8, firmId: 3 } }));
    expect(documentAccess).toHaveBeenCalledWith(tx, 3, 6, 'invoice');
    expect(tx.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 3, companyId: 42, kind: 'INVOICE', status: 'ISSUED', documentNumber: { contains: 'INV' } }, select: { id: true, documentNumber: true, status: true }, take: 100 }));
    tx.invoice.findMany.mockClear(); documentAccess.mockRejectedValueOnce(new Error('Access denied'));
    await expect(repository.documentOptions(3, 6, query)).rejects.toThrow('Access denied');
    expect(tx.invoice.findMany).not.toHaveBeenCalled();
    tx.portalIdentity.findFirst.mockResolvedValueOnce(null);
    await expect(repository.documentOptions(3, 6, query)).rejects.toThrow('Portal identity unavailable');
    expect(tx.invoice.findMany).not.toHaveBeenCalled();
  });
});

describe('public portal document list', () => {
  it('orders by an allowlisted grant ID before paging and keeps the session scope and live-document checks', async () => {
    const row = (id: number) => ({ id, snapshot: { kind: 'INVOICE', documentNumber: `INV-${id}` }, expiresAt: new Date('2026-12-01T00:00:00Z') });
    const tx = { portalGrant: { findMany: vi.fn().mockResolvedValueOnce(Array.from({ length: 20 }, (_, index) => row(index + 21))).mockResolvedValueOnce([row(3)]) } };
    const session = { firmId: 3, companyId: 42, identityId: 8, identity: { name: 'Named customer contact' } };
    const repository = new PortalRepository({} as PrismaClient);
    const access = repository as unknown as {
      session: (token: string | undefined, csrf: string | undefined, work: (client: typeof tx, current: typeof session) => Promise<unknown>) => Promise<unknown>;
      liveDocument: (client: typeof tx, grant: { id: number }) => Promise<void>;
    };
    const authorize = vi.spyOn(access, 'session').mockImplementation(async (_token, _csrf, work) => work(tx, session));
    const live = vi.spyOn(access, 'liveDocument').mockImplementation(async (_, grant) => { if (grant.id === 22) throw new AppError('No longer shared', 404); });
    const result = await repository.listDocuments('session-cookie', 2, { sortBy: 'id', sortOrder: 'asc' });
    expect(authorize).toHaveBeenCalledWith('session-cookie', undefined, expect.any(Function));
    expect(tx.portalGrant.findMany).toHaveBeenNthCalledWith(1, { where: { firmId: 3, companyId: 42, identityId: 8, revokedAt: null, expiresAt: { gt: expect.any(Date) } }, orderBy: [{ id: 'asc' }], skip: 20, take: 20 });
    expect(live).toHaveBeenCalledTimes(20);
    expect(result).toMatchObject({ contactName: 'Named customer contact', page: 2, hasMore: true, consent: PORTAL_CONSENT });
    expect(result.documents.map((entry) => entry.id)).toEqual([21, ...Array.from({ length: 18 }, (_, index) => index + 23)]);
    expect(result.documents.every((entry) => !('snapshot' in entry) && !('snapshotHash' in entry))).toBe(true);
    await repository.listDocuments('session-cookie', 1);
    expect(tx.portalGrant.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ orderBy: [{ id: 'desc' }], skip: 0, take: 20 }));
    expect(portalDocumentListSchema.parse({ page: '2', sortBy: 'id', sortOrder: 'asc' })).toEqual({ page: 2, sortBy: 'id', sortOrder: 'asc' });
    expect(portalDocumentListSchema.safeParse({ sortBy: 'number' }).success).toBe(false);
    expect(portalDocumentListSchema.safeParse({ sortOrder: 'sideways' }).success).toBe(false);
  });
  it('does not read grants without a valid current portal session, including a revoked or expired cookie', async () => {
    const token = 'a'.repeat(43);
    const session = { revokedAt: null, expiresAt: new Date(Date.now() - 1000), invitation: { revokedAt: null }, identity: { revokedAt: null, email: 'contact@example.invalid', company: { deletedAt: null, isActive: true }, contact: { deletedAt: null, email: 'contact@example.invalid' } } };
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: 3 }]), portalSession: { findUnique: vi.fn().mockResolvedValue(session) }, portalGrant: { findMany: vi.fn() } };
    const db = { portalSession: { findUnique: vi.fn().mockResolvedValue({ id: 7, firmId: 3 }) }, $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
    const repository = new PortalRepository(db as unknown as PrismaClient);
    await expect(repository.listDocuments(undefined, 1, { sortBy: 'id', sortOrder: 'asc' })).rejects.toThrow('Portal access unavailable or expired');
    expect(db.portalSession.findUnique).not.toHaveBeenCalled();
    await expect(repository.listDocuments(token, 1, { sortBy: 'id', sortOrder: 'asc' })).rejects.toThrow('Portal access unavailable or expired');
    expect(db.portalSession.findUnique).toHaveBeenCalledWith({ where: { tokenHash: portalTokenHash(token) }, select: { id: true, firmId: true } });
    tx.portalSession.findUnique.mockResolvedValueOnce({ ...session, expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() });
    await expect(repository.listDocuments(token, 1, { sortBy: 'id', sortOrder: 'desc' })).rejects.toThrow('Portal access unavailable or expired');
    expect(tx.portalGrant.findMany).not.toHaveBeenCalled();
  });
});

describe('new invoice portal snapshots', () => {
  it('includes the exact saved discount, taxable total and rounding adjustment without rewriting historical grants', async () => {
    const totals = { subtotal: decimal('123456789012.103'), discountAmount: decimal('0.001'), taxableAmount: decimal('123456789012.102'), taxAmount: decimal('0.008'), roundOffAmount: decimal('-0.110'), grandTotal: decimal('123456789012.000') };
    const invoice = { id: 11, documentNumber: 'INV-11', invoiceDate: new Date('2026-11-10T00:00:00Z'), dueDate: null, currency: 'KWD', buyerSnapshot: { name: 'Named buyer' }, sellerSnapshot: { name: 'Seller' }, bankSnapshot: null, paymentTerms: 'As agreed', ...totals, lines: [{ snapshot: { itemName: 'Exact service', lineTotal: '123456789012.110' } }] };
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ id: 3 }]), portalIdentity: { findFirst: vi.fn().mockResolvedValue({ id: 8, companyId: 42, email: 'contact@example.invalid', revokedAt: null, company: { deletedAt: null, isActive: true }, contact: { deletedAt: null, email: 'contact@example.invalid' } }) }, invoice: { findFirst: vi.fn().mockResolvedValue(invoice) }, portalGrant: { create: vi.fn().mockImplementation(async ({ data }) => ({ ...data, id: 77 })), update: vi.fn(), updateMany: vi.fn() } };
    const repository = new PortalRepository({ $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient);
    const authorization = repository as unknown as { staff: (client: unknown, firmId: number, actorId: number) => Promise<void>; documentAccess: (client: unknown, firmId: number, actorId: number, kind: string) => Promise<void>; audit: (...values: unknown[]) => Promise<void> };
    vi.spyOn(authorization, 'staff').mockResolvedValue();
    const sourceAccess = vi.spyOn(authorization, 'documentAccess').mockResolvedValue();
    vi.spyOn(authorization, 'audit').mockResolvedValue();
    const result = await repository.share(3, 6, portalGrantSchema.parse({ identityId: 8, invoiceId: 11, expiresAt: new Date(Date.now() + 86400000).toISOString() }), {});
    expect(sourceAccess).toHaveBeenCalledWith(tx, 3, 6, 'invoice');
    expect(tx.invoice.findFirst).toHaveBeenCalledWith({ where: { id: 11, firmId: 3, companyId: 42, kind: 'INVOICE', status: 'ISSUED' }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
    const saved = tx.portalGrant.create.mock.calls[0][0].data;
    expect(saved.snapshot).toMatchObject({ kind: 'INVOICE', subtotal: '123456789012.103', discountAmount: '0.001', taxableAmount: '123456789012.102', taxAmount: '0.008', roundOffAmount: '-0.11', grandTotal: '123456789012', currency: 'KWD', items: invoice.lines.map((line) => line.snapshot) });
    expect(saved.snapshotHash).toBe(requestHash(saved.snapshot));
    expect(result).toEqual({ id: 77, snapshotHash: saved.snapshotHash });
    expect(invoice.roundOffAmount.eq('-0.110')).toBe(true);
    expect(invoice.grandTotal.eq('123456789012.000')).toBe(true);
    expect(tx.portalGrant.update).not.toHaveBeenCalled();
    expect(tx.portalGrant.updateMany).not.toHaveBeenCalled();
  });
});
