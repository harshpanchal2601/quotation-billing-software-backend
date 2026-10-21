import crypto from 'node:crypto';
import path from 'node:path';

import multer from 'multer';

import { storageConfig } from '../../../config/storage.config.js';
import { AppError } from '../../../core/errors/AppError.js';
import {
  deleteStorageFile,
  ensureStorageDirectory,
  publicAssetPath,
  resolveStoragePath,
} from '../../../integrations/storage/index.js';

export type BrandingAssetType = 'logo' | 'signature' | 'stamp';

export const brandingAssetConfig = {
  logo: { directory: storageConfig.brandingDirectories.logo, field: 'logo', profileField: 'logoPath' },
  signature: { directory: storageConfig.brandingDirectories.signature, field: 'signature', profileField: 'signaturePath' },
  stamp: { directory: storageConfig.brandingDirectories.stamp, field: 'stamp', profileField: 'stampPath' },
} as const;

const allowedMimeExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
} as const;

export const BRANDING_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const uploadBrandingAsset = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, callback) => {
      try {
        const assetType = req.params.assetType as BrandingAssetType | undefined;
        if (assetType === undefined || !(assetType in brandingAssetConfig)) {
          callback(new AppError('Unsupported branding asset type', 404), '');
          return;
        }
        const directory = brandingAssetConfig[assetType].directory;
        await ensureStorageDirectory(directory);
        callback(null, publicAssetPath(directory));
      } catch (error) {
        callback(error as Error, '');
      }
    },
    filename: (req, file, callback) => {
      const assetType = req.params.assetType as BrandingAssetType | undefined;
      const extension = allowedMimeExtensions[file.mimetype as keyof typeof allowedMimeExtensions];
      if (assetType === undefined || extension === undefined) {
        callback(new AppError('Unsupported image type', 415), '');
        return;
      }

      callback(null, `${assetType}-${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: {
    fileSize: BRANDING_IMAGE_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const validationError = validateBrandingFile(file);
    if (validationError !== null) {
      callback(validationError);
      return;
    }

    callback(null, true);
  },
});

export function validateBrandingFile(file: Pick<Express.Multer.File, 'mimetype' | 'originalname' | 'size'>) {
  if (file.size > BRANDING_IMAGE_MAX_BYTES) {
    return new AppError('Image must be 5 MB or smaller', 413);
  }

  if (!(file.mimetype in allowedMimeExtensions)) {
    return new AppError('Unsupported image type', 415);
  }

  const extension = path.extname(file.originalname).toLowerCase();
  const expectedExtension = allowedMimeExtensions[file.mimetype as keyof typeof allowedMimeExtensions];
  const allowedExtensions = expectedExtension === '.jpg' ? ['.jpg', '.jpeg'] : [expectedExtension];

  if (!allowedExtensions.includes(extension)) {
    return new AppError('File extension does not match image type', 415);
  }

  return null;
}

export async function removeStoredBrandingAsset(relativePath: string | null) {
  if (relativePath === null) return;

  try {
    await deleteStorageFile(relativePath);
  } catch (error) {
    if (error instanceof AppError) {
      console.warn('Stored branding asset could not be removed.');
    }
  }
}

export function toBrandingRelativePath(assetType: BrandingAssetType, filename: string) {
  return `${brandingAssetConfig[assetType].directory}/${path.basename(filename)}`;
}

export function resolveBrandingPath(relativePath: string) {
  return resolveStoragePath(relativePath);
}

export function mapMulterError(error: unknown) {
  if (error instanceof AppError) return error;
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return new AppError('Image must be 5 MB or smaller', 413);
    return new AppError('Invalid upload request', 400);
  }
  return error;
}
