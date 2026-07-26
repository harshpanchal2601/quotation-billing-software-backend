import type {
  DiscountType,
  QuotationStatus,
  TaxMode,
} from '@prisma/client';

export type AddressSnapshot = {
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type QuotationItemInput = {
  itemId?: number | null;
  lineNumber?: number;
  itemName?: string;
  description?: string | null;
  specifications?: unknown;
  measurementUnit?: string;
  quantity: number | string;
  unitRate: number | string;
  discountType?: DiscountType;
  discountValue?: number | string;
  gstRate?: number | string;
  sortOrder?: number;
};

export type CalculationPreviewInput = {
  taxMode?: TaxMode;
  quotationDiscountType?: DiscountType;
  quotationDiscountValue?: number | string;
  freightAmount?: number | string;
  otherCharges?: number | string;
  items: QuotationItemInput[];
};

export type CalculatedLineItem = {
  lineNumber: number;
  itemId: number | null;
  itemCodeSnapshot: string | null;
  itemNameSnapshot: string;
  descriptionSnapshot: string | null;
  specificationsSnapshot: unknown;
  measurementUnitSnapshot: string;
  quantity: string;
  unitRate: string;
  discountType: DiscountType;
  discountValue: string;
  discountAmount: string;
  baseAmount: string;
  taxableAmount: string;
  gstRate: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  taxAmount: string;
  lineTotal: string;
  sortOrder: number;
};

export type CalculatedQuotationTotals = {
  subtotal: string;
  itemDiscountAmount: string;
  quotationDiscountType: DiscountType;
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
  amountInWords: string;
  items: CalculatedLineItem[];
};

export type QuotationCreateInput = {
  companyId: number;
  companyContactId?: number | null;
  billingAddressId?: number | null;
  shippingAddressId?: number | null;
  quotationDate: string | Date;
  validUntil?: string | Date | null;
  customerReference?: string | null;
  internalReference?: string | null;
  currency?: string;
  taxMode?: TaxMode;
  quotationDiscountType?: DiscountType;
  quotationDiscountValue?: number | string;
  freightAmount?: number | string;
  otherCharges?: number | string;
  deliveryTerms?: string | null;
  dispatchTerms?: string | null;
  paymentTerms?: string | null;
  taxTerms?: string | null;
  freightTerms?: string | null;
  warrantyTerms?: string | null;
  remarks?: string | null;
  termsAndConditions?: string | null;
  internalNotes?: string | null;
  items: QuotationItemInput[];
};

export type QuotationUpdateInput = Partial<QuotationCreateInput>;

export type QuotationListQuery = {
  page: number;
  limit: number;
  search?: string;
  companyId?: number;
  status?: QuotationStatus;
  dateFrom?: string;
  dateTo?: string;
  validFrom?: string;
  validTo?: string;
  minTotal?: number;
  maxTotal?: number;
  sortBy: 'quotationNumber' | 'quotationDate' | 'validUntil' | 'grandTotal' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
};

export type QuotationStatusUpdateInput = {
  status: QuotationStatus;
  comment?: string | null;
};
