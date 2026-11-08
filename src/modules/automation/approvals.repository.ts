import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { jsonObject } from '../../core/serialization/json.js';
import { decimal } from '../../core/money/index.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { approvalCommandSchema, approvalPolicySchema, decisionSchema, type ApprovalCommand } from './automation.schema.js';
import { actionAccess, auditAutomation, automationAccess, latestDefinition, type AutomationTx } from './automation.persistence.js';

export function discountPercentage(base: Prisma.Decimal, discount: Prisma.Decimal) {
  return base.isZero() ? '0' : decimal(discount).mul(100).div(decimal(base)).toFixed(30);
}
async function commandEvidence(tx: AutomationTx, firmId: number, actorId: number, command: ApprovalCommand) {
  await actionAccess(tx, firmId, actorId, command.action);
  if (command.action === 'STOCK_ADJUST') {
    const [item, warehouse] = await Promise.all([
      tx.item.findFirst({ where: { id: command.entityId, firmId, deletedAt: null, stockTracking: true, isActive: true, kind: 'GOODS' } }),
      tx.warehouse.findFirst({ where: { id: command.warehouseId, firmId, isActive: true } }),
    ]);
    if (!item || !warehouse) throw new AppError('Stock resource not found', 404);
    if (command.direction === 'IN' && command.unitCost === undefined) throw new AppError('Inbound adjustments require a cost', 400);
    return { entity: 'ITEM', entityId: item.id, itemName: item.name, warehouse: warehouse.code, currency: '', total: '0', discountPercent: '0', discountBase: '0', discountAmount: '0' };
  }
  if (command.action === 'ORDER_CONFIRM' || command.action === 'QUOTATION_SEND') {
    const row = await tx.quotation.findFirst({ where: { id: command.entityId, firmId, deletedAt: null, isLatestRevision: true } });
    if (!row) throw new AppError('Quotation not found', 404);
    const expected = command.action === 'ORDER_CONFIRM' ? 'ACCEPTED' : 'DRAFT';
    if (command.action === 'ORDER_CONFIRM' ? row.status !== expected : !['DRAFT', 'PENDING'].includes(row.status)) throw new AppError('Quotation state no longer permits this action', 409);
    if (command.action === 'QUOTATION_SEND' && command.status === 'ACCEPTED' && row.status !== 'PENDING') throw new AppError('Only a pending quotation can be accepted without a prior send', 409);
    if (command.action === 'ORDER_CONFIRM') { await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.QUOTATIONS_VIEW); await assertTransactionFeature(tx, firmId, 'quotations'); }
    return { entity: 'QUOTATION', entityId: row.id, revision: row.revisionNumber, updatedAt: row.updatedAt.toISOString(), documentNumber: row.quotationNumber,
      status: row.status, currency: row.currency, total: row.grandTotal.toFixed(2), discountPercent: discountPercentage(row.subtotal, row.itemDiscountAmount.add(row.quotationDiscountAmount)), discountBase: row.subtotal.toString(), discountAmount: row.itemDiscountAmount.add(row.quotationDiscountAmount).toString() };
  }
  const kind = command.action === 'CREDIT_NOTE_ISSUE' ? 'CREDIT_NOTE' : 'INVOICE';
  const row = await tx.invoice.findFirst({ where: { id: command.entityId, firmId, kind } });
  if (!row) throw new AppError('Billing document not found', 404);
  if (row.version !== command.expectedVersion || row.status !== (command.action === 'INVOICE_VOID' ? 'ISSUED' : 'DRAFT')) throw new AppError('Document changed; reload before requesting approval', 409);
  if ('confirmedTotal' in command && !row.grandTotal.eq(command.confirmedTotal)) throw new AppError('Confirmed total changed', 409);
  return { entity: 'INVOICE', entityId: row.id, version: row.version, documentNumber: row.documentNumber ?? `Draft ${row.id}`, status: row.status,
    currency: row.currency, total: row.grandTotal.toString(), discountPercent: discountPercentage(row.subtotal, row.discountAmount), discountBase: row.subtotal.toString(), discountAmount: row.discountAmount.toString() };
}
function applies(policy: z.infer<typeof approvalPolicySchema>, evidence: { currency: string; total: string; discountBase: string; discountAmount: string }) {
  return policy.enabled && (policy.minimumAmount === undefined || evidence.currency === policy.currency && new Prisma.Decimal(evidence.total).gte(policy.minimumAmount)) &&
    (policy.discountPercent === undefined || decimal(evidence.discountAmount).mul(100).gt(decimal(evidence.discountBase).mul(decimal(policy.discountPercent))));
}

