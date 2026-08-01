import type { BankDetail, PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { AppError } from '../../../core/errors/AppError.js';
import { prisma } from '../../../core/database/prisma.js';
import { businessProfileRepository } from '../business-profile/business-profile.repository.js';
import { createSettingsAuditLog, type RequestMetadata } from '../settings.audit.js';
import { maskAccountNumber, serialiseBankDetail } from '../settings.serializers.js';
import type { BankDetailCreateInput, BankDetailUpdateInput } from './bank-details.schema.js';

export class BankDetailsRepository {
  constructor(private readonly db: PrismaClient) {}

  async listBankDetails() {
    const businessProfile = await businessProfileRepository.getOrCreateBusinessProfile();
    const bankDetails = await this.db.bankDetail.findMany({
      where: { businessProfileId: businessProfile.id, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { bankName: 'asc' }, { createdAt: 'asc' }],
    });
    return bankDetails.map(serialiseBankDetail);
  }

  async createBankDetail(input: BankDetailCreateInput, metadata: RequestMetadata) {
    const businessProfile = await businessProfileRepository.getOrCreateBusinessProfile();

    const created = await this.db.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.bankDetail.updateMany({
          where: { businessProfileId: businessProfile.id, deletedAt: null, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.bankDetail.create({
        data: {
          businessProfileId: businessProfile.id,
          ...input,
        },
      });
    });

    await this.auditBankDetail(AuditAction.CREATE, created, metadata);
    return serialiseBankDetail(created);
  }

  async updateBankDetail(id: number, input: BankDetailUpdateInput, metadata: RequestMetadata) {
    const existing = await this.getExistingBankDetail(id);

    const updated = await this.db.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.bankDetail.updateMany({
          where: {
            businessProfileId: existing.businessProfileId,
            deletedAt: null,
            isDefault: true,
            NOT: { id: existing.id },
          },
          data: { isDefault: false },
        });
      }

      return tx.bankDetail.update({
        where: { id: existing.id },
        data: input,
      });
    });

    await this.auditBankDetail(AuditAction.UPDATE, updated, metadata, existing);
    return serialiseBankDetail(updated);
  }

  async deleteBankDetail(id: number, metadata: RequestMetadata) {
    const existing = await this.getExistingBankDetail(id);

    await this.db.$transaction(async (tx) => {
      await tx.bankDetail.update({
        where: { id: existing.id },
        data: {
          deletedAt: new Date(),
          isDefault: false,
        },
      });

      if (existing.isDefault) {
        const replacement = await tx.bankDetail.findFirst({
          where: {
            businessProfileId: existing.businessProfileId,
            deletedAt: null,
            NOT: { id: existing.id },
          },
          orderBy: [{ createdAt: 'asc' }],
        });

        if (replacement !== null) {
          await tx.bankDetail.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
        }
      }
    });

    await this.auditBankDetail(AuditAction.DELETE, existing, metadata);
  }

  async setDefaultBankDetail(id: number, metadata: RequestMetadata) {
    const existing = await this.getExistingBankDetail(id);

    const updated = await this.db.$transaction(async (tx) => {
      await tx.bankDetail.updateMany({
        where: {
          businessProfileId: existing.businessProfileId,
          deletedAt: null,
          isDefault: true,
          NOT: { id: existing.id },
        },
        data: { isDefault: false },
      });

      return tx.bankDetail.update({
        where: { id: existing.id },
        data: { isDefault: true },
      });
    });

    await this.auditBankDetail(AuditAction.UPDATE, updated, metadata, existing, {
      defaultChanged: true,
    });
    return serialiseBankDetail(updated);
  }

  private async getExistingBankDetail(id: number) {
    const businessProfile = await businessProfileRepository.getOrCreateBusinessProfile();
    const bankDetail = await this.db.bankDetail.findFirst({
      where: { id, businessProfileId: businessProfile.id, deletedAt: null },
    });

    if (bankDetail === null) {
      throw new AppError('Bank detail not found', 404);
    }

    return bankDetail;
  }

  private async auditBankDetail(
    action: AuditAction,
    bankDetail: BankDetail,
    metadata: RequestMetadata,
    previous?: BankDetail,
    extra?: Record<string, unknown>,
  ) {
    await createSettingsAuditLog(this.db, {
      metadata,
      entityType: 'BankDetail',
      entityId: String(bankDetail.id),
      action,
      oldValues: previous
        ? {
            bankName: previous.bankName,
            accountNumber: maskAccountNumber(previous.accountNumber),
            isDefault: previous.isDefault,
          }
        : undefined,
      newValues: {
        bankName: bankDetail.bankName,
        accountNumber: maskAccountNumber(bankDetail.accountNumber),
        isDefault: bankDetail.isDefault,
        ...extra,
      },
    });
  }
}

export const bankDetailsRepository = new BankDetailsRepository(prisma);
