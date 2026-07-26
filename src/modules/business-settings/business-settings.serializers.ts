import type { BankDetail, BusinessProfile, QuotationSetting } from '@prisma/client';

export function toAssetUrl(path: string | null) {
  return path === null ? null : `/storage/${path}`;
}

export function serialiseBusinessProfile(profile: BusinessProfile) {
  return {
    id: profile.id,
    legalName: profile.legalName,
    displayName: profile.displayName,
    gstin: profile.gstin,
    pan: profile.pan,
    cin: profile.cin,
    addressLine1: profile.addressLine1,
    addressLine2: profile.addressLine2,
    city: profile.city,
    state: profile.state,
    postalCode: profile.postalCode,
    country: profile.country,
    primaryPhone: profile.primaryPhone,
    secondaryPhone: profile.secondaryPhone,
    primaryEmail: profile.primaryEmail,
    secondaryEmail: profile.secondaryEmail,
    website: profile.website,
    logoUrl: toAssetUrl(profile.logoPath),
    signatureUrl: toAssetUrl(profile.signaturePath),
    stampUrl: toAssetUrl(profile.stampPath),
    primaryColour: profile.primaryColour,
    secondaryColour: profile.secondaryColour,
    defaultCurrency: profile.defaultCurrency,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export function serialiseQuotationSettings(settings: QuotationSetting) {
  return {
    id: settings.id,
    businessProfileId: settings.businessProfileId,
    quotationPrefix: settings.quotationPrefix,
    financialYearFormat: settings.financialYearFormat,
    nextSequenceNumber: settings.nextSequenceNumber,
    sequenceResetRule: settings.sequenceResetRule,
    defaultValidityDays: settings.defaultValidityDays,
    defaultTaxMode: settings.defaultTaxMode,
    defaultGstRate: settings.defaultGstRate.toFixed(2),
    defaultDeliveryTerms: settings.defaultDeliveryTerms,
    defaultDispatchTerms: settings.defaultDispatchTerms,
    defaultPaymentTerms: settings.defaultPaymentTerms,
    defaultFreightTerms: settings.defaultFreightTerms,
    defaultWarrantyTerms: settings.defaultWarrantyTerms,
    defaultRemarks: settings.defaultRemarks,
    defaultTermsAndConditions: settings.defaultTermsAndConditions,
    showBankDetails: settings.showBankDetails,
    showAmountInWords: settings.showAmountInWords,
    createdAt: settings.createdAt.toISOString(),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export function serialiseBankDetail(bankDetail: BankDetail) {
  return {
    id: bankDetail.id,
    bankName: bankDetail.bankName,
    accountName: bankDetail.accountName,
    accountNumber: bankDetail.accountNumber,
    accountType: bankDetail.accountType,
    ifscCode: bankDetail.ifscCode,
    branchName: bankDetail.branchName,
    swiftCode: bankDetail.swiftCode,
    upiId: bankDetail.upiId,
    isDefault: bankDetail.isDefault,
    createdAt: bankDetail.createdAt.toISOString(),
    updatedAt: bankDetail.updatedAt.toISOString(),
  };
}

export function maskAccountNumber(accountNumber: string) {
  const trimmed = accountNumber.trim();
  if (trimmed.length <= 4) return '****';
  return `${'*'.repeat(Math.max(trimmed.length - 4, 4))}${trimmed.slice(-4)}`;
}