export async function quotationApprovalEnabled(tx: AutomationTx, firmId: number) {
  const head = await latestDefinition(tx, firmId, 'APPROVAL', 'QUOTATION_SEND');
  return head !== null && approvalPolicySchema.parse(head.definition).enabled;
}

// Portal customers cannot act as firm staff or consume their approvals. A pending
// quotation subject to a discount policy must first pass the staff send command.
export async function assertQuotationPublicationApproved(tx: AutomationTx, firmId: number, quotationId: number) {
  const row = await tx.quotation.findFirst({ where: { id: quotationId, firmId, deletedAt: null } });
  if (!row) throw new AppError('Quotation not found', 404);
  if (row.status !== 'PENDING' || row.sentAt !== null) return;
  const head = await latestDefinition(tx, firmId, 'APPROVAL', 'QUOTATION_SEND');
  if (!head) return;
  const policy = approvalPolicySchema.parse(head.definition);
  const discount = row.itemDiscountAmount.add(row.quotationDiscountAmount);
  const required = applies(policy, { currency: row.currency, total: row.grandTotal.toString(), discountBase: row.subtotal.toString(), discountAmount: discount.toString() });
  if (required) throw new AppError('Mark the quotation as sent after approval before sharing it with a customer', 409);
}
async function prepare(tx: AutomationTx, firmId: number, actorId: number, input: ApprovalCommand) {
  const command = approvalCommandSchema.parse(input);
  const evidence = await commandEvidence(tx, firmId, actorId, command);
  const fingerprint = requestHash({ command, evidence });
  return { command, evidence, fingerprint };
}
async function currentRequest(tx: AutomationTx, firmId: number, actorId: number, fingerprint: string) {
  return tx.approvalRequest.findFirst({ where: { firmId, requesterId: actorId, fingerprint, status: { in: ['PENDING', 'APPROVED'] }, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, include: { policy: true, decisions: { orderBy: { id: 'asc' } } } });
}
async function approver(tx: AutomationTx, firmId: number, actorId: number, requesterId: number) {
  const user = await automationAccess(tx, firmId, actorId, true);
  if (user.id === requesterId) throw new AppError('A different firm administrator must decide', 403);
}

// Called only inside the existing, firm-locked domain command transaction.
// Nothing executes here; consumption and the original business write are atomic.
export async function enforceApproval(tx: AutomationTx, firmId: number, actorId: number, input: ApprovalCommand) {
  const head = await latestDefinition(tx, firmId, 'APPROVAL', input.action);
  const outstanding = await tx.approvalRequest.count({ where: { firmId, requesterId: actorId, status: { in: ['PENDING', 'APPROVED'] }, consumedAt: null } });
  if (outstanding === 0 && (head === null || !approvalPolicySchema.parse(head.definition).enabled)) return;
  const prepared = await prepare(tx, firmId, actorId, input);
  const existing = await currentRequest(tx, firmId, actorId, prepared.fingerprint);
  const policy = existing ? approvalPolicySchema.parse(existing.policy.definition) : head ? approvalPolicySchema.parse(head.definition) : null;
  if (!existing && (policy === null || !applies(policy, prepared.evidence))) return;
  await assertTransactionFeature(tx, firmId, 'automation');
  if (!existing || existing.status !== 'APPROVED') throw new AppError('This action requires approval from another firm administrator', 409, { code: 'APPROVAL_REQUIRED', command: prepared.command });
  const decision = existing.decisions.at(-1);
  if (!decision || decision.decision !== 'APPROVED') throw new AppError('Approval decision is unavailable', 409);
  await approver(tx, firmId, decision.actorId, actorId);
  await tx.approvalRequest.update({ where: { id: existing.id }, data: { consumedAt: new Date() } });
  await auditAutomation(tx, firmId, actorId, 'ApprovalRequest', existing.id, { status: 'CONSUMED', policyId: existing.policyId, decisionId: decision.id });
}

export class ApprovalsRepository {
  constructor(private readonly db: PrismaClient) {}
  async request(firmId: number, actorId: number, input: ApprovalCommand) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await assertTransactionFeature(tx, firmId, 'automation');
      const prepared = await prepare(tx, firmId, actorId, input);
      const existing = await currentRequest(tx, firmId, actorId, prepared.fingerprint);
      if (existing) return existing;
      const head = await latestDefinition(tx, firmId, 'APPROVAL', input.action);
      if (!head) throw new AppError('No approval policy applies', 409);
      const policy = approvalPolicySchema.parse(head.definition);
      if (!applies(policy, prepared.evidence)) throw new AppError('No approval policy applies', 409);
      const row = await tx.approvalRequest.create({ data: { id: randomUUID(), firmId, requesterId: actorId, policyId: head.id, command: prepared.command,
        evidence: jsonObject(prepared.evidence), fingerprint: prepared.fingerprint, expiresAt: new Date(Date.now() + policy.expiresAfterHours * 3600000) } });
      await auditAutomation(tx, firmId, actorId, 'ApprovalRequest', row.id, { status: 'PENDING', policyId: head.id });
      return row;
    });
  }
  async list(firmId: number, actorId: number, page = 1) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await assertTransactionFeature(tx, firmId, 'automation');
      const actor = await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.AUTOMATION_VIEW);
      if (actor.firmId !== firmId) throw new AppError('Firm membership is required', 403);
      const where = { firmId, ...(actor.accountType === 'FIRM_ADMIN' ? {} : { requesterId: actorId }) };
      return tx.approvalRequest.findMany({ where, include: { policy: true, decisions: { orderBy: { id: 'asc' } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 50, take: 50 });
    });
  }
  async decide(firmId: number, actorId: number, id: string, input: z.infer<typeof decisionSchema>) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await assertTransactionFeature(tx, firmId, 'automation');
      const row = await tx.approvalRequest.findFirst({ where: { id, firmId } });
      if (!row) throw new AppError('Approval request not found', 404);
      const command = approvalCommandSchema.parse(row.command);
      if (input.decision === 'CANCELLED') {
        await automationAccess(tx, firmId, actorId);
        if (actorId !== row.requesterId) throw new AppError('Only the requester may cancel', 403);
      } else await approver(tx, firmId, actorId, row.requesterId);
      if (row.consumedAt || row.expiresAt <= new Date() || (input.decision === 'REVOKED' ? row.status !== 'APPROVED' : row.status !== 'PENDING')) throw new AppError('Approval is terminal, expired or already decided', 409);
      if (input.decision === 'APPROVED') {
        const prepared = await prepare(tx, firmId, row.requesterId, command);
        if (prepared.fingerprint !== row.fingerprint) throw new AppError('The requested action changed; request a new approval', 409);
      }
      await tx.approvalDecision.create({ data: { firmId, requestId: id, actorId, ...input } });
      await tx.approvalRequest.update({ where: { id }, data: { status: input.decision } });
      await auditAutomation(tx, firmId, actorId, 'ApprovalRequest', id, { status: input.decision, policyId: row.policyId });
      return { id, status: input.decision };
    });
  }
}
export const approvalsRepository = new ApprovalsRepository(prisma);
