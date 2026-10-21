import type { PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { prisma } from '../../../core/database/prisma.js';
import { BusinessProfileRepository } from '../business-profile/business-profile.repository.js';
import { createSettingsAuditLog, type RequestMetadata } from '../settings.audit.js';
import { serialiseBusinessProfile, toAssetUrl } from '../settings.serializers.js';
import {
  brandingAssetConfig,
  removeStoredBrandingAsset,
  toBrandingRelativePath,
  type BrandingAssetType,
} from './branding.policy.js';

export class BrandingRepository {
  constructor(private readonly db: PrismaClient) {}

  async replaceAsset(assetType: BrandingAssetType, file: Express.Multer.File, metadata: RequestMetadata) {
    const profile = await this.getBusinessProfileRepository().getOrCreateBusinessProfile();
    const config = brandingAssetConfig[assetType];
    const relativePath = toBrandingRelativePath(assetType, file.filename);
    const previousPath = profile[config.profileField];

    try {
      const updated = await this.db.businessProfile.update({
        where: { id: profile.id },
        data: { [config.profileField]: relativePath },
      });

      await removeStoredBrandingAsset(previousPath);
      await createSettingsAuditLog(this.db, {
        metadata,
        entityType: 'BusinessProfile',
        entityId: String(profile.id),
        action: AuditAction.UPDATE,
        oldValues: { [config.profileField]: previousPath === null ? null : toAssetUrl(previousPath) },
        newValues: { [config.profileField]: toAssetUrl(relativePath) },
      });

      return serialiseBusinessProfile(updated);
    } catch (error) {
      await removeStoredBrandingAsset(relativePath);
      throw error;
    }
  }

  async deleteAsset(assetType: BrandingAssetType, metadata: RequestMetadata) {
    const profile = await this.getBusinessProfileRepository().getOrCreateBusinessProfile();
    const config = brandingAssetConfig[assetType];
    const previousPath = profile[config.profileField];

    if (previousPath === null) {
      return serialiseBusinessProfile(profile);
    }

    const updated = await this.db.businessProfile.update({
      where: { id: profile.id },
      data: { [config.profileField]: null },
    });

    await removeStoredBrandingAsset(previousPath);
    await createSettingsAuditLog(this.db, {
      metadata,
      entityType: 'BusinessProfile',
      entityId: String(profile.id),
      action: AuditAction.UPDATE,
      oldValues: { [config.profileField]: toAssetUrl(previousPath) },
      newValues: { [config.profileField]: null },
    });

    return serialiseBusinessProfile(updated);
  }

  private getBusinessProfileRepository() {
    return new BusinessProfileRepository(this.db);
  }
}

export const brandingRepository = new BrandingRepository(prisma);
