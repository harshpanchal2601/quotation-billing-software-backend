import { Prisma, AuditAction } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { prisma } from '../../../core/database/prisma.js';
import { BusinessProfileRepository } from '../business-profile/business-profile.repository.js';
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
    return serialiseQuotationSettings(await this.getOrCreateQuotationSettings(firmId));
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

function deriveQuotationPrefix(slug: string) {
  const prefix = slug.replace(/-/g, '_').toUpperCase().slice(0, 30);
  return prefix.length >= 2 ? prefix : 'ERP';
}

export const quotationSettingsRepository = new QuotationSettingsRepository(prisma);

export async function getOrCreateQuotationSettings(firmId: number, db: PrismaClient = prisma) {
  return new QuotationSettingsRepository(db).getOrCreateQuotationSettings(firmId);
}
