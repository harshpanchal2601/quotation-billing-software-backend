import { AuditAction, Prisma, SequenceResetRule, TaxMode } from '@prisma/client';
import type { BusinessProfile, QuotationSetting, BankDetail, PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BankDetailsService } from '../src/modules/business-settings/bank-details.service.js';
import { BusinessProfileService } from '../src/modules/business-settings/business-profile.service.js';
import { QuotationSettingsService } from '../src/modules/business-settings/quotation-settings.service.js';

type MockPrisma = {
  businessProfile: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  quotationSetting: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  bankDetail: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  auditLog: {
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

function asPrisma(db: MockPrisma): PrismaClient {
  return db as unknown as PrismaClient;
}

function createMockPrisma(): MockPrisma {
  const db: MockPrisma = {
    businessProfile: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    quotationSetting: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    bankDetail: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (callback: (tx: MockPrisma) => Promise<unknown>) =>
    callback(db),
  );
  return db;
}

function profile(overrides: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    id: 1,
    legalName: 'Legal Name',
    displayName: 'Display Name',
    gstin: null,
    pan: null,
    cin: null,
    addressLine1: 'Line 1',
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
    logoPath: null,
    signaturePath: null,
    stampPath: null,
    primaryColour: '#168A56',
    secondaryColour: '#082B67',
    defaultCurrency: 'INR',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function settings(overrides: Partial<QuotationSetting> = {}): QuotationSetting {
  return {
    id: 1,
    businessProfileId: 1,
    quotationPrefix: 'BUMINEX',
    financialYearFormat: 'YYYY-YY',
    nextSequenceNumber: 1,
    sequenceResetRule: SequenceResetRule.FINANCIAL_YEAR,
    defaultValidityDays: 30,
    defaultTaxMode: TaxMode.CGST_SGST,
    defaultGstRate: new Prisma.Decimal('18.00'),
    defaultDeliveryTerms: null,
    defaultDispatchTerms: null,
    defaultPaymentTerms: null,
    defaultFreightTerms: null,
    defaultWarrantyTerms: '',
    defaultRemarks: null,
    defaultTermsAndConditions: null,
    showBankDetails: true,
    showAmountInWords: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function bank(overrides: Partial<BankDetail> = {}): BankDetail {
  return {
    id: 1,
    businessProfileId: 1,
    bankName: 'HDFC Bank',
    accountName: 'Buminex',
    accountNumber: '1234567890',
    accountType: null,
    ifscCode: null,
    branchName: null,
    swiftCode: null,
    upiId: null,
    isDefault: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('business settings services', () => {
  let db: MockPrisma;

  beforeEach(() => {
    db = createMockPrisma();
  });

  it('returns the singleton business profile and creates defaults when missing', async () => {
    db.businessProfile.findFirst.mockResolvedValueOnce(null);
    db.businessProfile.create.mockResolvedValueOnce(profile());

    const service = new BusinessProfileService(asPrisma(db));
    await expect(service.getBusinessProfile()).resolves.toMatchObject({ id: 1 });
    expect(db.businessProfile.create).toHaveBeenCalledOnce();
  });

  it('updates only provided business profile fields and writes audit metadata', async () => {
    db.businessProfile.findFirst.mockResolvedValueOnce(profile({ displayName: 'Old' }));
    db.businessProfile.update.mockResolvedValueOnce(profile({ displayName: 'New' }));
    db.auditLog.create.mockResolvedValueOnce({ id: 1 });

    const service = new BusinessProfileService(asPrisma(db));
    const result = await service.updateBusinessProfile({ displayName: 'New' }, { userId: 1 });

    expect(result.displayName).toBe('New');
    expect(db.businessProfile.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { displayName: 'New' },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: AuditAction.UPDATE,
        entityType: 'BusinessProfile',
      }),
    });
  });

  it('creates default quotation settings when missing and serialises decimals', async () => {
    db.businessProfile.findFirst.mockResolvedValueOnce(profile());
    db.quotationSetting.findUnique.mockResolvedValueOnce(null);
    db.quotationSetting.create.mockResolvedValueOnce(settings());

    const service = new QuotationSettingsService(asPrisma(db));
    const result = await service.getQuotationSettings();

    expect(result.defaultGstRate).toBe('18.00');
    expect(db.quotationSetting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ businessProfileId: 1, quotationPrefix: 'BUMINEX' }),
    });
  });

  it('updates quotation settings with Prisma Decimal values', async () => {
    db.businessProfile.findFirst.mockResolvedValueOnce(profile());
    db.quotationSetting.findUnique.mockResolvedValueOnce(settings());
    db.quotationSetting.update.mockResolvedValueOnce(settings({ defaultGstRate: new Prisma.Decimal('12.50') }));
    db.auditLog.create.mockResolvedValueOnce({ id: 1 });

    const service = new QuotationSettingsService(asPrisma(db));
    const result = await service.updateQuotationSettings({ defaultGstRate: '12.50' }, { userId: 1 });

    expect(result.defaultGstRate).toBe('12.50');
    expect(db.quotationSetting.update.mock.calls[0]?.[0].data.defaultGstRate).toBeInstanceOf(Prisma.Decimal);
  });

  it('creates a bank detail and unsets the previous default transactionally', async () => {
    db.businessProfile.findFirst.mockResolvedValueOnce(profile());
    db.bankDetail.create.mockResolvedValueOnce(bank({ isDefault: true }));
    db.auditLog.create.mockResolvedValueOnce({ id: 1 });

    const service = new BankDetailsService(asPrisma(db));
    const result = await service.createBankDetail(
      { bankName: 'HDFC Bank', accountName: 'Buminex', accountNumber: '1234567890', isDefault: true },
      { userId: 1 },
    );

    expect(result.accountNumber).toBe('1234567890');
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.bankDetail.updateMany).toHaveBeenCalledWith({
      where: { businessProfileId: 1, deletedAt: null, isDefault: true },
      data: { isDefault: false },
    });
  });

  it('sets default bank detail transactionally and masks audit account numbers', async () => {
    db.businessProfile.findFirst.mockResolvedValueOnce(profile());
    db.bankDetail.findFirst.mockResolvedValueOnce(bank({ accountNumber: '1234567890' }));
    db.bankDetail.update.mockResolvedValueOnce(bank({ isDefault: true, accountNumber: '1234567890' }));
    db.auditLog.create.mockResolvedValueOnce({ id: 1 });

    const service = new BankDetailsService(asPrisma(db));
    await service.setDefaultBankDetail(1, { userId: 1 });

    expect(db.$transaction).toHaveBeenCalledOnce();
    const auditCall = db.auditLog.create.mock.calls[0]?.[0];
    expect(JSON.stringify(auditCall.data)).toContain('******7890');
    expect(JSON.stringify(auditCall.data)).not.toContain('"1234567890"');
  });

  it('soft deletes default bank records and promotes a replacement when available', async () => {
    db.businessProfile.findFirst.mockResolvedValueOnce(profile());
    db.bankDetail.findFirst
      .mockResolvedValueOnce(bank({ id: 1, isDefault: true }))
      .mockResolvedValueOnce(bank({ id: 2, isDefault: false }));
    db.bankDetail.update.mockResolvedValue(bank());
    db.auditLog.create.mockResolvedValueOnce({ id: 1 });

    const service = new BankDetailsService(asPrisma(db));
    await service.deleteBankDetail(1, { userId: 1 });

    expect(db.bankDetail.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { deletedAt: expect.any(Date), isDefault: false },
    });
    expect(db.bankDetail.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { isDefault: true },
    });
  });

  it('returns 404 for missing bank records', async () => {
    db.businessProfile.findFirst.mockResolvedValueOnce(profile());
    db.bankDetail.findFirst.mockResolvedValueOnce(null);

    const service = new BankDetailsService(asPrisma(db));
    await expect(service.setDefaultBankDetail(999, { userId: 1 })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
