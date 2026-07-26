import { AddressType, AuditAction, Prisma } from '@prisma/client';
import type { Company, CompanyAddress, CompanyContact, PrismaClient, Quotation } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyAddressesService } from '../src/modules/companies/company-addresses.service.js';
import { CompanyContactsService } from '../src/modules/companies/company-contacts.service.js';
import { CompaniesService } from '../src/modules/companies/companies.service.js';

type MockPrisma = {
  company: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  companyContact: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  companyAddress: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  quotation: {
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
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
    company: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    companyContact: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    companyAddress: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    quotation: {
      count: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
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

function company(overrides: Partial<Company> = {}): Company {
  return {
    id: 1,
    companyCode: 'COMP-000001',
    name: 'Acme Pharma',
    legalName: null,
    gstin: null,
    pan: null,
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

function contact(overrides: Partial<CompanyContact> = {}): CompanyContact {
  return {
    id: 1,
    companyId: 1,
    name: 'Nitish',
    designation: null,
    email: 'nitish@example.com',
    phone: null,
    alternatePhone: null,
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function address(overrides: Partial<CompanyAddress> = {}): CompanyAddress {
  return {
    id: 1,
    companyId: 1,
    addressType: AddressType.BILLING,
    addressLine1: 'Line 1',
    addressLine2: null,
    city: '',
    state: '',
    postalCode: '',
    country: 'India',
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function companyDetail(overrides: Partial<Company> = {}) {
  return {
    ...company(overrides),
    contacts: [contact()],
    addresses: [address()],
    _count: { quotations: 0 },
  };
}

function quotation(overrides: Partial<Quotation> = {}): Quotation {
  return {
    id: 1,
    quotationNumber: 'Q-1',
    revisionNumber: 0,
    companyId: 1,
    companyContactId: null,
    billingAddressId: null,
    shippingAddressId: null,
    companyNameSnapshot: 'Acme Pharma',
    companyGstinSnapshot: null,
    companyPanSnapshot: null,
    contactNameSnapshot: null,
    contactEmailSnapshot: null,
    contactPhoneSnapshot: null,
    billingAddressSnapshot: null,
    shippingAddressSnapshot: null,
    quotationDate: now,
    validUntil: null,
    customerReference: null,
    internalReference: null,
    status: 'DRAFT',
    currency: 'INR',
    taxMode: 'CGST_SGST',
    subtotal: new Prisma.Decimal('0.00'),
    itemDiscountAmount: new Prisma.Decimal('0.00'),
    quotationDiscountType: 'NONE',
    quotationDiscountValue: new Prisma.Decimal('0.00'),
    quotationDiscountAmount: new Prisma.Decimal('0.00'),
    taxableAmount: new Prisma.Decimal('0.00'),
    cgstAmount: new Prisma.Decimal('0.00'),
    sgstAmount: new Prisma.Decimal('0.00'),
    igstAmount: new Prisma.Decimal('0.00'),
    freightAmount: new Prisma.Decimal('0.00'),
    freightIncluded: false,
    freightIsTaxable: false,
    otherCharges: new Prisma.Decimal('0.00'),
    roundOffAmount: new Prisma.Decimal('0.00'),
    grandTotal: new Prisma.Decimal('10.00'),
    amountInWords: null,
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
    sentAt: null,
    acceptedAt: null,
    rejectedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

describe('company services', () => {
  let db: MockPrisma;

  beforeEach(() => {
    db = createMockPrisma();
    db.auditLog.create.mockResolvedValue({ id: 1 });
  });

  it('creates companies with generated backend codes and nested records transactionally', async () => {
    db.company.findMany.mockResolvedValueOnce([]);
    db.company.findFirst.mockResolvedValueOnce(companyDetail());
    db.company.create.mockResolvedValueOnce(company());
    db.companyContact.create.mockResolvedValueOnce(contact());
    db.companyAddress.create.mockResolvedValueOnce(address());
    db.quotation.groupBy.mockResolvedValueOnce([]);

    const service = new CompaniesService(asPrisma(db));
    const result = await service.createCompany(
      {
        name: 'Acme Pharma',
        isActive: true,
        contacts: [{ name: 'Nitish', isPrimary: true }],
        addresses: [{ addressType: AddressType.BILLING, addressLine1: 'Line 1', country: 'India', isPrimary: true }],
      },
      { userId: 1 },
    );

    expect(result.companyCode).toBe('COMP-000001');
    expect(db.company.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyCode: 'COMP-000001', createdById: 1 }),
    });
    expect(db.$transaction).toHaveBeenCalled();
  });

  it('lists companies with search, pagination and non-deleted quotation counts', async () => {
    db.company.findMany.mockResolvedValueOnce([companyDetail()]);
    db.company.count.mockResolvedValueOnce(1);

    const service = new CompaniesService(asPrisma(db));
    const result = await service.listCompanies({
      page: 1,
      limit: 20,
      search: 'nitish',
      isActive: true,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(result.pagination.total).toBe(1);
    expect(result.companies[0]?.primaryContact?.name).toBe('Nitish');
    expect(db.company.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { deletedAt: null, isActive: true },
      skip: 0,
      take: 20,
    });
  });

  it('replaces the primary contact transactionally', async () => {
    db.company.findFirst.mockResolvedValueOnce(company());
    db.companyContact.findFirst.mockResolvedValueOnce(contact({ id: 2, isPrimary: false }));
    db.companyContact.update.mockResolvedValueOnce(contact({ id: 2, isPrimary: true }));

    const service = new CompanyContactsService(asPrisma(db));
    await service.setPrimaryContact(1, 2, { userId: 1 });

    expect(db.companyContact.updateMany).toHaveBeenCalledWith({
      where: { companyId: 1, deletedAt: null, isPrimary: true, NOT: { id: 2 } },
      data: { isPrimary: false },
    });
  });

  it('promotes the oldest remaining contact when deleting the primary contact', async () => {
    db.company.findFirst.mockResolvedValueOnce(company());
    db.companyContact.findFirst
      .mockResolvedValueOnce(contact({ id: 1, isPrimary: true }))
      .mockResolvedValueOnce(contact({ id: 2, isPrimary: false }));
    db.companyContact.update.mockResolvedValue(contact());

    const service = new CompanyContactsService(asPrisma(db));
    await service.deleteContact(1, 1, { userId: 1 });

    expect(db.companyContact.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { isPrimary: true },
    });
  });

  it('replaces primary addresses per address type only', async () => {
    db.company.findFirst.mockResolvedValueOnce(company());
    db.companyAddress.findFirst.mockResolvedValueOnce(address({ id: 2, isPrimary: false }));
    db.companyAddress.update.mockResolvedValueOnce(address({ id: 2, isPrimary: true }));

    const service = new CompanyAddressesService(asPrisma(db));
    await service.setPrimaryAddress(1, 2, { userId: 1 });

    expect(db.companyAddress.updateMany).toHaveBeenCalledWith({
      where: {
        companyId: 1,
        addressType: AddressType.BILLING,
        deletedAt: null,
        isPrimary: true,
        NOT: { id: 2 },
      },
      data: { isPrimary: false },
    });
  });

  it('blocks company deletion when quotations exist', async () => {
    db.company.findFirst.mockResolvedValueOnce(company());
    db.quotation.count.mockResolvedValueOnce(1);

    const service = new CompaniesService(asPrisma(db));
    await expect(service.deleteCompany(1, { userId: 1 })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Company cannot be deleted because quotations are linked to it.',
    });
  });

  it('soft deletes companies with active contacts and addresses in one transaction', async () => {
    db.company.findFirst.mockResolvedValueOnce(company());
    db.quotation.count.mockResolvedValueOnce(0);
    db.company.update.mockResolvedValueOnce(company({ deletedAt: now, isActive: false }));

    const service = new CompaniesService(asPrisma(db));
    await service.deleteCompany(1, { userId: 1 });

    expect(db.company.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ deletedAt: expect.any(Date), isActive: false }),
    });
    expect(db.companyContact.updateMany).toHaveBeenCalled();
    expect(db.companyAddress.updateMany).toHaveBeenCalled();
  });

  it('restores the company only and records the restoration limitation', async () => {
    db.company.findFirst.mockResolvedValueOnce(company({ deletedAt: now })).mockResolvedValueOnce(companyDetail());
    db.company.update.mockResolvedValueOnce(company());
    db.quotation.groupBy.mockResolvedValueOnce([]);

    const service = new CompaniesService(asPrisma(db));
    await service.restoreCompany(1, { userId: 1 });

    expect(db.company.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { deletedAt: null, isActive: true, updatedById: 1 },
    });
    expect(db.auditLog.create.mock.calls[0]?.[0].data).toMatchObject({
      action: AuditAction.RESTORE,
    });
  });

  it('returns paginated quotation history summaries without quotation items', async () => {
    db.company.findFirst.mockResolvedValueOnce(company());
    db.quotation.findMany.mockResolvedValueOnce([quotation()]);
    db.quotation.count.mockResolvedValueOnce(1);

    const service = new CompaniesService(asPrisma(db));
    const result = await service.listCompanyQuotations(1, {
      page: 1,
      limit: 10,
      sortOrder: 'desc',
    });

    expect(result.quotations[0]).toMatchObject({ quotationNumber: 'Q-1', grandTotal: '10.00' });
    expect(JSON.stringify(result.quotations[0])).not.toContain('items');
    expect(result.pagination.total).toBe(1);
  });
});
