import type {
  Company,
  CompanyAddress,
  CompanyContact,
  Prisma,
  Quotation,
} from '@prisma/client';

type CompanyWithRelations = Company & {
  contacts?: CompanyContact[];
  addresses?: CompanyAddress[];
  _count?: { quotations?: number };
};

export function serialiseContact(contact: CompanyContact) {
  return {
    id: contact.id,
    name: contact.name,
    designation: contact.designation,
    email: contact.email,
    phone: contact.phone,
    alternatePhone: contact.alternatePhone,
    isPrimary: contact.isPrimary,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

export function serialiseAddress(address: CompanyAddress) {
  return {
    id: address.id,
    addressType: address.addressType,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    isPrimary: address.isPrimary,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  };
}

export function serialiseCompanyListItem(company: CompanyWithRelations) {
  const contacts = company.contacts ?? [];
  const addresses = company.addresses ?? [];
  const primaryContact = contacts.find((contact) => contact.isPrimary);
  return {
    id: company.id,
    companyCode: company.companyCode,
    name: company.name,
    legalName: company.legalName,
    gstin: company.gstin,
    pan: company.pan,
    website: company.website,
    isActive: company.isActive,
    primaryContact: primaryContact === undefined ? null : serialiseContact(primaryContact),
    primaryBillingAddress: serialisePrimaryAddress(addresses, 'BILLING'),
    primaryShippingAddress: serialisePrimaryAddress(addresses, 'SHIPPING'),
    quotationCount: company._count?.quotations ?? 0,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}

export function serialiseCompanyDetail(
  company: CompanyWithRelations,
  quotationSummary: {
    total: number;
    draft: number;
    pending: number;
    completed: number;
  },
) {
  const contacts = company.contacts ?? [];
  const addresses = company.addresses ?? [];
  const primaryContact = contacts.find((contact) => contact.isPrimary);
  return {
    id: company.id,
    companyCode: company.companyCode,
    name: company.name,
    legalName: company.legalName,
    gstin: company.gstin,
    pan: company.pan,
    website: company.website,
    notes: company.notes,
    isActive: company.isActive,
    contacts: contacts.map(serialiseContact),
    addresses: addresses.map(serialiseAddress),
    primaryContact: primaryContact === undefined ? null : serialiseContact(primaryContact),
    primaryBillingAddress: serialisePrimaryAddress(addresses, 'BILLING'),
    primaryShippingAddress: serialisePrimaryAddress(addresses, 'SHIPPING'),
    quotationSummary,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}

export function serialiseQuotationSummary(
  quotation: Pick<
    Quotation,
    | 'id'
    | 'quotationNumber'
    | 'revisionNumber'
    | 'quotationDate'
    | 'validUntil'
    | 'status'
    | 'currency'
    | 'grandTotal'
    | 'createdAt'
  >,
) {
  return {
    id: quotation.id,
    quotationNumber: quotation.quotationNumber,
    revisionNumber: quotation.revisionNumber,
    quotationDate: quotation.quotationDate.toISOString(),
    validUntil: quotation.validUntil?.toISOString() ?? null,
    status: quotation.status,
    currency: quotation.currency,
    grandTotal: serialiseDecimal(quotation.grandTotal),
    createdAt: quotation.createdAt.toISOString(),
  };
}

function serialisePrimaryAddress(addresses: CompanyAddress[], addressType: CompanyAddress['addressType']) {
  const address = addresses.find((item) => item.addressType === addressType && item.isPrimary);
  return address === undefined ? null : serialiseAddress(address);
}

function serialiseDecimal(value: Prisma.Decimal) {
  return value.toFixed(2);
}
