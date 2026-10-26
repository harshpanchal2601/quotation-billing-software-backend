import { AuditAction, Prisma, SequenceResetRule, TaxMode } from '@prisma/client';
import type { BusinessProfile, QuotationSetting, BankDetail, PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BankDetailsRepository } from '../src/modules/settings/bank-details/bank-details.repository.js';
import { BusinessProfileRepository } from '../src/modules/settings/business-profile/business-profile.repository.js';
import { QuotationSettingsRepository } from '../src/modules/settings/quotation-settings/quotation-settings.repository.js';

type MockPrisma = {
  documentSequence: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  firm: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  businessProfile: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  quotationSetting: {
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
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
    documentSequence: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 1 }]),
    firm: { findFirst: vi.fn() },
    businessProfile: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    quotationSetting: { findUniqueOrThrow: vi.fn().mockImplementation(async () => settings()), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
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
    firmId: 1,
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

describe('settings repositories', () => {
  let db: MockPrisma;

  beforeEach(() => {
    db = createMockPrisma();
  });

  it('returns the singleton business profile and creates defaults when missing', async () => {
    db.businessProfile.findUnique.mockResolvedValueOnce(null);
    db.firm.findFirst.mockResolvedValueOnce({ id: 1, name: 'Buminex', slug: 'buminex' });
    db.businessProfile.create.mockResolvedValueOnce(profile());

    const repository = new BusinessProfileRepository(asPrisma(db));
    await expect(repository.getBusinessProfile(1)).resolves.toMatchObject({ id: 1 });
    expect(db.businessProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ firmId: 1, legalName: 'Buminex', displayName: 'Buminex' }),
    });
  });

  it('updates only provided business profile fields and writes audit metadata', async () => {
    db.businessProfile.findUnique.mockResolvedValueOnce(profile({ displayName: 'Old' }));
    db.businessProfile.update.mockResolvedValueOnce(profile({ displayName: 'New' }));
    db.auditLog.create.mockResolvedValueOnce({ id: 1 });

    const repository = new BusinessProfileRepository(asPrisma(db));
    const result = await repository.updateBusinessProfile(1, { displayName: 'New' }, { userId: 1, firmId: 1 });

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
    db.businessProfile.findUnique.mockResolvedValueOnce(profile());
    db.quotationSetting.findUnique.mockResolvedValueOnce(null);
    db.firm.findFirst.mockResolvedValueOnce({ id: 1, name: 'Buminex', slug: 'buminex' });
    db.quotationSetting.create.mockResolvedValueOnce(settings());

    const repository = new QuotationSettingsRepository(asPrisma(db));
    const result = await repository.getQuotationSettings(1);

    expect(result.defaultGstRate).toBe('18.00');
    expect(db.quotationSetting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ businessProfileId: 1, quotationPrefix: 'BUMINEX' }),
    });
  });

  it('updates quotation settings with Prisma Decimal values', async () => {
    db.businessProfile.findUnique.mockResolvedValueOnce(profile());
    db.quotationSetting.findUnique.mockResolvedValueOnce(settings());
    db.quotationSetting.update.mockResolvedValueOnce(settings({ defaultGstRate: new Prisma.Decimal('12.50') }));
    db.auditLog.create.mockResolvedValueOnce({ id: 1 });

    const repository = new QuotationSettingsRepository(asPrisma(db));
    const result = await repository.updateQuotationSettings(
      1,
      { defaultGstRate: '12.50' },
      { userId: 1, firmId: 1 },
    );

    expect(result.defaultGstRate).toBe('12.50');
    expect(db.quotationSetting.update.mock.calls[0]?.[0].data.defaultGstRate).toBeInstanceOf(Prisma.Decimal);
  });

  it('reads the shared sequence instead of the legacy seed field', async () => {
    db.businessProfile.findUnique.mockResolvedValueOnce(profile());
    db.quotationSetting.findUnique.mockResolvedValueOnce(settings({ nextSequenceNumber: 1 }));
    db.documentSequence.findUnique.mockResolvedValueOnce({ nextValue: 42n });
    expect((await new QuotationSettingsRepository(asPrisma(db)).getQuotationSettings(1)).nextSequenceNumber).toBe(42);
  });

  it('rejects rewinding the shared sequence or changing legacy reset behavior', async () => {
    for (const input of [{ nextSequenceNumber: 3 }, { sequenceResetRule: SequenceResetRule.CALENDAR_YEAR }]) {
      db.businessProfile.findUnique.mockResolvedValueOnce(profile());
      db.quotationSetting.findUnique.mockResolvedValueOnce(settings());
      db.documentSequence.findUnique.mockResolvedValueOnce({ nextValue: 42n });
      await expect(new QuotationSettingsRepository(asPrisma(db)).updateQuotationSettings(1, input, { userId: 1, firmId: 1 })).rejects.toMatchObject({ statusCode: 409 });
    }
    expect(db.quotationSetting.update).not.toHaveBeenCalled();
    expect(db.documentSequence.upsert).not.toHaveBeenCalled();
  });

  it('advances the authoritative sequence and propagates required audit failures', async () => {
    db.businessProfile.findUnique.mockResolvedValueOnce(profile());
    db.quotationSetting.findUnique.mockResolvedValueOnce(settings());
    db.documentSequence.findUnique.mockResolvedValueOnce({ nextValue: 42n });
    db.quotationSetting.update.mockResolvedValueOnce(settings({ nextSequenceNumber: 50 }));
    db.auditLog.create.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(new QuotationSettingsRepository(asPrisma(db)).updateQuotationSettings(1, { nextSequenceNumber: 50 }, { userId: 1, firmId: 1 })).rejects.toThrow('audit unavailable');
    expect(db.documentSequence.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { nextValue: 50n } }));
  });

  it('creates a bank detail and unsets the previous default transactionally', async () => {
    db.businessProfile.findUnique.mockResolvedValueOnce(profile());
    db.bankDetail.create.mockResolvedValueOnce(bank({ isDefault: true }));
    db.auditLog.create.mockResolvedValueOnce({ id: 1 });

    const repository = new BankDetailsRepository(asPrisma(db));
    const result = await repository.createBankDetail(
      1,
      { bankName: 'HDFC Bank', accountName: 'Buminex', accountNumber: '1234567890', isDefault: true },
      { userId: 1, firmId: 1 },
    );

    expect(result.accountNumber).toBe('1234567890');
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.bankDetail.updateMany).toHaveBeenCalledWith({
      where: { businessProfileId: 1, deletedAt: null, isDefault: true },
      data: { isDefault: false },
    });
  });

  it('sets default bank detail transactionally and masks audit account numbers', async () => {
    db.businessProfile.findUnique.mockResolvedValueOnce(profile());
    db.bankDetail.findFirst.mockResolvedValueOnce(bank({ accountNumber: '1234567890' }));
    db.bankDetail.update.mockResolvedValueOnce(bank({ isDefault: true, accountNumber: '1234567890' }));
    db.auditLog.create.mockResolvedValueOnce({ id: 1 });

    const repository = new BankDetailsRepository(asPrisma(db));
    await repository.setDefaultBankDetail(1, 1, { userId: 1, firmId: 1 });

    expect(db.$transaction).toHaveBeenCalledOnce();
    const auditCall = db.auditLog.create.mock.calls[0]?.[0];
    expect(JSON.stringify(auditCall.data)).toContain('******7890');
    expect(JSON.stringify(auditCall.data)).not.toContain('"1234567890"');
  });

  it('soft deletes default bank records and promotes a replacement when available', async () => {
    db.businessProfile.findUnique.mockResolvedValueOnce(profile());
    db.bankDetail.findFirst
      .mockResolvedValueOnce(bank({ id: 1, isDefault: true }))
      .mockResolvedValueOnce(bank({ id: 2, isDefault: false }));
    db.bankDetail.update.mockResolvedValue(bank());
    db.auditLog.create.mockResolvedValueOnce({ id: 1 });

    const repository = new BankDetailsRepository(asPrisma(db));
    await repository.deleteBankDetail(1, 1, { userId: 1, firmId: 1 });

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
    db.businessProfile.findUnique.mockResolvedValueOnce(profile());
    db.bankDetail.findFirst.mockResolvedValueOnce(null);

    const repository = new BankDetailsRepository(asPrisma(db));
    await expect(repository.setDefaultBankDetail(1, 999, { userId: 1, firmId: 1 })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
