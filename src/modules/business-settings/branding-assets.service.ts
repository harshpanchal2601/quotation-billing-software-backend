import type { PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { BusinessProfileService } from './business-profile.service.js';
import { createSettingsAuditLog, type RequestMetadata } from './business-settings.audit.js';
import { serialiseBusinessProfile, toAssetUrl } from './business-settings.serializers.js';
import {
  brandingAssetConfig,
  removeStoredBrandingAsset,
  toBrandingRelativePath,
  type BrandingAssetType,
} from './branding-upload.js';

export class BrandingAssetsService {
  private readonly businessProfileService: BusinessProfileService;

  constructor(private readonly db: PrismaClient) {
    this.businessProfileService = new BusinessProfileService(db);
  }

  async replaceAsset(assetType: BrandingAssetType, file: Express.Multer.File, metadata: RequestMetadata) {
    const profile = await this.businessProfileService.getOrCreateBusinessProfile();
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
    const profile = await this.businessProfileService.getOrCreateBusinessProfile();
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
}
