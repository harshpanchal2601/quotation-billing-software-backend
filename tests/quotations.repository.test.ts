import { DiscountType, Prisma, QuotationStatus, TaxMode, type Company, type Item, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { calculateQuotationTotals } from '../src/modules/quotations/calculations/quotation-calculations.js';
import { validateStatusTransition } from '../src/modules/quotations/quotation-status.js';
import { QuotationsRepository } from '../src/modules/quotations/quotations.repository.js';
import { calculationPreviewSchema, quotationCreateSchema } from '../src/modules/quotations/quotations.schema.js';

type MockPrisma = {
  quotation: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
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
    findUnique: ReturnType<typeof vi.fn>;
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
      updateMany: vi.fn(),
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
      findUnique: vi.fn(),
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
    firmId: 1,
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
    firmId: 1,
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

describe('quotations repository', () => {
  let db: MockPrisma;

  beforeEach(() => {
    db = createMockPrisma();
    db.auditLog.create.mockResolvedValue({ id: 1 });
    db.quotation.updateMany.mockResolvedValue({ count: 1 });
    db.quotationSetting.update.mockResolvedValue({
      nextSequenceNumber: 2, quotationPrefix: 'BUMINEX', financialYearFormat: 'YYYY-YY',
    });
    db.quotationSetting.findUnique.mockResolvedValue({
      id: 1,
      businessProfileId: 1,
      quotationPrefix: 'BUMINEX',
      financialYearFormat: 'YYYY-YY',
      nextSequenceNumber: 1,
    });
    db.businessProfile.findUnique.mockResolvedValue({ id: 1, firmId: 1 });
  });

  it('creates quotation generating number and snapshotting company and item master data', async () => {
    db.company.findFirst.mockResolvedValue(mockCompany());
    db.item.findFirst.mockResolvedValue(mockItem());

    const createdQuotation = {
      id: 1,
      firmId: 1,
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
    db.quotation.update.mockResolvedValue(createdQuotation);
    db.quotation.findFirst.mockResolvedValueOnce(createdQuotation); // getQuotation after create

    const service = new QuotationsRepository(asPrisma(db));
    const result = await service.createQuotation(
      1,
      {
        companyId: 1,
        quotationDate: '2026-04-15',
        items: [{ itemId: 1, quantity: 1, unitRate: 1000 }],
      },
      { userId: 1, firmId: 1 },
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

    const service = new QuotationsRepository(asPrisma(db));
    await expect(
      service.createQuotation(
        1,
        {
          companyId: 1,
          quotationDate: '2026-04-15',
          items: [{ itemId: 1, quantity: 1.5, unitRate: 1000 }],
        },
        { userId: 1, firmId: 1 },
        1,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/must be a whole number/i),
    });
  });

  it('rejects quotation creation for inactive company', async () => {
    db.company.findFirst.mockResolvedValue(mockCompany({ isActive: false }));

    const service = new QuotationsRepository(asPrisma(db));
    await expect(
      service.createQuotation(
        1,
        {
          companyId: 1,
          quotationDate: '2026-04-15',
          items: [{ quantity: 1, unitRate: 1000, itemName: 'Custom' }],
        },
        { userId: 1, firmId: 1 },
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
      rootQuotationId: 1,
      previousRevisionId: null,
      isLatestRevision: true,
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

    const service = new QuotationsRepository(asPrisma(db));
    await service.updateQuotationStatus(
      1,
      1,
      { status: QuotationStatus.SENT, comment: 'Sent to client' },
      { userId: 1, firmId: 1 },
      1,
    );

    expect(db.quotationStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        quotationId: 1,
        fromStatus: QuotationStatus.DRAFT,
        toStatus: QuotationStatus.SENT,
        comment: 'Sent to client',
        changedById: 1,
      }),
    });
    expect(db.$transaction).toHaveBeenCalled();
    expect(db.quotation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ firmId: 1, status: QuotationStatus.DRAFT, isLatestRevision: true }),
    }));
  });

  it('does not append status history when a concurrent request wins the transition', async () => {
    db.quotation.findFirst.mockResolvedValue(mockDraftQuotation());
    db.quotation.updateMany.mockResolvedValue({ count: 0 });
    await expect(new QuotationsRepository(asPrisma(db)).updateQuotationStatus(
      1, 1, { status: QuotationStatus.SENT }, { firmId: 1, userId: 1 }, 1,
    )).rejects.toMatchObject({ statusCode: 409 });
    expect(db.quotationStatusHistory.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['history', 'audit'])('propagates %s failures out of the status transaction', async (failurePoint) => {
    db.quotation.findFirst.mockResolvedValue(mockDraftQuotation());
    const failure = new Error(`${failurePoint} unavailable`);
    if (failurePoint === 'history') db.quotationStatusHistory.create.mockRejectedValue(failure);
    else db.auditLog.create.mockRejectedValue(failure);
    await expect(new QuotationsRepository(asPrisma(db)).updateQuotationStatus(
      1, 1, { status: QuotationStatus.SENT }, { firmId: 1, userId: 1 }, 1,
    )).rejects.toBe(failure);
    // This mock verifies propagation; database rollback requires the MySQL integration gate.
    expect(db.$transaction).toHaveBeenCalled();
  });

  it('rejects another firm quotation ID before a status mutation', async () => {
    db.quotation.findFirst.mockResolvedValue(null);
    await expect(new QuotationsRepository(asPrisma(db)).updateQuotationStatus(
      1, 99, { status: QuotationStatus.SENT }, { firmId: 1, userId: 1 }, 1,
    )).rejects.toMatchObject({ statusCode: 404 });
    expect(db.quotation.findFirst).toHaveBeenCalledWith({ where: { id: 99, firmId: 1, deletedAt: null } });
    expect(db.quotation.updateMany).not.toHaveBeenCalled();
  });

  it('rejects editing non-draft quotation', async () => {
    const sentQuotation = {
      id: 1,
      quotationNumber: 'BUMINEX/2026-27/000001',
      status: QuotationStatus.SENT,
      deletedAt: null,
    };
    db.quotation.findFirst.mockResolvedValue(sentQuotation);

    const service = new QuotationsRepository(asPrisma(db));
    await expect(
      service.updateQuotation(1, 1, { remarks: 'Updated' }, { userId: 1, firmId: 1 }, 1),
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

  it('advances the draft concurrency timestamp even within the same millisecond', async () => {
    const draft = mockDraftQuotation();
    db.quotation.findFirst.mockResolvedValue(draft);
    db.company.findFirst.mockResolvedValue(mockCompany());
    db.quotationVersion.count.mockResolvedValue(1);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(draft.updatedAt.getTime());
    try {
      await new QuotationsRepository(asPrisma(db)).updateQuotation(
        1, 1, { remarks: 'Updated' }, { firmId: 1, userId: 1 }, 1,
      );
      const expected = new Date(draft.updatedAt.getTime() + 1);
      expect(db.quotation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { updatedById: 1, updatedAt: expected },
      }));
      expect(db.quotation.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ updatedAt: expected }),
      }));
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects draft updates when changing only quotation date would invalidate stored Valid Until', async () => {
    const existingQuotation = mockDraftQuotation({
      quotationDate: new Date('2026-04-15T00:00:00.000Z'),
      validUntil: new Date('2026-04-20T00:00:00.000Z'),
    });
    db.quotation.findFirst.mockResolvedValue(existingQuotation);
    db.company.findFirst.mockResolvedValue(mockCompany());

    const service = new QuotationsRepository(asPrisma(db));

    await expect(
      service.updateQuotation(1, 1, { quotationDate: '2026-04-25' }, { userId: 1, firmId: 1 }, 1),
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

    const service = new QuotationsRepository(asPrisma(db));
    await expect(service.deleteQuotation(1, 1, { userId: 1, firmId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Only draft quotations can be deleted.',
    });
  });

  it('creates a draft revision from the latest sent quotation without mutating the source', async () => {
    const sentRevision = mockDraftQuotation({
      status: QuotationStatus.SENT,
      sentAt: now,
      items: [
        {
          id: 1,
          quotationId: 1,
          itemId: 10,
          lineNumber: 1,
          itemCodeSnapshot: 'ITEM-10',
          itemNameSnapshot: 'Reactor Tank',
          descriptionSnapshot: 'SS 316',
          specificationsSnapshot: { grade: 'SS316' },
          measurementUnitSnapshot: 'PCS',
          quantity: new Prisma.Decimal('2.000'),
          unitRate: new Prisma.Decimal('1000.00'),
          discountType: DiscountType.NONE,
          discountValue: new Prisma.Decimal('0.00'),
          discountAmount: new Prisma.Decimal('0.00'),
          gstRate: new Prisma.Decimal('18.00'),
          baseAmount: new Prisma.Decimal('2000.00'),
          taxableAmount: new Prisma.Decimal('2000.00'),
          taxAmount: new Prisma.Decimal('360.00'),
          lineTotal: new Prisma.Decimal('2360.00'),
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const createdRevision = {
      ...sentRevision,
      id: 2,
      revisionNumber: 1,
      previousRevisionId: 1,
      status: QuotationStatus.DRAFT,
      sentAt: null,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    db.quotation.findFirst
      .mockResolvedValueOnce(sentRevision)
      .mockResolvedValueOnce(sentRevision)
      .mockResolvedValueOnce(createdRevision);
    db.quotation.create.mockResolvedValue(createdRevision);

    const service = new QuotationsRepository(asPrisma(db));
    const result = await service.createQuotationRevision(1, 1, { userId: 1, firmId: 1 }, 1);

    expect(result.id).toBe(2);
    expect(result.quotationNumber).toBe(sentRevision.quotationNumber);
    expect(result.revisionNumber).toBe(1);
    expect(result.status).toBe(QuotationStatus.DRAFT);
    expect(db.quotation.updateMany).toHaveBeenCalledWith({
      where: { id: sentRevision.id, firmId: 1, deletedAt: null, status: sentRevision.status,
        updatedAt: sentRevision.updatedAt, isLatestRevision: true },
      data: { isLatestRevision: false },
    });
    expect(db.quotation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firmId: 1,
        quotationNumber: sentRevision.quotationNumber,
        revisionNumber: 1,
        rootQuotationId: 1,
        previousRevisionId: 1,
        status: QuotationStatus.DRAFT,
      }),
    });
    expect(db.quotationItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          quotationId: 2,
          itemId: 10,
          itemNameSnapshot: 'Reactor Tank',
          lineTotal: new Prisma.Decimal('2360.00'),
        }),
      ],
    });
  });

  it('rejects revision creation from a historical quotation revision', async () => {
    db.quotation.findFirst.mockResolvedValue(mockDraftQuotation({
      status: QuotationStatus.SENT,
      isLatestRevision: false,
      revisionNumber: 0,
    }));

    const service = new QuotationsRepository(asPrisma(db));

    await expect(service.createQuotationRevision(1, 1, { userId: 1, firmId: 1 }, 1)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Only the latest quotation revision can be revised.',
    });
    expect(db.quotation.create).not.toHaveBeenCalled();
  });

  it('rejects revision creation when the latest revision is already a draft', async () => {
    db.quotation.findFirst.mockResolvedValue(mockDraftQuotation({ status: QuotationStatus.DRAFT }));

    const service = new QuotationsRepository(asPrisma(db));

    await expect(service.createQuotationRevision(1, 1, { userId: 1, firmId: 1 }, 1)).rejects.toMatchObject({
      statusCode: 409,
      message: 'The latest draft revision is already editable.',
    });
  });

  it('maps concurrent duplicate revision creation to a conflict response', async () => {
    const sentRevision = mockDraftQuotation({ status: QuotationStatus.SENT });
    db.quotation.findFirst.mockResolvedValueOnce(sentRevision).mockResolvedValueOnce(sentRevision);
    db.quotation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const service = new QuotationsRepository(asPrisma(db));

    await expect(service.createQuotationRevision(1, 1, { userId: 1, firmId: 1 }, 1)).rejects.toMatchObject({
      statusCode: 409,
      message: 'A newer revision already exists. Refresh the quotation and try again.',
    });
  });

  it('rejects editing a stale draft revision', async () => {
    db.quotation.findFirst.mockResolvedValue(mockDraftQuotation({ isLatestRevision: false }));

    const service = new QuotationsRepository(asPrisma(db));

    await expect(service.updateQuotation(1, 1, { remarks: 'Updated' }, { userId: 1, firmId: 1 }, 1)).rejects.toMatchObject({
      statusCode: 409,
      message: 'This quotation revision can no longer be edited. Edit the latest draft revision instead.',
    });
  });

  it('rejects status changes on historical revisions', async () => {
    db.quotation.findFirst.mockResolvedValue(mockDraftQuotation({ isLatestRevision: false }));

    const service = new QuotationsRepository(asPrisma(db));

    await expect(
      service.updateQuotationStatus(1, 1, { status: QuotationStatus.SENT }, { userId: 1, firmId: 1 }, 1),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Only the latest quotation revision can change status.',
    });
  });

  it('deleting the latest draft revision restores the previous revision as latest', async () => {
    const draftRevision = mockDraftQuotation({
      id: 2,
      revisionNumber: 1,
      previousRevisionId: 1,
      status: QuotationStatus.DRAFT,
    });
    db.quotation.findFirst.mockResolvedValue(draftRevision);

    const service = new QuotationsRepository(asPrisma(db));
    await service.deleteQuotation(1, 2, { userId: 1, firmId: 1 });

    expect(db.quotation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 2, firmId: 1, status: QuotationStatus.DRAFT, isLatestRevision: true }),
      data: expect.objectContaining({
        deletedAt: expect.any(Date),
        isLatestRevision: false,
      }),
    });
    expect(db.quotation.update).toHaveBeenCalledWith({
      where: { id: 1, firmId: 1, deletedAt: null },
      data: { isLatestRevision: true },
    });
  });

  it('lists latest quotation revisions by default', async () => {
    db.quotation.count.mockResolvedValue(0);
    db.quotation.findMany.mockResolvedValue([]);

    const service = new QuotationsRepository(asPrisma(db));
    await service.listQuotations(1, {
      page: 1,
      limit: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(db.quotation.count).toHaveBeenCalledWith({
      where: { firmId: 1, deletedAt: null, isLatestRevision: true },
    });
    expect(db.quotation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { firmId: 1, deletedAt: null, isLatestRevision: true },
    }));
  });
});

function mockDraftQuotation(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    firmId: 1,
    quotationNumber: 'BUMINEX/2026-27/000001',
    revisionNumber: 0,
    rootQuotationId: 1,
    previousRevisionId: null,
    isLatestRevision: true,
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
    freightIncluded: false,
    freightIsTaxable: false,
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
        id: 1,
        quotationId: 1,
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
        discountAmount: new Prisma.Decimal('0.00'),
        baseAmount: new Prisma.Decimal('1000.00'),
        taxableAmount: new Prisma.Decimal('1000.00'),
        taxAmount: new Prisma.Decimal('180.00'),
        lineTotal: new Prisma.Decimal('1180.00'),
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...overrides,
  };
}
