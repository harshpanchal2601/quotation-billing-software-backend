import { Prisma, AuditAction } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { prisma } from '../../../core/database/prisma.js';
import { BusinessProfileRepository } from '../business-profile/business-profile.repository.js';
import { createSettingsAuditLog, pickChangedFields, type RequestMetadata } from '../settings.audit.js';
import { serialiseQuotationSettings } from '../settings.serializers.js';
import { AppError } from '../../../core/errors/AppError.js';
import type { QuotationSettingsUpdateInput } from './quotation-settings.schema.js';

const quotationSettingFields = [
  'quotationPrefix',
  'financialYearFormat',
  'nextSequenceNumber',
  'sequenceResetRule',
  'defaultValidityDays',
  'defaultTaxMode',
  'defaultGstRate',
  'defaultDeliveryTerms',
  'defaultDispatchTerms',
  'defaultPaymentTerms',
  'defaultFreightTerms',
  'defaultWarrantyTerms',
  'defaultRemarks',
  'defaultTermsAndConditions',
  'showBankDetails',
  'showAmountInWords',
] as const;

export class QuotationSettingsRepository {
  constructor(private readonly db: PrismaClient) {}

  async getOrCreateQuotationSettings(firmId: number) {
    const businessProfile = await this.getBusinessProfileRepository().getOrCreateBusinessProfile(firmId);
    const existing = await this.db.quotationSetting.findUnique({
      where: { businessProfileId: businessProfile.id },
    });

    if (existing !== null) return existing;

    const firm = await this.db.firm.findFirst({ where: { id: firmId, deletedAt: null } });
    if (firm === null) throw new Error('Firm not found');

    try {
      return await this.db.quotationSetting.create({
        data: {
          businessProfileId: businessProfile.id,
          quotationPrefix: deriveQuotationPrefix(firm.slug),
        },
      });
    } catch {
      const settings = await this.db.quotationSetting.findUnique({
        where: { businessProfileId: businessProfile.id },
      });
      if (settings !== null) return settings;
      throw new Error('Quotation settings could not be created');
    }
  }

  async getQuotationSettings(firmId: number) {
    const settings = await this.getOrCreateQuotationSettings(firmId);
    const sequence = await this.db.documentSequence.findUnique({ where: {
      firmId_documentType_period: { firmId, documentType: 'QUOTATION', period: 'LEGACY' },
    } });
    if (sequence !== null && sequence.nextValue > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError('Quotation sequence exceeds supported settings precision', 409);
    return serialiseQuotationSettings({ ...settings, nextSequenceNumber: sequence === null ? settings.nextSequenceNumber : Number(sequence.nextValue) });
  }

  async updateQuotationSettings(firmId: number, input: QuotationSettingsUpdateInput, metadata: RequestMetadata) {
    const settings = await this.getOrCreateQuotationSettings(firmId);
    const data = Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [
          key,
          key === 'defaultGstRate' && value !== undefined ? new Prisma.Decimal(String(value)) : value,
        ]),
    );

    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM quotation_settings WHERE id = ${settings.id} FOR UPDATE`;
      const lockedSettings = await tx.quotationSetting.findUniqueOrThrow({ where: { id: settings.id } });
      if (input.sequenceResetRule !== undefined && input.sequenceResetRule !== lockedSettings.sequenceResetRule) throw new AppError('Changing quotation reset behavior requires a separate numbering cutover', 409);
      const sequence = await tx.documentSequence.findUnique({ where: { firmId_documentType_period: { firmId, documentType: 'QUOTATION', period: 'LEGACY' } } });
      const currentNext = sequence?.nextValue ?? BigInt(lockedSettings.nextSequenceNumber);
      if (currentNext > BigInt(Number.MAX_SAFE_INTEGER)) throw new AppError('Quotation sequence exceeds supported settings precision', 409);
      if (input.nextSequenceNumber !== undefined && BigInt(input.nextSequenceNumber) < currentNext) throw new AppError('Sequence numbers cannot move backwards', 409);
      if (input.nextSequenceNumber !== undefined) {
        await tx.documentSequence.upsert({
          where: { firmId_documentType_period: { firmId, documentType: 'QUOTATION', period: 'LEGACY' } },
          create: { firmId, documentType: 'QUOTATION', period: 'LEGACY', nextValue: BigInt(input.nextSequenceNumber) },
          update: { nextValue: BigInt(input.nextSequenceNumber) },
        });
      }
      const updated = await tx.quotationSetting.update({
        where: { id: settings.id },
        data,
      });

      const before = {
        ...lockedSettings, nextSequenceNumber: Number(currentNext),
        defaultGstRate: lockedSettings.defaultGstRate.toFixed(2),
      } as unknown as Record<string, unknown>;
      const after = {
        ...updated, nextSequenceNumber: input.nextSequenceNumber ?? Number(currentNext),
        defaultGstRate: updated.defaultGstRate.toFixed(2),
      } as unknown as Record<string, unknown>;
      const { oldValues, newValues } = pickChangedFields(before, after, [...quotationSettingFields]);

      await createSettingsAuditLog(tx, {
        metadata,
        entityType: 'QuotationSetting',
        entityId: String(updated.id),
        action: AuditAction.UPDATE,
        policy: 'REQUIRED',
        oldValues,
        newValues,
      });

      return serialiseQuotationSettings({ ...updated, nextSequenceNumber: input.nextSequenceNumber ?? Number(currentNext) });
    });
  }

  private getBusinessProfileRepository() {
    return new BusinessProfileRepository(this.db);
  }
}

function deriveQuotationPrefix(slug: string) {
  const prefix = slug.replace(/-/g, '_').toUpperCase().slice(0, 30);
  return prefix.length >= 2 ? prefix : 'ERP';
}

export const quotationSettingsRepository = new QuotationSettingsRepository(prisma);

export async function getOrCreateQuotationSettings(firmId: number, db: PrismaClient = prisma) {
  return new QuotationSettingsRepository(db).getOrCreateQuotationSettings(firmId);
}
