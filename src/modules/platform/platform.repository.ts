import bcrypt from 'bcrypt';
import {
  AccountType,
  AuditAction,
  FirmStatus,
  Prisma,
  UserRole,
  UserStatus,
  type PrismaClient,
} from '@prisma/client';

import { env } from '../../config/env.js';
import { createAuditLog, pickChangedFields, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { initializeLegacySubscription, loadEntitlements } from '../entitlements/index.js';
import type {
  PlatformFirmCreateInput,
  PlatformFirmListQuery,
  PlatformFirmUpdateInput,
} from './platform.schema.js';

const DEFAULT_USER_LIMIT = 4;
const DEFAULT_MEASUREMENT_UNITS = [
  { name: 'Number', symbol: 'NOS', allowDecimal: false },
  { name: 'Piece', symbol: 'PCS', allowDecimal: false },
  { name: 'Set', symbol: 'SET', allowDecimal: false },
  { name: 'Kilogram', symbol: 'KG', allowDecimal: true },
  { name: 'Litre', symbol: 'LTR', allowDecimal: true },
  { name: 'Metre', symbol: 'MTR', allowDecimal: true },
  { name: 'Job', symbol: 'JOB', allowDecimal: false },
] as const;

const firmDetailInclude = {
  businessProfile: true,
  users: {
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      accountType: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.FirmInclude;

export class PlatformRepository {
  constructor(private readonly db: PrismaClient) {}

  async listFirms(query: PlatformFirmListQuery) {
    const where: Prisma.FirmWhereInput = {
      deletedAt: null,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.search === undefined
        ? {}
        : {
            OR: [
              { name: { contains: query.search } },
              { slug: { contains: query.search } },
              { businessProfile: { is: { displayName: { contains: query.search } } } },
            ],
          }),
    };
    const [firms, total] = await this.db.$transaction([
      this.db.firm.findMany({
        where,
        include: {
          businessProfile: { select: { displayName: true, primaryEmail: true } },
          users: {
            where: { accountType: AccountType.FIRM_ADMIN, deletedAt: null },
            select: { email: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
          _count: { select: { users: { where: { deletedAt: null } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.firm.count({ where }),
    ]);

    return {
      firms: await Promise.all(firms.map(async (firm) => ({
        id: firm.id,
        name: firm.name,
        slug: firm.slug,
        status: firm.status,
        userLimit: Number((await loadEntitlements(this.db, firm.id)).limits.users),
        userCount: firm._count.users,
        displayName: firm.businessProfile?.displayName ?? firm.name,
        primaryEmail: firm.businessProfile?.primaryEmail ?? null,
        administratorEmail: firm.users[0]?.email ?? null,
        createdAt: firm.createdAt,
        updatedAt: firm.updatedAt,
      }))),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getFirm(id: number) {
    const firm = await this.db.firm.findFirst({
      where: { id, deletedAt: null },
      include: firmDetailInclude,
    });
    if (firm === null) throw new AppError('Firm not found', 404);
    return {
      ...firm,
      userLimit: Number((await loadEntitlements(this.db, id)).limits.users),
      displayName: firm.businessProfile?.displayName ?? firm.name,
      primaryEmail: firm.businessProfile?.primaryEmail ?? null,
      administratorEmail:
        firm.users.find((user) => user.accountType === AccountType.FIRM_ADMIN)?.email ?? null,
      userCount: firm.users.length,
    };
  }

  async createFirm(input: PlatformFirmCreateInput, metadata: RequestMetadata) {
    await this.assertFirmAndAdminIdentifiersAvailable(input.slug, input.adminEmail, input.adminUsername);
    const passwordHash = await bcrypt.hash(input.temporaryPassword, env.BCRYPT_SALT_ROUNDS);
    const quotationPrefix = input.quotationPrefix ?? deriveQuotationPrefix(input.slug);

    let firmId: number;
    try {
      firmId = await this.db.$transaction(async (tx) => {
        const firm = await tx.firm.create({
          data: {
            name: input.name,
            slug: input.slug,
            status: FirmStatus.ACTIVE,
            userLimit: DEFAULT_USER_LIMIT,
          },
        });
        const profile = await tx.businessProfile.create({
          data: {
            firmId: firm.id,
            legalName: input.legalName,
            displayName: input.displayName,
            addressLine1: input.addressLine1,
            addressLine2: input.addressLine2,
            city: input.city,
            state: input.state,
            postalCode: input.postalCode,
            country: input.country,
            primaryEmail: input.primaryEmail,
            primaryPhone: input.primaryPhone,
          },
        });
        await tx.quotationSetting.create({
          data: { businessProfileId: profile.id, quotationPrefix },
        });
        await tx.itemCategory.create({
          data: {
            firmId: firm.id,
            name: 'Uncategorised',
            slug: 'uncategorised',
            description: 'Default category for items without a category',
          },
        });
        await tx.measurementUnit.createMany({
          data: DEFAULT_MEASUREMENT_UNITS.map((unit) => ({ firmId: firm.id, ...unit })),
        });
        await tx.user.create({
          data: {
            firmId: firm.id,
            name: input.adminName,
            email: input.adminEmail,
            username: input.adminUsername,
            passwordHash,
            role: UserRole.ADMIN,
            accountType: AccountType.FIRM_ADMIN,
            status: UserStatus.ACTIVE,
            mustChangePassword: true,
          },
        });
        await initializeLegacySubscription(tx, firm.id, metadata.userId ?? 0);
        await createAuditLog(tx, {
          metadata: { ...metadata, firmId: undefined },
          entityType: 'Firm',
          entityId: String(firm.id),
          action: AuditAction.CREATE,
          policy: 'REQUIRED',
          newValues: { name: input.name, slug: input.slug, userLimit: DEFAULT_USER_LIMIT },
        });
        return firm.id;
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new AppError('Firm slug, administrator email, or username already exists', 409);
      }
      throw error;
    }

    return this.getFirm(firmId);
  }

  async updateFirm(id: number, input: PlatformFirmUpdateInput, metadata: RequestMetadata) {
    const existing = await this.getFirm(id);
    if (input.slug !== undefined && input.slug !== existing.slug) {
      const conflict = await this.db.firm.findUnique({ where: { slug: input.slug } });
      if (conflict !== null) throw new AppError('Firm slug already exists', 409);
    }
    await this.db.$transaction(async (tx) => {
      const updated = await tx.firm.update({ where: { id }, data: input });
      const changes = pickChangedFields(existing, updated, ['name', 'slug']);
      await createAuditLog(tx, {
        metadata: { ...metadata, firmId: undefined },
        entityType: 'Firm',
        entityId: String(id),
        action: AuditAction.UPDATE,
        policy: 'REQUIRED',
        ...changes,
      });
    });
    return this.getFirm(id);
  }

  async updateFirmStatus(id: number, status: FirmStatus, metadata: RequestMetadata) {
    const existing = await this.getFirm(id);
    if (existing.status === status) return existing;

    await this.db.$transaction(async (tx) => {
      await tx.firm.update({ where: { id }, data: { status } });
      if (status === FirmStatus.SUSPENDED) {
        await tx.authSession.updateMany({
          where: { user: { firmId: id }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await createAuditLog(tx, {
        metadata: { ...metadata, firmId: undefined },
        entityType: 'Firm',
        entityId: String(id),
        action: AuditAction.STATUS_CHANGE,
        policy: 'REQUIRED',
        oldValues: { status: existing.status },
        newValues: { status },
      });
    });
    return this.getFirm(id);
  }

  async resetFirmAdministratorPassword(id: number, temporaryPassword: string, metadata: RequestMetadata) {
    await this.getFirm(id);
    const administrator = await this.db.user.findFirst({
      where: { firmId: id, accountType: AccountType.FIRM_ADMIN, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (administrator === null) throw new AppError('Firm administrator not found', 404);
    const passwordHash = await bcrypt.hash(temporaryPassword, env.BCRYPT_SALT_ROUNDS);
    await this.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: administrator.id },
        data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: true, status: UserStatus.ACTIVE },
      });
      await tx.authSession.updateMany({
        where: { userId: administrator.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await createAuditLog(tx, {
        metadata: { ...metadata, firmId: undefined },
        entityType: 'User',
        entityId: String(administrator.id),
        action: AuditAction.PASSWORD_CHANGE,
        policy: 'REQUIRED',
        newValues: { passwordResetByPlatformAdministrator: true, targetFirmId: id },
      });
    });
  }

  private async assertFirmAndAdminIdentifiersAvailable(slug: string, email: string, username: string) {
    const [firm, user] = await Promise.all([
      this.db.firm.findUnique({ where: { slug } }),
      this.db.user.findFirst({ where: { OR: [{ email }, { username }] } }),
    ]);
    if (firm !== null) throw new AppError('Firm slug already exists', 409);
    if (user !== null) throw new AppError('Administrator email or username already exists', 409);
  }
}

function deriveQuotationPrefix(slug: string) {
  const prefix = slug.replace(/-/g, '_').toUpperCase().slice(0, 30);
  return prefix.length >= 2 ? prefix : 'ERP';
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export const platformRepository = new PlatformRepository(prisma);
