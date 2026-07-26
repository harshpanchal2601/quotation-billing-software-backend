import type { BusinessProfile, PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { defaultBusinessProfileData } from './business-settings.defaults.js';
import { createSettingsAuditLog, pickChangedFields, type RequestMetadata } from './business-settings.audit.js';
import { serialiseBusinessProfile } from './business-settings.serializers.js';
import type { BusinessProfileUpdateInput } from './business-settings.validation.js';

const businessProfileFields = [
  'legalName',
  'displayName',
  'gstin',
  'pan',
  'cin',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
  'primaryPhone',
  'secondaryPhone',
  'primaryEmail',
  'secondaryEmail',
  'website',
  'primaryColour',
  'secondaryColour',
  'defaultCurrency',
] as const;

export class BusinessProfileService {
  constructor(private readonly db: PrismaClient) {}

  async getOrCreateBusinessProfile() {
    const existingProfile = await this.findFirstProfile();
    if (existingProfile !== null) return existingProfile;

    try {
      return await this.db.businessProfile.create({ data: defaultBusinessProfileData });
    } catch {
      const profile = await this.findFirstProfile();
      if (profile !== null) return profile;
      throw new Error('Business profile could not be created');
    }
  }

  async getBusinessProfile() {
    return serialiseBusinessProfile(await this.getOrCreateBusinessProfile());
  }

  async updateBusinessProfile(input: BusinessProfileUpdateInput, metadata: RequestMetadata) {
    const profile = await this.getOrCreateBusinessProfile();
    const data = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    ) as Partial<BusinessProfileUpdateInput>;

    const updated = await this.db.businessProfile.update({
      where: { id: profile.id },
      data,
    });

    const { oldValues, newValues } = pickChangedFields(
      profile as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
      [...businessProfileFields],
    );

    await createSettingsAuditLog(this.db, {
      metadata,
      entityType: 'BusinessProfile',
      entityId: String(updated.id),
      action: AuditAction.UPDATE,
      oldValues,
      newValues,
    });

    return serialiseBusinessProfile(updated);
  }

  private async findFirstProfile(): Promise<BusinessProfile | null> {
    return this.db.businessProfile.findFirst({ orderBy: { id: 'asc' } });
  }
}
