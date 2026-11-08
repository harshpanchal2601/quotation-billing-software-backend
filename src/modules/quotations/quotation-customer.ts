import type { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';
import { calendarDate } from '../../core/validation/calendar-date.js';
import { getStatusTimestampUpdate, validateStatusTransition } from './quotation-status.js';
import { assertQuotationPublicationApproved } from '../automation/runtime.js';

// Deliberate allowlist shared by order snapshots and portal grants. Never
// serialize a whole quotation: it contains internal notes and staff identities.
export function customerQuotationSnapshot(source: Prisma.QuotationGetPayload<{ include: { items: true } }>) {
  return {
    kind: 'QUOTATION', id: source.id, quotationNumber: source.quotationNumber, revisionNumber: source.revisionNumber,
    companyName: source.companyNameSnapshot, gstin: source.companyGstinSnapshot, pan: source.companyPanSnapshot,
    billingAddress: source.billingAddressSnapshot, shippingAddress: source.shippingAddressSnapshot,
    quotationDate: source.quotationDate.toISOString().slice(0, 10), validUntil: source.validUntil?.toISOString().slice(0, 10) ?? null,
    currency: source.currency, taxMode: source.taxMode, grandTotal: source.grandTotal.toFixed(2),
    freightAmount: source.freightAmount.toFixed(2), otherCharges: source.otherCharges.toFixed(2),
    deliveryTerms: source.deliveryTerms, dispatchTerms: source.dispatchTerms, paymentTerms: source.paymentTerms,
    taxTerms: source.taxTerms, freightTerms: source.freightTerms, warrantyTerms: source.warrantyTerms,
    termsAndConditions: source.termsAndConditions, customerReference: source.customerReference,
    remarks: source.remarks,
    items: source.items.map((line) => ({ lineNumber: line.lineNumber, itemId: line.itemId, itemCode: line.itemCodeSnapshot, itemName: line.itemNameSnapshot, description: line.descriptionSnapshot, specifications: line.specificationsSnapshot, measurementUnit: line.measurementUnitSnapshot,
      quantity: line.quantity.toFixed(3), unitRate: line.unitRate.toFixed(2), discountType: line.discountType, discountValue: line.discountValue.toFixed(2), discountAmount: line.discountAmount.toFixed(2), taxRate: line.gstRate.toFixed(2), baseAmount: line.baseAmount.toFixed(2), taxableAmount: line.taxableAmount.toFixed(2), taxAmount: line.taxAmount.toFixed(2), lineTotal: line.lineTotal.toFixed(2) })),
  };
}

export function isCustomerQuotationDecisionOpen(source: { isLatestRevision: boolean; status: string; validUntil: Date | null }, now = new Date()) {
  return source.isLatestRevision && ['PENDING', 'SENT'].includes(source.status) && (!source.validUntil || source.validUntil.toISOString().slice(0, 10) >= calendarDate(now, 'Asia/Kolkata'));
}

// Portal owns identity/evidence; Quotations continues to own its lifecycle.
// Caller holds the firm and quotation row locks and has verified the grant hash.
export async function applyPortalQuotationDecision(tx: Prisma.TransactionClient, firmId: number, quotationId: number, decision: 'ACCEPTED' | 'REJECTED', actorName: string, acceptanceId: number) {
  await assertQuotationPublicationApproved(tx, firmId, quotationId);
  const source = await tx.quotation.findFirst({ where: { id: quotationId, firmId, deletedAt: null } });
  if (!source) throw new AppError('Quotation revision unavailable', 404);
  if (!isCustomerQuotationDecisionOpen(source)) throw new AppError('Quotation revision is no longer open for a decision', 409);
  validateStatusTransition(source.status, decision);
  const result = await tx.quotation.updateMany({ where: { id: quotationId, firmId, status: source.status, updatedAt: source.updatedAt, isLatestRevision: true }, data: { status: decision, ...getStatusTimestampUpdate(decision) } });
  if (result.count !== 1) throw new AppError('Quotation changed; reload the shared revision', 409);
  await tx.quotationStatusHistory.create({ data: { quotationId, fromStatus: source.status, toStatus: decision, changedById: null, portalActorName: actorName, comment: `Customer portal decision; evidence #${acceptanceId}` } });
}
