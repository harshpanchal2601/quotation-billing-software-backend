import { DiscountType, Prisma, QuotationStatus, TaxMode, type Company, type Item, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { calculateQuotationTotals } from '../src/modules/quotations/quotation-calculation.service.js';
import { validateStatusTransition } from '../src/modules/quotations/quotation-status.service.js';
import { QuotationsService } from '../src/modules/quotations/quotations.service.js';
import { calculationPreviewSchema, quotationCreateSchema } from '../src/modules/quotations/quotations.validation.js';

type MockPrisma = {
  quotation: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  quotationItem: {
    createMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  quotationStatusHistory: {
    create: ReturnType<typeof vi.fn>;
  };
  quotationVersion: {
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  quotationSetting: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  businessProfile: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  company: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  companyContact: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  companyAddress: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  item: {
    findFirst: ReturnType<typeof vi.fn>;
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
    quotation: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    quotationItem: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    quotationStatusHistory: {
      create: vi.fn(),
    },
    quotationVersion: {
      count: vi.fn(),
      create: vi.fn(),
    },
    quotationSetting: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    businessProfile: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    company: {
      findFirst: vi.fn(),
    },
    companyContact: {
      findFirst: vi.fn(),
    },
    companyAddress: {
      findFirst: vi.fn(),
    },
    item: {
      findFirst: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (input: unknown) => {
    if (Array.isArray(input)) return Promise.all(input);
    if (typeof input === 'function') return input(db);
    return undefined;
  });
  return db;
}

const now = new Date('2026-01-01T00:00:00.000Z');

function mockCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 1,
    companyCode: 'COMP-000001',
    name: 'Mankind Pharma',
    legalName: 'Mankind Pharmaceuticals Ltd',
    gstin: '24AAAAA0000A1Z5',
    pan: 'AAAAA0000A',
    website: null,
    notes: null,
    isActive: true,
    createdById: 1,
    updatedById: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function mockItem(overrides: Partial<Item> = {}) {
  return {
    id: 1,
    itemCode: 'ITEM-000001',
    categoryId: 1,
    name: 'Reactor Tank 500L',
    shortDescription: 'SS 316 Tank',
    detailedDescription: null,
    specifications: null,
    measurementUnitId: 1,
    defaultRate: new Prisma.Decimal('1000.00'),
    hsnCode: '8419',
    gstRate: new Prisma.Decimal('18.00'),
    imagePath: null,
    sourceType: 'MANUAL',
    sourceUrl: null,
    sourceExternalId: null,
    isActive: true,
    createdById: 1,
    updatedById: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    category: { id: 1, name: 'Vessels', slug: 'vessels', isActive: true, deletedAt: null },
    measurementUnit: { id: 1, name: 'Pieces', symbol: 'PCS', allowDecimal: false, isActive: true, deletedAt: null },
    ...overrides,
  };
}

describe('quotation calculation engine', () => {
  it('calculates percentage quotation discount correctly', () => {
    const result = calculateQuotationTotals({
      taxMode: TaxMode.CGST_SGST,
      quotationDiscountType: DiscountType.PERCENTAGE,
      quotationDiscountValue: 10,
      items: [
        { quantity: 2, unitRate: 500, gstRate: 18 }, // subtotal 1000
      ],
    });

    expect(result.subtotal).toBe('1000.00');
    expect(result.quotationDiscountAmount).toBe('100.00');
    expect(result.taxableAmount).toBe('900.00');
    expect(result.cgstAmount).toBe('81.00');
    expect(result.sgstAmount).toBe('81.00');
    expect(result.igstAmount).toBe('0.00');
    expect(result.grandTotal).toBe('1062.00');
  });

  it('calculates fixed quotation discount correctly', () => {
    const result = calculateQuotationTotals({
      taxMode: TaxMode.CGST_SGST,
      quotationDiscountType: DiscountType.FIXED,
      quotationDiscountValue: 150,
      items: [
        { quantity: 1, unitRate: 1000, gstRate: 18 },
      ],
    });

    expect(result.subtotal).toBe('1000.00');
    expect(result.quotationDiscountAmount).toBe('150.00');
    expect(result.taxableAmount).toBe('850.00');
    expect(result.cgstAmount).toBe('76.50');
    expect(result.sgstAmount).toBe('76.50');
  });

  it('calculates mixed GST rates per line item and applies IGST for inter-state tax mode', () => {
    const result = calculateQuotationTotals({
      taxMode: TaxMode.IGST,
      items: [
        { quantity: 1, unitRate: 1000, gstRate: 18 }, // IGST 180
        { quantity: 1, unitRate: 2000, gstRate: 12 }, // IGST 240
      ],
    });

    expect(result.subtotal).toBe('3000.00');
    expect(result.cgstAmount).toBe('0.00');
    expect(result.sgstAmount).toBe('0.00');
    expect(result.igstAmount).toBe('420.00');
    expect(result.grandTotal).toBe('3420.00');
  });

  it('corrects discount allocation rounding remainder across line items', () => {
    const result = calculateQuotationTotals({
      quotationDiscountType: DiscountType.FIXED,
      quotationDiscountValue: 10,
      items: [
        { quantity: 1, unitRate: 33.33, gstRate: 18 },
        { quantity: 1, unitRate: 33.33, gstRate: 18 },
        { quantity: 1, unitRate: 33.34, gstRate: 18 },
      ],
    });

    expect(result.quotationDiscountAmount).toBe('10.00');
    const totalAllocatedDisc = result.items.reduce(
      (acc, item) => acc + Number(item.discountAmount),
      0,
    );
    expect(totalAllocatedDisc).toBe(10);
  });
});

describe('quotations service', () => {
  let db: MockPrisma;

  beforeEach(() => {
    db = createMockPrisma();
    db.auditLog.create.mockResolvedValue({ id: 1 });
    db.quotationSetting.findUnique.mockResolvedValue({
      id: 1,
      businessProfileId: 1,
      quotationPrefix: 'BUMINEX',
      financialYearFormat: 'YYYY-YY',
      nextSequenceNumber: 1,
    });
    db.businessProfile.findFirst.mockResolvedValue({ id: 1 });
  });

  it('creates quotation generating number and snapshotting company and item master data', async () => {
    db.company.findFirst.mockResolvedValue(mockCompany());
    db.item.findFirst.mockResolvedValue(mockItem());

    const createdQuotation = {
      id: 1,
      quotationNumber: 'BUMINEX/2026-27/000001',
      revisionNumber: 0,
      companyId: 1,
      companyNameSnapshot: 'Mankind Pharma',
      companyGstinSnapshot: '24AAAAA0000A1Z5',
      quotationDate: now,
      validUntil: null,
      status: QuotationStatus.DRAFT,
      currency: 'INR',
      taxMode: TaxMode.CGST_SGST,
      subtotal: new Prisma.Decimal('1000.00'),
      itemDiscountAmount: new Prisma.Decimal('0.00'),
      quotationDiscountType: DiscountType.NONE,
      quotationDiscountValue: new Prisma.Decimal('0.00'),
      quotationDiscountAmount: new Prisma.Decimal('0.00'),
      taxableAmount: new Prisma.Decimal('1000.00'),
      cgstAmount: new Prisma.Decimal('90.00'),
      sgstAmount: new Prisma.Decimal('90.00'),
      igstAmount: new Prisma.Decimal('0.00'),
      freightAmount: new Prisma.Decimal('0.00'),
      otherCharges: new Prisma.Decimal('0.00'),
      roundOffAmount: new Prisma.Decimal('0.00'),
      grandTotal: new Prisma.Decimal('1180.00'),
      amountInWords: 'One Thousand One Hundred Eighty Rupees Only',
      createdById: 1,
      createdAt: now,
      updatedAt: now,
      company: mockCompany(),
      items: [],
      statusHistory: [],
    };

    db.quotation.findFirst.mockResolvedValueOnce(null); // generateUniqueQuotationNumber check
    db.quotation.create.mockResolvedValue(createdQuotation);
    db.quotation.findFirst.mockResolvedValueOnce(createdQuotation); // getQuotation after create

    const service = new QuotationsService(asPrisma(db));
    const result = await service.createQuotation(
      {
        companyId: 1,
        quotationDate: '2026-04-15',
        items: [{ itemId: 1, quantity: 1, unitRate: 1000 }],
      },
      { userId: 1 },
      1,
    );

    expect(result.quotationNumber).toBe('BUMINEX/2026-27/000001');
    expect(result.companyNameSnapshot).toBe('Mankind Pharma');
    expect(db.quotation.create).toHaveBeenCalled();
  });

  it('rejects fractional quantity when measurement unit disallows decimals', async () => {
    const wholeUnitItem = mockItem({
      measurementUnit: { id: 1, name: 'Pieces', symbol: 'PCS', allowDecimal: false, isActive: true, deletedAt: null },
    });
    db.company.findFirst.mockResolvedValue(mockCompany());
    db.item.findFirst.mockResolvedValue(wholeUnitItem);

    const service = new QuotationsService(asPrisma(db));
    await expect(
      service.createQuotation(
        {
          companyId: 1,
          quotationDate: '2026-04-15',
          items: [{ itemId: 1, quantity: 1.5, unitRate: 1000 }],
        },
        { userId: 1 },
        1,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/must be a whole number/i),
    });
  });

  it('rejects quotation creation for inactive company', async () => {
    db.company.findFirst.mockResolvedValue(mockCompany({ isActive: false }));

    const service = new QuotationsService(asPrisma(db));
    await expect(
      service.createQuotation(
        {
          companyId: 1,
          quotationDate: '2026-04-15',
          items: [{ quantity: 1, unitRate: 1000, itemName: 'Custom' }],
        },
        { userId: 1 },
        1,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Company is inactive or unavailable.',
    });
  });

  it('validates status transition matrix and rejects invalid status transition', () => {
    expect(() => validateStatusTransition(QuotationStatus.DRAFT, QuotationStatus.COMPLETED)).toThrowError(
      /Invalid quotation status transition/,
    );
  });

  it('records status history on valid status update', async () => {
    const draftQuotation = {
      id: 1,
      quotationNumber: 'BUMINEX/2026-27/000001',
      revisionNumber: 0,
      status: QuotationStatus.DRAFT,
      companyId: 1,
      companyNameSnapshot: 'Mankind Pharma',
      subtotal: new Prisma.Decimal('1000.00'),
      itemDiscountAmount: new Prisma.Decimal('0.00'),
      quotationDiscountType: DiscountType.NONE,
      quotationDiscountValue: new Prisma.Decimal('0.00'),
      quotationDiscountAmount: new Prisma.Decimal('0.00'),
      taxableAmount: new Prisma.Decimal('1000.00'),
      cgstAmount: new Prisma.Decimal('90.00'),
      sgstAmount: new Prisma.Decimal('90.00'),
      igstAmount: new Prisma.Decimal('0.00'),
      freightAmount: new Prisma.Decimal('0.00'),
      otherCharges: new Prisma.Decimal('0.00'),
      roundOffAmount: new Prisma.Decimal('0.00'),
      grandTotal: new Prisma.Decimal('1180.00'),
      amountInWords: 'One Thousand One Hundred Eighty Rupees Only',
      quotationDate: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      company: mockCompany(),
      items: [],
      statusHistory: [],
    };
    db.quotation.findFirst.mockResolvedValueOnce(draftQuotation); // find draft
    db.quotation.update.mockResolvedValue({ ...draftQuotation, status: QuotationStatus.SENT });
    db.quotation.findFirst.mockResolvedValueOnce({ ...draftQuotation, status: QuotationStatus.SENT }); // getQuotation after status update

    const service = new QuotationsService(asPrisma(db));
    await service.updateQuotationStatus(1, { status: QuotationStatus.SENT, comment: 'Sent to client' }, { userId: 1 }, 1);

    expect(db.quotationStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quotationId: 1,
        fromStatus: QuotationStatus.DRAFT,
        toStatus: QuotationStatus.SENT,
        comment: 'Sent to client',
        changedById: 1,
      }),
    });
  });

  it('rejects editing non-draft quotation', async () => {
    const sentQuotation = {
      id: 1,
      quotationNumber: 'BUMINEX/2026-27/000001',
      status: QuotationStatus.SENT,
      deletedAt: null,
    };
    db.quotation.findFirst.mockResolvedValue(sentQuotation);

    const service = new QuotationsService(asPrisma(db));
    await expect(
      service.updateQuotation(1, { remarks: 'Updated' }, { userId: 1 }, 1),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'This quotation can no longer be edited.',
    });
  });

  it('rejects quotation creation when Valid Until is earlier than Quotation Date', () => {
    const result = quotationCreateSchema.safeParse({
      companyId: 1,
      quotationDate: '2026-04-20',
      validUntil: '2026-04-19',
      items: [{ itemName: 'Custom Reactor', quantity: 1, unitRate: 1000 }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.validUntil).toContain(
        'Valid Until cannot be earlier than the Quotation Date.',
      );
    }
  });

  it('rejects impossible non-date-only quotation dates', () => {
    const result = quotationCreateSchema.safeParse({
      companyId: 1,
      quotationDate: '2026-02-31',
      validUntil: '2026-03-05',
      items: [{ itemName: 'Custom Reactor', quantity: 1, unitRate: 1000 }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.quotationDate).toContain('Valid quotation date is required');
    }
  });

  it('rejects calculation preview payloads without a valid rate and item identity', () => {
    const result = calculationPreviewSchema.safeParse({
      taxMode: TaxMode.CGST_SGST,
      items: [{ quantity: 1, unitRate: 0 }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(
        expect.arrayContaining(['items.0.unitRate', 'items.0.itemName']),
      );
    }
  });

  it('rejects draft updates when changing only quotation date would invalidate stored Valid Until', async () => {
    const existingQuotation = mockDraftQuotation({
      quotationDate: new Date('2026-04-15T00:00:00.000Z'),
      validUntil: new Date('2026-04-20T00:00:00.000Z'),
    });
    db.quotation.findFirst.mockResolvedValue(existingQuotation);
    db.company.findFirst.mockResolvedValue(mockCompany());

    const service = new QuotationsService(asPrisma(db));

    await expect(
      service.updateQuotation(1, { quotationDate: '2026-04-25' }, { userId: 1 }, 1),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Valid Until cannot be earlier than the Quotation Date.',
      details: {
        fieldErrors: {
          validUntil: 'Valid Until cannot be earlier than the Quotation Date.',
        },
      },
    });
  });

  it('rejects soft-deleting non-draft quotation', async () => {
    const sentQuotation = {
      id: 1,
      quotationNumber: 'BUMINEX/2026-27/000001',
      status: QuotationStatus.SENT,
      deletedAt: null,
    };
    db.quotation.findFirst.mockResolvedValue(sentQuotation);

    const service = new QuotationsService(asPrisma(db));
    await expect(service.deleteQuotation(1, { userId: 1 }, 1)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Only draft quotations can be deleted.',
    });
  });
});

function mockDraftQuotation(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    quotationNumber: 'BUMINEX/2026-27/000001',
    revisionNumber: 0,
    status: QuotationStatus.DRAFT,
    companyId: 1,
    companyContactId: null,
    billingAddressId: null,
    shippingAddressId: null,
    companyNameSnapshot: 'Mankind Pharma',
    companyGstinSnapshot: '24AAAAA0000A1Z5',
    companyPanSnapshot: 'AAAAA0000A',
    contactNameSnapshot: null,
    contactEmailSnapshot: null,
    contactPhoneSnapshot: null,
    billingAddressSnapshot: null,
    shippingAddressSnapshot: null,
    quotationDate: now,
    validUntil: null,
    customerReference: null,
    internalReference: null,
    currency: 'INR',
    taxMode: TaxMode.CGST_SGST,
    subtotal: new Prisma.Decimal('1000.00'),
    itemDiscountAmount: new Prisma.Decimal('0.00'),
    quotationDiscountType: DiscountType.NONE,
    quotationDiscountValue: new Prisma.Decimal('0.00'),
    quotationDiscountAmount: new Prisma.Decimal('0.00'),
    taxableAmount: new Prisma.Decimal('1000.00'),
    cgstAmount: new Prisma.Decimal('90.00'),
    sgstAmount: new Prisma.Decimal('90.00'),
    igstAmount: new Prisma.Decimal('0.00'),
    freightAmount: new Prisma.Decimal('0.00'),
    otherCharges: new Prisma.Decimal('0.00'),
    roundOffAmount: new Prisma.Decimal('0.00'),
    grandTotal: new Prisma.Decimal('1180.00'),
    amountInWords: 'One Thousand One Hundred Eighty Rupees Only',
    deliveryTerms: null,
    dispatchTerms: null,
    paymentTerms: null,
    taxTerms: null,
    freightTerms: null,
    warrantyTerms: null,
    remarks: null,
    termsAndConditions: null,
    internalNotes: null,
    createdById: 1,
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    items: [
      {
        itemId: null,
        lineNumber: 1,
        itemNameSnapshot: 'Custom Reactor',
        descriptionSnapshot: null,
        specificationsSnapshot: null,
        measurementUnitSnapshot: 'NOS',
        quantity: new Prisma.Decimal('1.000'),
        unitRate: new Prisma.Decimal('1000.00'),
        discountType: DiscountType.NONE,
        discountValue: new Prisma.Decimal('0.00'),
        gstRate: new Prisma.Decimal('18.00'),
        sortOrder: 0,
      },
    ],
    ...overrides,
  };
}
