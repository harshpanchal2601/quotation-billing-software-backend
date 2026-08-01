import type { AddressType, CompanyAddress, Prisma, PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { AppError } from '../../core/errors/AppError.js';
import { createAuditLog, pickChangedFields, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { serialiseAddress } from './companies.serializer.js';
import type { TransactionClient } from './companies.types.js';
import type {
  CompanyAddressCreateInput,
  CompanyAddressUpdateInput,
} from './companies.validation.js';

const addressAuditFields = [
  'addressType',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
  'isPrimary',
] as const;

export class CompanyAddressesService {
  constructor(private readonly db: PrismaClient) {}

  async createAddress(companyId: number, input: CompanyAddressCreateInput, metadata: RequestMetadata) {
    await this.ensureActiveCompany(companyId);

    const created = await this.db.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.companyAddress.updateMany({
          where: {
            companyId,
            addressType: input.addressType,
            deletedAt: null,
            isPrimary: true,
          },
          data: { isPrimary: false },
        });
      }

      return tx.companyAddress.create({
        data: toAddressCreateData(companyId, input),
      });
    });

    await this.auditAddress(AuditAction.CREATE, created, metadata);
    return serialiseAddress(created);
  }

  async updateAddress(
    companyId: number,
    addressId: number,
    input: CompanyAddressUpdateInput,
    metadata: RequestMetadata,
  ) {
    await this.ensureActiveCompany(companyId);
    const existing = await this.getActiveAddress(companyId, addressId);
    const nextType = input.addressType ?? existing.addressType;
    const nextIsPrimary = input.isPrimary ?? existing.isPrimary;
    const data = toAddressUpdateData(input);

    if (Object.keys(data).length === 0) {
      return serialiseAddress(existing);
    }

    const updated = await this.db.$transaction(async (tx) => {
      if (nextIsPrimary) {
        await tx.companyAddress.updateMany({
          where: {
            companyId,
            addressType: nextType,
            deletedAt: null,
            isPrimary: true,
            NOT: { id: addressId },
          },
          data: { isPrimary: false },
        });
      }

      const address = await tx.companyAddress.update({
        where: { id: addressId },
        data,
      });

      if (existing.isPrimary && existing.addressType !== nextType) {
        await this.promoteAddressReplacement(tx, companyId, existing.addressType, addressId);
      }

      return address;
    });

    await this.auditAddress(AuditAction.UPDATE, updated, metadata, existing);
    return serialiseAddress(updated);
  }

  async deleteAddress(companyId: number, addressId: number, metadata: RequestMetadata) {
    await this.ensureActiveCompany(companyId);
    const existing = await this.getActiveAddress(companyId, addressId);

    await this.db.$transaction(async (tx) => {
      await tx.companyAddress.update({
        where: { id: addressId },
        data: { deletedAt: new Date(), isPrimary: false },
      });

      if (existing.isPrimary) {
        await this.promoteAddressReplacement(tx, companyId, existing.addressType, addressId);
      }
    });

    await this.auditAddress(AuditAction.DELETE, existing, metadata);
  }

  async setPrimaryAddress(companyId: number, addressId: number, metadata: RequestMetadata) {
    await this.ensureActiveCompany(companyId);
    const existing = await this.getActiveAddress(companyId, addressId);

    const updated = await this.db.$transaction(async (tx) => {
      await tx.companyAddress.updateMany({
        where: {
          companyId,
          addressType: existing.addressType,
          deletedAt: null,
          isPrimary: true,
          NOT: { id: addressId },
        },
        data: { isPrimary: false },
      });

      return tx.companyAddress.update({
        where: { id: addressId },
        data: { isPrimary: true },
      });
    });

    await this.auditAddress(AuditAction.UPDATE, updated, metadata, existing, {
      primaryChanged: true,
    });
    return serialiseAddress(updated);
  }

  private async ensureActiveCompany(companyId: number) {
    const company = await this.db.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true },
    });
    if (company === null) throw new AppError('Company not found', 404);
  }

  private async getActiveAddress(companyId: number, addressId: number) {
    const address = await this.db.companyAddress.findFirst({
      where: { id: addressId, companyId, deletedAt: null, company: { deletedAt: null } },
    });
    if (address === null) throw new AppError('Company address not found', 404);
    return address;
  }

  private async promoteAddressReplacement(
    tx: TransactionClient,
    companyId: number,
    addressType: AddressType,
    excludedAddressId: number,
  ) {
    const replacement = await tx.companyAddress.findFirst({
      where: {
        companyId,
        addressType,
        deletedAt: null,
        NOT: { id: excludedAddressId },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (replacement !== null) {
      await tx.companyAddress.update({
        where: { id: replacement.id },
        data: { isPrimary: true },
      });
    }
  }

  private async auditAddress(
    action: AuditAction,
    address: CompanyAddress,
    metadata: RequestMetadata,
    previous?: CompanyAddress,
    extra?: Prisma.InputJsonObject,
  ) {
    const changed = previous
      ? pickChangedFields(
          previous as unknown as Record<string, unknown>,
          address as unknown as Record<string, unknown>,
          [...addressAuditFields],
        )
      : undefined;

    await createAuditLog(this.db, {
      metadata,
      entityType: 'CompanyAddress',
      entityId: String(address.id),
      action,
      oldValues: changed?.oldValues,
      newValues: {
        ...(changed?.newValues ?? {
          companyId: address.companyId,
          addressType: address.addressType,
          addressLine1: address.addressLine1,
          isPrimary: address.isPrimary,
        }),
        ...extra,
      },
    });
  }
}

function toAddressCreateData(companyId: number, input: CompanyAddressCreateInput) {
  return {
    companyId,
    addressType: input.addressType,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    city: input.city ?? '',
    state: input.state ?? '',
    postalCode: input.postalCode ?? '',
    country: input.country,
    isPrimary: input.isPrimary,
  };
}

function toAddressUpdateData(input: CompanyAddressUpdateInput) {
  return {
    ...(input.addressType === undefined ? {} : { addressType: input.addressType }),
    ...(input.addressLine1 === undefined ? {} : { addressLine1: input.addressLine1 }),
    ...(input.addressLine2 === undefined ? {} : { addressLine2: input.addressLine2 ?? null }),
    ...(input.city === undefined ? {} : { city: input.city ?? '' }),
    ...(input.state === undefined ? {} : { state: input.state ?? '' }),
    ...(input.postalCode === undefined ? {} : { postalCode: input.postalCode ?? '' }),
    ...(input.country === undefined ? {} : { country: input.country }),
    ...(input.isPrimary === undefined ? {} : { isPrimary: input.isPrimary }),
  };
}
