import type { BusinessProfile, PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { prisma } from '../../../core/database/prisma.js';
import { AppError } from '../../../core/errors/AppError.js';
import { createSettingsAuditLog, pickChangedFields, type RequestMetadata } from '../settings.audit.js';
import { serialiseBusinessProfile } from '../settings.serializers.js';
import type { BusinessProfileUpdateInput } from './business-profile.schema.js';

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

export class BusinessProfileRepository {
  constructor(private readonly db: PrismaClient) {}

  async getOrCreateBusinessProfile(firmId: number) {
    const existingProfile = await this.findProfile(firmId);
    if (existingProfile !== null) return existingProfile;

    const firm = await this.db.firm.findFirst({ where: { id: firmId, deletedAt: null } });
    if (firm === null) throw new AppError('Firm not found', 404);

    try {
      return await this.db.businessProfile.create({
        data: {
          firmId,
          legalName: firm.name,
          displayName: firm.name,
          addressLine1: 'Not configured',
          city: 'Not configured',
          state: 'Not configured',
          postalCode: 'N/A',
          country: 'India',
        },
      });
    } catch {
      const profile = await this.findProfile(firmId);
      if (profile !== null) return profile;
      throw new Error('Business profile could not be created');
    }
  }

  async getBusinessProfile(firmId: number) {
    return serialiseBusinessProfile(await this.getOrCreateBusinessProfile(firmId));
  }

  async updateBusinessProfile(firmId: number, input: BusinessProfileUpdateInput, metadata: RequestMetadata) {
    const profile = await this.getOrCreateBusinessProfile(firmId);
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

  private async findProfile(firmId: number): Promise<BusinessProfile | null> {
    return this.db.businessProfile.findUnique({ where: { firmId } });
  }
}

export const businessProfileRepository = new BusinessProfileRepository(prisma);
