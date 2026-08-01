import { Prisma, AuditAction } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { prisma } from '../../../core/database/prisma.js';
import { BusinessProfileRepository } from '../business-profile/business-profile.repository.js';
import { defaultQuotationSettingsData } from '../settings.defaults.js';
import { createSettingsAuditLog, pickChangedFields, type RequestMetadata } from '../settings.audit.js';
import { serialiseQuotationSettings } from '../settings.serializers.js';
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

  async getOrCreateQuotationSettings() {
    const businessProfile = await this.getBusinessProfileRepository().getOrCreateBusinessProfile();
    const existing = await this.db.quotationSetting.findUnique({
      where: { businessProfileId: businessProfile.id },
    });

    if (existing !== null) return existing;

    try {
      return await this.db.quotationSetting.create({
        data: {
          businessProfileId: businessProfile.id,
          ...defaultQuotationSettingsData,
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

  async getQuotationSettings() {
    return serialiseQuotationSettings(await this.getOrCreateQuotationSettings());
  }

  async updateQuotationSettings(input: QuotationSettingsUpdateInput, metadata: RequestMetadata) {
    const settings = await this.getOrCreateQuotationSettings();
    const data = Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [
          key,
          key === 'defaultGstRate' && value !== undefined ? new Prisma.Decimal(String(value)) : value,
        ]),
    );

    const updated = await this.db.quotationSetting.update({
      where: { id: settings.id },
      data,
    });

    const before = {
      ...settings,
      defaultGstRate: settings.defaultGstRate.toFixed(2),
    } as unknown as Record<string, unknown>;
    const after = {
      ...updated,
      defaultGstRate: updated.defaultGstRate.toFixed(2),
    } as unknown as Record<string, unknown>;
    const { oldValues, newValues } = pickChangedFields(before, after, [...quotationSettingFields]);

    await createSettingsAuditLog(this.db, {
      metadata,
      entityType: 'QuotationSetting',
      entityId: String(updated.id),
      action: AuditAction.UPDATE,
      oldValues,
      newValues,
    });

    return serialiseQuotationSettings(updated);
  }

  private getBusinessProfileRepository() {
    return new BusinessProfileRepository(this.db);
  }
}

export const quotationSettingsRepository = new QuotationSettingsRepository(prisma);

export async function getOrCreateQuotationSettings(db: PrismaClient = prisma) {
  return new QuotationSettingsRepository(db).getOrCreateQuotationSettings();
}
