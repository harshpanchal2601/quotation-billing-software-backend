import { AuditAction, type Prisma } from '@prisma/client';
import type { z } from 'zod';
import { createAuditLog } from '../../core/audit/audit-log.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature } from '../entitlements/index.js';
import { ACTION_ACCESS, ENTITY_ACCESS, TRIGGER_READ_ACCESS, type ApprovalAction } from './automation.contract.js';
import type { definitionKindSchema } from './automation.schema.js';

export type DefinitionKind = z.infer<typeof definitionKindSchema>;
export type AutomationTx = Prisma.TransactionClient;
export async function automationAccess(tx: AutomationTx, firmId: number, actorId: number, manage = false) {
  const actor = await authorizeFirmJobActor(tx, firmId, actorId, manage ? PERMISSIONS.AUTOMATION_MANAGE : PERMISSIONS.AUTOMATION_VIEW);
  if (actor.firmId !== firmId || manage && actor.accountType !== 'FIRM_ADMIN') throw new AppError('An active administrator in this firm is required', 403);
  await assertTransactionFeature(tx, firmId, 'automation');
  return actor;
}
export async function automationAvailable(tx: AutomationTx, firmId: number) {
  try { await assertTransactionFeature(tx, firmId, 'automation'); return true; }
  catch (error) { if (error instanceof AppError && error.statusCode === 403) return false; throw error; }
}
export function latestDefinition(tx: AutomationTx, firmId: number, kind: DefinitionKind, key: string) {
  return tx.automationDefinitionVersion.findFirst({ where: { firmId, kind, key }, orderBy: { version: 'desc' } });
}
export async function publishedHeads(tx: AutomationTx, firmId: number, kind: DefinitionKind) {
  const heads = await tx.automationDefinitionVersion.groupBy({ by: ['key'], where: { firmId, kind }, _max: { version: true } });
  if (!heads.length) return [];
  if (heads.length > 100) throw new AppError('Configuration limit exceeded', 409);
  return tx.automationDefinitionVersion.findMany({ where: { firmId, kind, OR: heads.map((head) => ({ key: head.key, version: head._max.version! })) }, orderBy: { key: 'asc' } });
}
export async function auditAutomation(tx: AutomationTx, firmId: number, actorId: number, entityType: string, id: string | number, values: Prisma.InputJsonObject) {
  await createAuditLog(tx, { metadata: { firmId, userId: actorId }, entityType, entityId: String(id), action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: values });
}
export async function ownedAutomationEntity(tx: AutomationTx, firmId: number, entity: keyof typeof ENTITY_ACCESS, entityId: number) {
  const where = { id: entityId, firmId };
  const row = entity === 'COMPANY' ? await tx.company.findFirst({ where: { ...where, deletedAt: null }, select: { id: true } })
    : entity === 'ITEM' ? await tx.item.findFirst({ where: { ...where, deletedAt: null }, select: { id: true } })
      : entity === 'QUOTATION' ? await tx.quotation.findFirst({ where: { ...where, deletedAt: null }, select: { id: true } })
        : entity === 'INVOICE' ? await tx.invoice.findFirst({ where, select: { id: true } })
          : entity === 'SALES_ORDER' ? await tx.salesOrder.findFirst({ where, select: { id: true } })
            : await tx.stockOperation.findFirst({ where, select: { id: true } });
  if (!row) throw new AppError('Resource not found', 404);
}
export async function entityAccess(tx: AutomationTx, firmId: number, actorId: number, entity: keyof typeof ENTITY_ACCESS, edit = false) {
  const access = ENTITY_ACCESS[entity];
  const actor = await authorizeFirmJobActor(tx, firmId, actorId, edit ? access.edit : access.view);
  if (actor.firmId !== firmId) throw new AppError('Firm membership is required', 403);
  await assertTransactionFeature(tx, firmId, access.feature);
}
export async function actionAccess(tx: AutomationTx, firmId: number, actorId: number, action: ApprovalAction) {
  const access = ACTION_ACCESS[action];
  let actor: Awaited<ReturnType<typeof authorizeFirmJobActor>>;
  try { actor = await authorizeFirmJobActor(tx, firmId, actorId, access.permission); }
  catch (error) {
    // Both existing send paths may request the same discount approval. Each
    // original command still enforces its own permission before doing work.
    if (action !== 'QUOTATION_SEND' || !(error instanceof AppError) || error.statusCode !== 403) throw error;
    actor = await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.QUOTATIONS_EMAIL);
    await assertTransactionFeature(tx, firmId, 'quotations.email');
  }
  if (actor.firmId !== firmId) throw new AppError('Firm membership is required for approvals', 403);
  await assertTransactionFeature(tx, firmId, access.feature);
}
export async function eventAccess(tx: AutomationTx, firmId: number, actorId: number, trigger: keyof typeof TRIGGER_READ_ACCESS) {
  const access = TRIGGER_READ_ACCESS[trigger];
  const actor = await authorizeFirmJobActor(tx, firmId, actorId, access.permission);
  if (actor.firmId !== firmId) throw new AppError('Firm membership is required for notifications', 403);
  await assertTransactionFeature(tx, firmId, access.feature);
}
