import type {
  Company,
  Quotation,
  QuotationItem,
  QuotationStatus,
  QuotationStatusHistory,
  User,
} from '@prisma/client';

export type UserSummary = {
  id: number;
  name: string;
  email: string;
};

export type CompanySummary = {
  id: number;
  companyCode: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
};

export function serialiseUserSummary(user: User | null | undefined): UserSummary | null {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

export function serialiseCompanySummary(company: Company | null | undefined): CompanySummary | null {
  if (!company) return null;
  return {
    id: company.id,
    companyCode: company.companyCode,
    name: company.name,
    legalName: company.legalName,
    gstin: company.gstin,
  };
}

export function serialiseQuotationItem(item: QuotationItem) {
  return {
    id: item.id,
    quotationId: item.quotationId,
    itemId: item.itemId,
    lineNumber: item.lineNumber,
    itemCodeSnapshot: item.itemCodeSnapshot,
    itemNameSnapshot: item.itemNameSnapshot,
    descriptionSnapshot: item.descriptionSnapshot,
    specificationsSnapshot: item.specificationsSnapshot,
    measurementUnitSnapshot: item.measurementUnitSnapshot,
    quantity: item.quantity.toFixed(3),
    unitRate: item.unitRate.toFixed(2),
    discountType: item.discountType,
    discountValue: item.discountValue.toFixed(2),
    discountAmount: item.discountAmount.toFixed(2),
    gstRate: item.gstRate.toFixed(2),
    baseAmount: item.baseAmount.toFixed(2),
    taxableAmount: item.taxableAmount.toFixed(2),
    taxAmount: item.taxAmount.toFixed(2),
    lineTotal: item.lineTotal.toFixed(2),
    sortOrder: item.sortOrder,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function serialiseQuotationRevisionSummary(
  quotation: Pick<
    Quotation,
    'id' | 'quotationNumber' | 'revisionNumber' | 'status' | 'isLatestRevision' | 'createdAt'
  > | null | undefined,
) {
  if (!quotation) return null;

  return {
    id: quotation.id,
    quotationNumber: quotation.quotationNumber,
    revisionNumber: quotation.revisionNumber,
    status: quotation.status,
    isLatestRevision: quotation.isLatestRevision,
    createdAt: quotation.createdAt.toISOString(),
  };
}

function canEditQuotation(status: QuotationStatus, isLatestRevision: boolean) {
  return status === 'DRAFT' && isLatestRevision;
}

function canCreateQuotationRevision(status: QuotationStatus, isLatestRevision: boolean) {
  return status !== 'DRAFT' && isLatestRevision;
}

export function serialiseQuotationListItem(
  quotation: Quotation & {
    company?: Company;
    createdBy?: User;
    _count?: { items?: number };
  },
) {
  return {
    id: quotation.id,
    quotationNumber: quotation.quotationNumber,
    revisionNumber: quotation.revisionNumber,
    rootQuotationId: quotation.rootQuotationId,
    previousRevisionId: quotation.previousRevisionId,
    isLatestRevision: quotation.isLatestRevision,
    canEdit: canEditQuotation(quotation.status, quotation.isLatestRevision),
    canCreateRevision: canCreateQuotationRevision(quotation.status, quotation.isLatestRevision),
    companyId: quotation.companyId,
    company: quotation.company ? serialiseCompanySummary(quotation.company) : {
      id: quotation.companyId,
      companyCode: '',
      name: quotation.companyNameSnapshot,
      legalName: null,
      gstin: quotation.companyGstinSnapshot,
    },
    companyNameSnapshot: quotation.companyNameSnapshot,
    companyGstinSnapshot: quotation.companyGstinSnapshot,
    quotationDate: quotation.quotationDate.toISOString(),
    validUntil: quotation.validUntil ? quotation.validUntil.toISOString() : null,
    status: quotation.status,
    currency: quotation.currency,
    itemCount: quotation._count?.items ?? 0,
    subtotal: quotation.subtotal.toFixed(2),
    grandTotal: quotation.grandTotal.toFixed(2),
    createdBy: serialiseUserSummary(quotation.createdBy),
    createdAt: quotation.createdAt.toISOString(),
    updatedAt: quotation.updatedAt.toISOString(),
  };
}

export function serialiseQuotationStatusHistory(
  history: QuotationStatusHistory & { changedBy?: User | null },
) {
  return {
    id: history.id,
    fromStatus: history.fromStatus,
    toStatus: history.toStatus,
    comment: history.comment,
    changedBy: serialiseUserSummary(history.changedBy),
    changedAt: history.changedAt.toISOString(),
  };
}

export function serialiseQuotationDetail(
  quotation: Quotation & {
    company?: Company | null;
    createdBy?: User | null;
    updatedBy?: User | null;
    items?: QuotationItem[];
    statusHistory?: (QuotationStatusHistory & { changedBy?: User | null })[];
    previousRevision?: Quotation | null;
    nextRevision?: Quotation | null;
    latestRevision?: Quotation | null;
  },
) {
  return {
    id: quotation.id,
    quotationNumber: quotation.quotationNumber,
    revisionNumber: quotation.revisionNumber,
    rootQuotationId: quotation.rootQuotationId,
    previousRevisionId: quotation.previousRevisionId,
    isLatestRevision: quotation.isLatestRevision,
    canEdit: canEditQuotation(quotation.status, quotation.isLatestRevision),
    canCreateRevision: canCreateQuotationRevision(quotation.status, quotation.isLatestRevision),
    previousRevision: serialiseQuotationRevisionSummary(quotation.previousRevision),
    nextRevision: serialiseQuotationRevisionSummary(quotation.nextRevision),
    latestRevision: serialiseQuotationRevisionSummary(quotation.latestRevision),
    companyId: quotation.companyId,
    companyContactId: quotation.companyContactId,
    billingAddressId: quotation.billingAddressId,
    shippingAddressId: quotation.shippingAddressId,
    company: quotation.company ? serialiseCompanySummary(quotation.company) : null,
    companyNameSnapshot: quotation.companyNameSnapshot,
    companyGstinSnapshot: quotation.companyGstinSnapshot,
    companyPanSnapshot: quotation.companyPanSnapshot,
    contactNameSnapshot: quotation.contactNameSnapshot,
    contactEmailSnapshot: quotation.contactEmailSnapshot,
    contactPhoneSnapshot: quotation.contactPhoneSnapshot,
    billingAddressSnapshot: quotation.billingAddressSnapshot,
    shippingAddressSnapshot: quotation.shippingAddressSnapshot,
    quotationDate: quotation.quotationDate.toISOString(),
    validUntil: quotation.validUntil ? quotation.validUntil.toISOString() : null,
    customerReference: quotation.customerReference,
    internalReference: quotation.internalReference,
    status: quotation.status,
    currency: quotation.currency,
    taxMode: quotation.taxMode,
    subtotal: quotation.subtotal.toFixed(2),
    itemDiscountAmount: quotation.itemDiscountAmount.toFixed(2),
    quotationDiscountType: quotation.quotationDiscountType,
    quotationDiscountValue: quotation.quotationDiscountValue.toFixed(2),
    quotationDiscountAmount: quotation.quotationDiscountAmount.toFixed(2),
    taxableAmount: quotation.taxableAmount.toFixed(2),
    cgstAmount: quotation.cgstAmount.toFixed(2),
    sgstAmount: quotation.sgstAmount.toFixed(2),
    igstAmount: quotation.igstAmount.toFixed(2),
    freightAmount: quotation.freightAmount.toFixed(2),
    freightIncluded: quotation.freightIncluded,
    freightIsTaxable: quotation.freightIsTaxable,
    otherCharges: quotation.otherCharges.toFixed(2),
    roundOffAmount: quotation.roundOffAmount.toFixed(2),
    grandTotal: quotation.grandTotal.toFixed(2),
    amountInWords: quotation.amountInWords,
    deliveryTerms: quotation.deliveryTerms,
    dispatchTerms: quotation.dispatchTerms,
    paymentTerms: quotation.paymentTerms,
    taxTerms: quotation.taxTerms,
    freightTerms: quotation.freightTerms,
    warrantyTerms: quotation.warrantyTerms,
    remarks: quotation.remarks,
    termsAndConditions: quotation.termsAndConditions,
    internalNotes: quotation.internalNotes,
    sentAt: quotation.sentAt ? quotation.sentAt.toISOString() : null,
    acceptedAt: quotation.acceptedAt ? quotation.acceptedAt.toISOString() : null,
    rejectedAt: quotation.rejectedAt ? quotation.rejectedAt.toISOString() : null,
    completedAt: quotation.completedAt ? quotation.completedAt.toISOString() : null,
    createdBy: serialiseUserSummary(quotation.createdBy),
    updatedBy: serialiseUserSummary(quotation.updatedBy),
    createdAt: quotation.createdAt.toISOString(),
    updatedAt: quotation.updatedAt.toISOString(),
    items: quotation.items ? quotation.items.map(serialiseQuotationItem) : [],
    statusHistory: quotation.statusHistory
      ? quotation.statusHistory.map(serialiseQuotationStatusHistory)
      : [],
  };
}
