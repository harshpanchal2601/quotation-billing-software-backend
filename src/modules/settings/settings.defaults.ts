import { Prisma, SequenceResetRule, TaxMode } from '@prisma/client';

export const defaultBusinessProfileData = {
  legalName: 'BUMINEX PHARMTECH SOLUTIONS PRIVATE LIMITED',
  displayName: 'Buminex Pharmtech Solutions Pvt. Ltd.',
  gstin: '24AAMCB7736K1Z9',
  pan: null,
  cin: null,
  addressLine1: '163 Aadarsh Gold Industrial Estate',
  addressLine2: 'Nr. CISF Camp, Odhav',
  city: 'Ahmedabad',
  state: 'Gujarat',
  postalCode: '380018',
  country: 'India',
  primaryPhone: '9428355505',
  secondaryPhone: null,
  primaryEmail: null,
  secondaryEmail: null,
  website: 'https://buminexpharmtech.com',
  primaryColour: '#168A56',
  secondaryColour: '#082B67',
  defaultCurrency: 'INR',
} as const;

export const defaultQuotationSettingsData = {
  quotationPrefix: 'BUMINEX',
  financialYearFormat: 'YYYY-YY',
  nextSequenceNumber: 1,
  sequenceResetRule: SequenceResetRule.FINANCIAL_YEAR,
  defaultValidityDays: 30,
  defaultTaxMode: TaxMode.CGST_SGST,
  defaultGstRate: new Prisma.Decimal('18.00'),
  defaultDeliveryTerms: '20 DAYS AFTER FINAL APPROVAL',
  defaultDispatchTerms: 'AT YOUR SITE',
  defaultPaymentTerms: '30 DAYS',
  defaultFreightTerms: 'INCLUDING',
  defaultWarrantyTerms: '',
  defaultRemarks:
    'We hope you will find our offer competitive and in line with your requirements. Please feel free to contact us if you need further information.',
  defaultTermsAndConditions: null,
  showBankDetails: true,
  showAmountInWords: true,
} as const;
