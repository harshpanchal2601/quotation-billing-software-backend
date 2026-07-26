import type { Company, Prisma, PrismaClient, QuotationStatus } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { AppError } from '../../utils/AppError.js';
import { createAuditLog, pickChangedFields, type RequestMetadata } from '../../utils/auditLog.js';
import { CompanyCodeService } from './company-code.service.js';
import {
  serialiseCompanyDetail,
  serialiseCompanyListItem,
  serialiseQuotationSummary,
} from './companies.serializer.js';
import { createPaginationMetadata } from './companies.types.js';
import type {
  CompanyCreateInput,
  CompanyListQuery,
  CompanyUpdateInput,
  QuotationHistoryQuery,
} from './companies.validation.js';

const MAX_COMPANY_CODE_RETRIES = 5;

const companyAuditFields = [
  'name',
  'legalName',
  'gstin',
  'pan',
  'website',
  'notes',
  'isActive',
] as const;

const companyDetailInclude = {
  contacts: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }, { id: 'asc' }],
  },
  addresses: {
    where: { deletedAt: null },
    orderBy: [{ addressType: 'asc' }, { isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
  },
  _count: {
    select: {
      quotations: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.CompanyInclude;

type CompanyIncludeResult = Prisma.CompanyGetPayload<{
  include: typeof companyDetailInclude;
}>;

export class CompaniesService {
  constructor(private readonly db: PrismaClient) {}

  async listCompanies(query: CompanyListQuery) {
    const where: Prisma.CompanyWhereInput = {
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search === undefined ? {} : createCompanySearchFilter(query.search)),
    };
    const [companies, total] = await this.db.$transaction([
      this.db.company.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          contacts: {
            where: { deletedAt: null, isPrimary: true },
            take: 1,
          },
          addresses: {
            where: {
              deletedAt: null,
              isPrimary: true,
              addressType: { in: ['BILLING', 'SHIPPING'] },
            },
          },
          _count: {
            select: {
              quotations: { where: { deletedAt: null } },
            },
          },
        },
      }),
      this.db.company.count({ where }),
    ]);

    return {
      companies: companies.map(serialiseCompanyListItem),
      pagination: createPaginationMetadata(query.page, query.limit, total),
    };
  }

  async createCompany(input: CompanyCreateInput, metadata: RequestMetadata) {
    let lastUniqueConflict = false;

    for (let attempt = 0; attempt < MAX_COMPANY_CODE_RETRIES; attempt += 1) {
      try {
        const created = await this.db.$transaction(async (tx) => {
          const companyCode = await new CompanyCodeService(tx).generateNextCompanyCode();
          const company = await tx.company.create({
            data: {
              companyCode,
              name: input.name,
              legalName: input.legalName ?? null,
              gstin: input.gstin ?? null,
              pan: input.pan ?? null,
              website: input.website ?? null,
              notes: input.notes ?? null,
              isActive: input.isActive,
              createdById: metadata.userId,
              updatedById: metadata.userId,
            },
          });

          await this.createNestedContacts(tx, company.id, input.contacts ?? []);
          await this.createNestedAddresses(tx, company.id, input.addresses ?? []);
          return company;
        });

        await this.auditCompany(AuditAction.CREATE, created, metadata);
        return this.getCompany(created.id);
      } catch (error) {
        if (isUniqueConflict(error)) {
          lastUniqueConflict = true;
          continue;
        }
        throw error;
      }
    }

    if (lastUniqueConflict) {
      throw new AppError('Company code could not be generated. Please try again.', 409);
    }
    throw new AppError('Company could not be created', 500);
  }

  async getCompany(id: number) {
    const company = await this.getExistingCompany(id);
    const quotationSummary = await this.getQuotationSummary(id);
    return serialiseCompanyDetail(company, quotationSummary);
  }

  async updateCompany(id: number, input: CompanyUpdateInput, metadata: RequestMetadata) {
    const existing = await this.getExistingCompanyRecord(id);
    const data = toCompanyUpdateData(input);

    if (Object.keys(data).length === 0 || !hasCompanyChanges(existing, data)) {
      return this.getCompany(id);
    }

    const updated = await this.db.company.update({
      where: { id },
      data: {
        ...data,
        updatedById: metadata.userId,
      } satisfies Prisma.CompanyUncheckedUpdateInput,
    });

    await this.auditCompany(AuditAction.UPDATE, updated, metadata, existing);
    return this.getCompany(id);
  }

  async updateCompanyStatus(id: number, isActive: boolean, metadata: RequestMetadata) {
    const existing = await this.getExistingCompanyRecord(id);
    if (existing.isActive === isActive) {
      return this.getCompany(id);
    }

    const updated = await this.db.company.update({
      where: { id },
      data: { isActive, updatedById: metadata.userId },
    });

    await this.auditCompany(AuditAction.STATUS_CHANGE, updated, metadata, existing, {
      statusChanged: true,
    });
    return this.getCompany(id);
  }

  async deleteCompany(id: number, metadata: RequestMetadata) {
    const existing = await this.getExistingCompanyRecord(id);
    const quotationCount = await this.db.quotation.count({
      where: { companyId: id, deletedAt: null },
    });

    if (quotationCount > 0) {
      throw new AppError('Company cannot be deleted because quotations are linked to it.', 409);
    }

    await this.db.$transaction(async (tx) => {
      const deletedAt = new Date();
      await tx.company.update({
        where: { id },
        data: {
          deletedAt,
          isActive: false,
          updatedById: metadata.userId,
        },
      });
      await tx.companyContact.updateMany({
        where: { companyId: id, deletedAt: null },
        data: { deletedAt, isPrimary: false },
      });
      await tx.companyAddress.updateMany({
        where: { companyId: id, deletedAt: null },
        data: { deletedAt, isPrimary: false },
      });
    });

    await this.auditCompany(AuditAction.DELETE, existing, metadata, undefined, {
      companyCode: existing.companyCode,
      name: existing.name,
    });
  }

  async restoreCompany(id: number, metadata: RequestMetadata) {
    const existing = await this.db.company.findFirst({
      where: { id, deletedAt: { not: null } },
    });

    if (existing === null) {
      throw new AppError('Company not found', 404);
    }

    const restored = await this.db.company.update({
      where: { id },
      data: {
        deletedAt: null,
        isActive: true,
        updatedById: metadata.userId,
      },
    });

    await this.auditCompany(AuditAction.RESTORE, restored, metadata, existing, {
      restoreNote: 'Company restored only. Contacts and addresses may require administrator review.',
    });
    return this.getCompany(id);
  }

  async listCompanyQuotations(id: number, query: QuotationHistoryQuery) {
    await this.ensureCompanyExists(id);
    const where: Prisma.QuotationWhereInput = {
      companyId: id,
      deletedAt: null,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.dateFrom === undefined && query.dateTo === undefined
        ? {}
        : {
            quotationDate: {
              ...(query.dateFrom === undefined ? {} : { gte: query.dateFrom }),
              ...(query.dateTo === undefined ? {} : { lte: query.dateTo }),
            },
          }),
    };

    const [quotations, total] = await this.db.$transaction([
      this.db.quotation.findMany({
        where,
        orderBy: { quotationDate: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          quotationNumber: true,
          revisionNumber: true,
          quotationDate: true,
          validUntil: true,
          status: true,
          currency: true,
          grandTotal: true,
          createdAt: true,
        },
      }),
      this.db.quotation.count({ where }),
    ]);

    return {
      quotations: quotations.map(serialiseQuotationSummary),
      pagination: createPaginationMetadata(query.page, query.limit, total),
    };
  }

  private async getExistingCompany(id: number): Promise<CompanyIncludeResult> {
    const company = await this.db.company.findFirst({
      where: { id, deletedAt: null },
      include: companyDetailInclude,
    });

    if (company === null) {
      throw new AppError('Company not found', 404);
    }

    return company;
  }

  private async ensureCompanyExists(id: number) {
    const company = await this.db.company.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (company === null) throw new AppError('Company not found', 404);
  }

  private async getExistingCompanyRecord(id: number) {
    const company = await this.db.company.findFirst({ where: { id, deletedAt: null } });
    if (company === null) throw new AppError('Company not found', 404);
    return company;
  }

  private async getQuotationSummary(companyId: number) {
    const grouped = await this.db.quotation.groupBy({
      by: ['status'],
      where: { companyId, deletedAt: null },
      _count: { _all: true },
    });

    const countByStatus = new Map<QuotationStatus, number>(
      grouped.map((item) => [item.status, item._count._all]),
    );

    return {
      total: grouped.reduce((sum, item) => sum + item._count._all, 0),
      draft: countByStatus.get('DRAFT') ?? 0,
      pending: countByStatus.get('PENDING') ?? 0,
      completed: countByStatus.get('COMPLETED') ?? 0,
    };
  }

  private async createNestedContacts(
    tx: Prisma.TransactionClient,
    companyId: number,
    contacts: NonNullable<CompanyCreateInput['contacts']>,
  ) {
    let primaryCreated = false;
    for (const contact of contacts) {
      const isPrimary = contact.isPrimary && !primaryCreated;
      await tx.companyContact.create({
        data: {
          companyId,
          name: contact.name,
          designation: contact.designation ?? null,
          email: contact.email ?? null,
          phone: contact.phone ?? null,
          alternatePhone: contact.alternatePhone ?? null,
          isPrimary,
        },
      });
      if (isPrimary) primaryCreated = true;
    }
  }

  private async createNestedAddresses(
    tx: Prisma.TransactionClient,
    companyId: number,
    addresses: NonNullable<CompanyCreateInput['addresses']>,
  ) {
    const primaryTypes = new Set<string>();
    for (const address of addresses) {
      const isPrimary = address.isPrimary && !primaryTypes.has(address.addressType);
      await tx.companyAddress.create({
        data: {
          companyId,
          addressType: address.addressType,
          addressLine1: address.addressLine1,
          addressLine2: address.addressLine2 ?? null,
          city: address.city ?? '',
          state: address.state ?? '',
          postalCode: address.postalCode ?? '',
          country: address.country,
          isPrimary,
        },
      });
      if (isPrimary) primaryTypes.add(address.addressType);
    }
  }

  private async auditCompany(
    action: AuditAction,
    company: Company,
    metadata: RequestMetadata,
    previous?: Company,
    extra?: Prisma.InputJsonObject,
  ) {
    const changed = previous
      ? pickChangedFields(
          previous as unknown as Record<string, unknown>,
          company as unknown as Record<string, unknown>,
          [...companyAuditFields],
        )
      : undefined;

    await createAuditLog(this.db, {
      metadata,
      entityType: 'Company',
      entityId: String(company.id),
      action,
      oldValues: changed?.oldValues,
      newValues: {
        ...(changed?.newValues ?? {
          companyCode: company.companyCode,
          name: company.name,
          isActive: company.isActive,
        }),
        ...extra,
      },
    });
  }
}

