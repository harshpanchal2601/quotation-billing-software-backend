import { Prisma, AuditAction } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { BusinessProfileService } from './business-profile.service.js';
import { defaultQuotationSettingsData } from './business-settings.defaults.js';
import { createSettingsAuditLog, pickChangedFields, type RequestMetadata } from './business-settings.audit.js';
import { serialiseQuotationSettings } from './business-settings.serializers.js';
import type { QuotationSettingsUpdateInput } from './business-settings.validation.js';

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

export class QuotationSettingsService {
  private readonly businessProfileService: BusinessProfileService;

  constructor(private readonly db: PrismaClient) {
    this.businessProfileService = new BusinessProfileService(db);
  }

  async getOrCreateQuotationSettings() {
    const businessProfile = await this.businessProfileService.getOrCreateBusinessProfile();
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
}
