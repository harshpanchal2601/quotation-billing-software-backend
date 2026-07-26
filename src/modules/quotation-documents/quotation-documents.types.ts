import type { DocumentType } from '@prisma/client';

export type GeneratedDocumentDto = {
  id: number;
  quotationId: number;
  versionNumber: number;
  documentType: DocumentType;
  filePath: string;
  fileHash: string | null;
  generatedById: number;
  generatedAt: string;
};

export type GeneratedDocumentHistoryItemDto = {
  id: number;
  quotationId: number;
  versionNumber: number;
  documentType: DocumentType;
  quotationNumber: string;
  displayFilename: string;
  generatedAt: string;
  generatedBy?: {
    id: number;
    name: string;
  };
  isAvailable: boolean;
  canPreview: boolean;
  canEmail: boolean;
};

export type GeneratedDocumentHistoryResponse = {
  documents: GeneratedDocumentHistoryItemDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type SendQuotationEmailInput = {
  generatedDocumentId: number;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  message: string;
  attachmentIds?: number[];
};

export type SendQuotationEmailResponse = {
  quotationId: number;
  generatedDocumentId: number;
  recipientCount: number;
  attachmentCount: number;
  acceptedAt: string;
};

export type QuotationPdfViewModel = {
  quotationNumber: string;
  revisionNumber: number;
  quotationDate: string;
  validUntil: string | null;
  status: string;
  currency: string;
  taxMode: string;
  companyNameSnapshot: string;
  companyGstinSnapshot: string | null;
  companyPanSnapshot: string | null;
  contactNameSnapshot: string | null;
  contactEmailSnapshot: string | null;
  contactPhoneSnapshot: string | null;
  billingAddressSnapshot: {
    addressLine1?: string;
    addressLine2?: string | null;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } | null;
  shippingAddressSnapshot: {
    addressLine1?: string;
    addressLine2?: string | null;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } | null;
  subtotal: string;
  itemDiscountAmount: string;
  quotationDiscountType: string;
  quotationDiscountValue: string;
  quotationDiscountAmount: string;
  taxableAmount: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  freightAmount: string;
  otherCharges: string;
  roundOffAmount: string;
  grandTotal: string;
  amountInWords: string | null;
  deliveryTerms: string | null;
  dispatchTerms: string | null;
  paymentTerms: string | null;
  taxTerms: string | null;
  freightTerms: string | null;
  warrantyTerms: string | null;
  remarks: string | null;
  termsAndConditions: string | null;
  items: {
    lineNumber: number;
    itemCodeSnapshot: string | null;
    itemNameSnapshot: string;
    descriptionSnapshot: string | null;
    measurementUnitSnapshot: string;
    quantity: string;
    unitRate: string;
    discountType: string;
    discountValue: string;
    discountAmount: string;
    taxableAmount: string;
    gstRate: string;
    taxAmount: string;
    lineTotal: string;
  }[];
  businessProfile: {
    legalName: string;
    displayName: string;
    gstin: string | null;
    pan: string | null;
    cin: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    primaryPhone: string | null;
    primaryEmail: string | null;
    website: string | null;
    logoDataUrl: string | null;
    signatureDataUrl: string | null;
    stampDataUrl: string | null;
    primaryColour: string;
    secondaryColour: string;
  } | null;
  bankDetail: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    ifscCode: string | null;
    branchName: string | null;
    swiftCode: string | null;
  } | null;
};
