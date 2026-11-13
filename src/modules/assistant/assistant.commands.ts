import type { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { jsonObject } from '../../core/serialization/json.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { assertTransactionFeature } from '../entitlements/index.js';
import { ACTION_ACCESS, approvalCommandSchema, type ApprovalCommand } from '../automation/contract.js';
import { prepareApprovedCommand } from '../automation/runtime.js';
import { issueBillingDocumentInTransaction, voidBillingDocumentInTransaction } from '../invoices/index.js';
import { confirmOrderInTransaction } from '../sales-orders/index.js';
import { adjustStockInTransaction, previewStockAdjustment } from '../inventory/index.js';
import { changeQuotationStatusInTransaction } from '../quotations/index.js';

export async function authorizeAssistantCommand(tx: Prisma.TransactionClient, firmId: number, actorId: number, command: ApprovalCommand) {
  const access = ACTION_ACCESS[command.action];
  const actor = await authorizeFirmJobActor(tx, firmId, actorId, access.permission);
  if (actor.firmId !== firmId) throw new AppError('Firm membership is required', 403);
  await assertTransactionFeature(tx, firmId, access.feature);
  if (command.action === 'QUOTATION_SEND' && !command.status) throw new AppError('Complete emails in the quotation screen', 400);
}
export async function prepareAssistantCommand(tx: Prisma.TransactionClient, firmId: number, actorId: number, input: ApprovalCommand) {
  const command = approvalCommandSchema.parse(input);
  await authorizeAssistantCommand(tx, firmId, actorId, command);
  const prepared = await prepareApprovedCommand(tx, firmId, actorId, command);
  const stock = command.action === 'STOCK_ADJUST' ? await previewStockAdjustment(tx, firmId, { itemId: command.entityId, warehouseId: command.warehouseId, direction: command.direction, quantity: command.quantity, unitCost: command.unitCost }) : null;
  const before = jsonObject({ ...prepared.evidence, ...(stock?.before ?? {}) });
  const after = stock ? stock.after : command.action === 'INVOICE_VOID' ? { status: 'VOID' } : command.action === 'ORDER_CONFIRM' ? { creates: 'SALES_ORDER' } : { status: command.action === 'QUOTATION_SEND' ? command.status : 'ISSUED' };
  return { command, before, after, fingerprint: requestHash({ command, before }) };
}
export async function executeAssistantCommand(tx: Prisma.TransactionClient, firmId: number, actorId: number, command: ApprovalCommand) {
  await authorizeAssistantCommand(tx, firmId, actorId, command);
  const metadata = { firmId, userId: actorId };
  const result = command.action === 'INVOICE_ISSUE' || command.action === 'CREDIT_NOTE_ISSUE'
    ? await issueBillingDocumentInTransaction(tx, firmId, actorId, command.entityId, command.expectedVersion, command.confirmedTotal, command.action === 'INVOICE_ISSUE' ? 'INVOICE' : 'ADJUSTMENT', metadata)
    : command.action === 'INVOICE_VOID' ? await voidBillingDocumentInTransaction(tx, firmId, actorId, command.entityId, command.expectedVersion, command.reason, 'INVOICE', metadata)
      : command.action === 'ORDER_CONFIRM' ? await confirmOrderInTransaction(tx, firmId, actorId, { sourceRevisionId: command.entityId, idempotencyKey: command.idempotencyKey }, metadata)
        : command.action === 'STOCK_ADJUST' ? await adjustStockInTransaction(tx, firmId, actorId, { itemId: command.entityId, warehouseId: command.warehouseId, direction: command.direction, quantity: command.quantity, unitCost: command.unitCost, reason: command.reason, idempotencyKey: command.idempotencyKey }, metadata)
          : await changeQuotationStatusInTransaction(tx, firmId, command.entityId, { status: command.status!, comment: command.comment }, metadata, actorId);
  return { id: result.id, action: command.action, href: command.action === 'STOCK_ADJUST' ? '/inventory' : command.action === 'ORDER_CONFIRM' ? `/sales-orders/${result.id}` : command.action === 'QUOTATION_SEND' ? `/quotations/${result.id}` : command.action === 'CREDIT_NOTE_ISSUE' ? `/billing-adjustments/${result.id}` : `/invoices/${result.id}` };
}