function createCompanySearchFilter(search: string): Prisma.CompanyWhereInput {
  return {
    OR: [
      { companyCode: { contains: search } },
      { name: { contains: search } },
      { legalName: { contains: search } },
      { gstin: { contains: search.toUpperCase() } },
      { pan: { contains: search.toUpperCase() } },
      {
        contacts: {
          some: {
            deletedAt: null,
            isPrimary: true,
            OR: [
              { name: { contains: search } },
              { email: { contains: search.toLowerCase() } },
              { phone: { contains: search } },
            ],
          },
        },
      },
    ],
  };
}

function toCompanyUpdateData(input: CompanyUpdateInput): Prisma.CompanyUncheckedUpdateInput {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.legalName === undefined ? {} : { legalName: input.legalName ?? null }),
    ...(input.gstin === undefined ? {} : { gstin: input.gstin ?? null }),
    ...(input.pan === undefined ? {} : { pan: input.pan ?? null }),
    ...(input.website === undefined ? {} : { website: input.website ?? null }),
    ...(input.notes === undefined ? {} : { notes: input.notes ?? null }),
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  };
}

function hasCompanyChanges(existing: Company, data: Prisma.CompanyUpdateInput) {
  return Object.entries(data).some(([key, value]) => existing[key as keyof Company] !== value);
}

function isUniqueConflict(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'P2002';
}
