import type { PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { prisma } from '../../../core/database/prisma.js';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../core/errors/AppError.js';
import { assertTransactionFeature, prepareStorageUsage, recordStorageReplacement, withFirmEntitlementTransaction } from '../../entitlements/index.js';
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

  async replaceAsset(firmId: number, assetType: BrandingAssetType, file: Express.Multer.File, metadata: RequestMetadata) {
    const profile = await this.getBusinessProfileRepository().getOrCreateBusinessProfile(firmId);
    const config = brandingAssetConfig[assetType];
    const relativePath = toBrandingRelativePath(firmId, assetType, file.filename);
    let previousPath: string | null = null;
    let removePrevious = false;

    try {
      const updated = await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
        const current = await tx.businessProfile.findUnique({ where: { firmId } });
        if (current === null) throw new AppError('Business profile not found', 404);
        previousPath = current[config.profileField];
        await assertTransactionFeature(tx, firmId, 'firm.core');
        await prepareStorageUsage(tx, firmId);
        const updated = await tx.businessProfile.update({
          where: { id: profile.id }, data: { [config.profileField]: relativePath },
        });
        removePrevious = await recordStorageReplacement(tx, firmId, BigInt(file.size), previousPath, `branding:${relativePath}`);
        return updated;
      });

      if (removePrevious) await removeStoredBrandingAsset(previousPath);
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

  async deleteAsset(firmId: number, assetType: BrandingAssetType, metadata: RequestMetadata) {
    const profile = await this.getBusinessProfileRepository().getOrCreateBusinessProfile(firmId);
    const config = brandingAssetConfig[assetType];
    let previousPath = profile[config.profileField];
    let removePrevious = false;

    if (previousPath === null) {
      return serialiseBusinessProfile(profile);
    }

    const updated = await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const current = await tx.businessProfile.findUnique({ where: { firmId } });
      if (current === null) throw new AppError('Business profile not found', 404);
      previousPath = current[config.profileField];
      await prepareStorageUsage(tx, firmId);
      const updated = await tx.businessProfile.update({
        where: { id: profile.id }, data: { [config.profileField]: null },
      });
      removePrevious = await recordStorageReplacement(tx, firmId, 0n, previousPath, `branding:delete:${randomUUID()}`);
      return updated;
    });

    if (removePrevious) await removeStoredBrandingAsset(previousPath);
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
