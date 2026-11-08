import { Prisma, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors/AppError.js';
import { ApprovalsRepository, assertQuotationPublicationApproved, enforceApproval } from '../src/modules/automation/approvals.repository.js';
import type { ApprovalCommand } from '../src/modules/automation/automation.schema.js';

const access = vi.hoisted(() => ({ feature: vi.fn() }));
vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/modules/auth/index.js', async () => ({ authorizeFirmJobActor: (await import('../src/modules/auth/auth.worker.js')).authorizeFirmJobActor }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: access.feature, withFirmEntitlementTransaction: async (db: PrismaClient, _firmId: number, work: unknown) => db.$transaction(work as never) }));

function fixture() {
  const policy = { id: 1, firmId: 1, kind: 'APPROVAL', key: 'INVOICE_ISSUE', version: 1, definition: { enabled: true, action: 'INVOICE_ISSUE', expiresAfterHours: 48, authority: 'OTHER_FIRM_ADMIN' } };
  const invoice = { id: 11, firmId: 1, kind: 'INVOICE', version: 1, status: 'DRAFT', currency: 'INR', documentNumber: null, subtotal: new Prisma.Decimal('100'), discountAmount: new Prisma.Decimal('20'), grandTotal: new Prisma.Decimal('80') };
  const tx = {
    user: { findFirst: vi.fn(async ({ where }: { where: { id: number } }) => ({ id: where.id, firmId: 1, accountType: 'FIRM_ADMIN', status: 'ACTIVE', mustChangePassword: false, deletedAt: null, firmRole: null, firm: { id: 1, status: 'ACTIVE', deletedAt: null } })) },
    invoice: { findFirst: vi.fn().mockResolvedValue(invoice) },
    automationDefinitionVersion: { findFirst: vi.fn().mockResolvedValue(policy) },
    approvalRequest: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, status: 'PENDING', createdAt: new Date() })), update: vi.fn() },
    approvalDecision: { create: vi.fn() }, auditLog: { create: vi.fn() },
  };
  const db = { $transaction: async (work: (value: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
  return { tx, db, policy, invoice };
}
const command: ApprovalCommand = { action: 'INVOICE_ISSUE', entityId: 11, expectedVersion: 1, confirmedTotal: '80' };
beforeEach(() => vi.resetAllMocks());
describe('Wave 08 immutable approval authority and exact command matching', () => {
  it('requires staff approval before an unsent pending quotation can reach portal customers', async () => {
    const { tx, policy } = fixture();
    const quotation = { id: 12, firmId: 1, status: 'PENDING', sentAt: null, currency: 'INR', subtotal: new Prisma.Decimal('100'), itemDiscountAmount: new Prisma.Decimal('5'), quotationDiscountAmount: new Prisma.Decimal('10'), grandTotal: new Prisma.Decimal('85') };
    const portalTx = { ...tx, quotation: { findFirst: vi.fn().mockResolvedValue(quotation) } };
    tx.automationDefinitionVersion.findFirst.mockResolvedValue({ ...policy, key: 'QUOTATION_SEND', definition: { ...policy.definition, action: 'QUOTATION_SEND', discountPercent: '10' } });
    await expect(assertQuotationPublicationApproved(portalTx as never, 1, 12)).rejects.toMatchObject({ statusCode: 409 });
    expect(portalTx.quotation.findFirst).toHaveBeenCalledWith({ where: { id: 12, firmId: 1, deletedAt: null } });
    portalTx.quotation.findFirst.mockResolvedValue({ ...quotation, status: 'SENT', sentAt: new Date() });
    await expect(assertQuotationPublicationApproved(portalTx as never, 1, 12)).resolves.toBeUndefined();
  });
  it('preserves pending portal quotations without an applicable discount policy', async () => {
    const { tx } = fixture();
    const portalTx = { ...tx, quotation: { findFirst: vi.fn().mockResolvedValue({ id: 12, status: 'PENDING', sentAt: null }) } };
    tx.automationDefinitionVersion.findFirst.mockResolvedValue(null);
    await expect(assertQuotationPublicationApproved(portalTx as never, 1, 12)).resolves.toBeUndefined();
    portalTx.quotation.findFirst.mockResolvedValue(null);
    await expect(assertQuotationPublicationApproved(portalTx as never, 1, 12)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('blocks the original command until another administrator approves the matching request', async () => {
    const { tx, db, policy } = fixture();
    await expect(enforceApproval(tx as never, 1, 10, command)).rejects.toMatchObject({ statusCode: 409, details: { code: 'APPROVAL_REQUIRED', command } });
    const created = await new ApprovalsRepository(db).request(1, 10, command);
    tx.approvalRequest.findFirst.mockResolvedValue({ ...created, id: 'request-a', consumedAt: null, expiresAt: new Date(Date.now() + 3600000), policy, decisions: [] });
    await expect(new ApprovalsRepository(db).decide(1, 10, 'request-a', { decision: 'APPROVED', reason: 'Self approval denied' })).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.approvalDecision.create).not.toHaveBeenCalled();
    await new ApprovalsRepository(db).decide(1, 20, 'request-a', { decision: 'APPROVED', reason: 'Reviewed by another administrator' });
    expect(tx.approvalDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ firmId: 1, actorId: 20, decision: 'APPROVED' }) });
  });
  it('checks discount thresholds without rounding a value just above the boundary down', async () => {
    const { tx, invoice, policy } = fixture();
    invoice.subtotal = new Prisma.Decimal('1000000000000001'); invoice.discountAmount = new Prisma.Decimal('100000000000001');
    tx.automationDefinitionVersion.findFirst.mockResolvedValue({ ...policy, definition: { ...policy.definition, discountPercent: '10' } });
    await expect(enforceApproval(tx as never, 1, 10, command)).rejects.toMatchObject({ statusCode: 409 });
    invoice.discountAmount = new Prisma.Decimal('100000000000000');
    await expect(enforceApproval(tx as never, 1, 10, command)).resolves.toBeUndefined();
  });
  it('rejects denied entitlements and changed document totals before persisting a request', async () => {
    const { tx, db } = fixture();
    access.feature.mockRejectedValueOnce(new AppError('Denied plan', 403));
    await expect(new ApprovalsRepository(db).request(1, 10, command)).rejects.toMatchObject({ statusCode: 403 });
    await expect(new ApprovalsRepository(db).request(1, 10, { ...command, confirmedTotal: '79' })).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.approvalRequest.create).not.toHaveBeenCalled();
  });
  it('retains the request policy version and rechecks approver membership at consumption', async () => {
    const { tx, db, policy } = fixture(); const created = await new ApprovalsRepository(db).request(1, 10, command);
    const approved = { ...created, id: 'request-a', requesterId: 10, policyId: policy.id, status: 'APPROVED', policy, decisions: [{ id: 7, actorId: 20, decision: 'APPROVED' }] };
    tx.approvalRequest.findFirst.mockResolvedValue(approved);
    tx.automationDefinitionVersion.findFirst.mockResolvedValue({ ...policy, id: 2, version: 2 });
    await enforceApproval(tx as never, 1, 10, command);
    expect(tx.approvalRequest.update).toHaveBeenCalledWith({ where: { id: approved.id }, data: { consumedAt: expect.any(Date) } });
    tx.approvalRequest.update.mockClear();
    tx.user.findFirst.mockImplementation(async ({ where }) => ({ id: where.id, firmId: where.id === 20 ? 2 : 1, accountType: 'FIRM_ADMIN', status: 'ACTIVE', mustChangePassword: false, deletedAt: null, firmRole: null, firm: { id: 1, status: 'ACTIVE', deletedAt: null } }));
    await expect(enforceApproval(tx as never, 1, 10, command)).rejects.toMatchObject({ statusCode: 403 });
    expect(tx.approvalRequest.update).not.toHaveBeenCalled();
  });
  it('can revoke an unused approval after the underlying resource has changed', async () => {
    const { tx, db } = fixture();
    tx.approvalRequest.findFirst.mockResolvedValue({ id: 'request-a', firmId: 1, requesterId: 10, policyId: 1, command, status: 'APPROVED', consumedAt: null, expiresAt: new Date(Date.now() + 3600000) });
    tx.invoice.findFirst.mockResolvedValue(null);
    await new ApprovalsRepository(db).decide(1, 20, 'request-a', { decision: 'REVOKED', reason: 'Underlying request changed' });
    expect(tx.approvalDecision.create).toHaveBeenCalled();
    expect(tx.invoice.findFirst).not.toHaveBeenCalled();
  });
});
