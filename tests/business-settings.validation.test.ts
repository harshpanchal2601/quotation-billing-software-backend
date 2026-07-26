import { describe, expect, it } from 'vitest';

import {
  bankDetailCreateSchema,
  businessProfileUpdateSchema,
  quotationSettingsUpdateSchema,
} from '../src/modules/business-settings/business-settings.validation.js';
import { maskAccountNumber, serialiseBusinessProfile, serialiseQuotationSettings } from '../src/modules/business-settings/business-settings.serializers.js';
import { brandingAssetConfig, toBrandingRelativePath, validateBrandingFile } from '../src/modules/business-settings/branding-upload.js';
import { Prisma, SequenceResetRule, TaxMode } from '@prisma/client';

describe('business settings validation', () => {
  it('validates GSTIN, PAN and colour values', () => {
    expect(() => businessProfileUpdateSchema.parse({ gstin: 'invalid' })).toThrow();
    expect(() => businessProfileUpdateSchema.parse({ pan: 'invalid' })).toThrow();
    expect(() => businessProfileUpdateSchema.parse({ primaryColour: '168A56' })).toThrow();

    expect(
      businessProfileUpdateSchema.parse({
        gstin: '24aamcb7736k1z9',
        pan: 'aamcb7736k',
        primaryColour: '#168a56',
      }),
    ).toMatchObject({
      gstin: '24AAMCB7736K1Z9',
      pan: 'AAMCB7736K',
      primaryColour: '#168A56',
    });
  });

  it('validates quotation sequence and GST values', () => {
    expect(() => quotationSettingsUpdateSchema.parse({ nextSequenceNumber: 0 })).toThrow();
    expect(() => quotationSettingsUpdateSchema.parse({ defaultGstRate: '100.001' })).toThrow();
    expect(quotationSettingsUpdateSchema.parse({ defaultGstRate: '18.50' })).toMatchObject({
      defaultGstRate: '18.50',
    });
  });

  it('normalises empty nullable quotation terms to null for explicit clearing', () => {
    expect(quotationSettingsUpdateSchema.parse({
      defaultDeliveryTerms: '',
      defaultWarrantyTerms: '  ',
      defaultRemarks: ' Keep line breaks\nwhen provided ',
    })).toMatchObject({
      defaultDeliveryTerms: null,
      defaultWarrantyTerms: null,
      defaultRemarks: 'Keep line breaks\nwhen provided',
    });

    expect(quotationSettingsUpdateSchema.parse({})).not.toHaveProperty('defaultDeliveryTerms');
  });

  it('keeps bank account numbers as strings and masks them for audit metadata', () => {
    const input = bankDetailCreateSchema.parse({
      bankName: 'HDFC Bank',
      accountName: 'Buminex',
      accountNumber: '0012 3456 7890',
      ifscCode: 'hdfc0001234',
      isDefault: true,
    });

    expect(input.accountNumber).toBe('0012 3456 7890');
    expect(input.ifscCode).toBe('HDFC0001234');
    expect(maskAccountNumber(input.accountNumber)).toBe('**********7890');
  });

  it('keeps IFSC optional but normalises and validates provided values', () => {
    expect(bankDetailCreateSchema.parse({
      bankName: 'HDFC Bank',
      accountName: 'Buminex',
      accountNumber: '001234567890',
      ifscCode: '',
      isDefault: false,
    }).ifscCode).toBeUndefined();

    expect(bankDetailCreateSchema.parse({
      bankName: 'Bank of Baroda',
      accountName: 'Buminex',
      accountNumber: '001234567890',
      ifscCode: ' barb0ahmeda ',
      isDefault: false,
    }).ifscCode).toBe('BARB0AHMEDA');

    expect(() => bankDetailCreateSchema.parse({
      bankName: 'HDFC Bank',
      accountName: 'Buminex',
      accountNumber: '001234567890',
      ifscCode: 'BAD',
      isDefault: false,
    })).toThrow('Enter a valid 11-character IFSC code, for example BARB0AHMEDA.');
  });

  it('accepts JPEG, PNG and WebP uploads and rejects unsafe types or oversized files', () => {
    expect(validateBrandingFile({ mimetype: 'image/jpeg', originalname: 'logo.jpeg', size: 1024 })).toBeNull();
    expect(validateBrandingFile({ mimetype: 'image/png', originalname: 'logo.png', size: 1024 })).toBeNull();
    expect(validateBrandingFile({ mimetype: 'image/webp', originalname: 'logo.webp', size: 1024 })).toBeNull();
    expect(validateBrandingFile({ mimetype: 'application/pdf', originalname: 'logo.pdf', size: 1024 })).toMatchObject({ statusCode: 415 });
    expect(validateBrandingFile({ mimetype: 'image/png', originalname: 'logo.png', size: 6 * 1024 * 1024 })).toMatchObject({ statusCode: 413 });
  });

  it('uses separate storage areas for logo, signature and stamp files', () => {
    expect(brandingAssetConfig.logo.directory).toBe('logos');
    expect(brandingAssetConfig.signature.directory).toBe('signatures');
    expect(brandingAssetConfig.stamp.directory).toBe('stamps');
    expect(toBrandingRelativePath('signature', '../unsafe.png')).toBe('signatures/unsafe.png');
  });

  it('serialises safe business profile URLs and decimal settings consistently', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const profile = serialiseBusinessProfile({
      id: 1,
      legalName: 'Legal',
      displayName: 'Display',
      gstin: null,
      pan: null,
      cin: null,
      addressLine1: 'A',
      addressLine2: null,
      city: 'Ahmedabad',
      state: 'Gujarat',
      postalCode: '380018',
      country: 'India',
      primaryPhone: null,
      secondaryPhone: null,
      primaryEmail: null,
      secondaryEmail: null,
      website: null,
      logoPath: 'logos/logo.png',
      signaturePath: null,
      stampPath: null,
      primaryColour: '#168A56',
      secondaryColour: '#082B67',
      defaultCurrency: 'INR',
      createdAt: now,
      updatedAt: now,
    });

    expect(profile.logoUrl).toBe('/storage/logos/logo.png');
    expect(JSON.stringify(profile)).not.toContain('/Users/');

    const settings = serialiseQuotationSettings({
      id: 1,
      businessProfileId: 1,
      quotationPrefix: 'BUMINEX',
      financialYearFormat: 'YYYY-YY',
      nextSequenceNumber: 1,
      sequenceResetRule: SequenceResetRule.FINANCIAL_YEAR,
      defaultValidityDays: 30,
      defaultTaxMode: TaxMode.CGST_SGST,
      defaultGstRate: new Prisma.Decimal('18'),
      defaultDeliveryTerms: null,
      defaultDispatchTerms: null,
      defaultPaymentTerms: null,
      defaultFreightTerms: null,
      defaultWarrantyTerms: '',
      defaultRemarks: null,
      defaultTermsAndConditions: null,
      showBankDetails: true,
      showAmountInWords: true,
      createdAt: now,
      updatedAt: now,
    });

    expect(settings.defaultGstRate).toBe('18.00');
  });
});
