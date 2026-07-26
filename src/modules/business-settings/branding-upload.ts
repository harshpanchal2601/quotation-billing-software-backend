import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import multer from 'multer';

import { AppError } from '../../utils/AppError.js';

export type BrandingAssetType = 'logo' | 'signature' | 'stamp';

export const brandingAssetConfig = {
  logo: { directory: 'logos', field: 'logo', profileField: 'logoPath' },
  signature: { directory: 'signatures', field: 'signature', profileField: 'signaturePath' },
  stamp: { directory: 'stamps', field: 'stamp', profileField: 'stampPath' },
} as const;

const allowedMimeExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
} as const;

export const brandingStorageRoot = path.resolve(process.cwd(), 'storage');

export const uploadBrandingAsset = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, callback) => {
      try {
        const assetType = req.params.assetType as BrandingAssetType | undefined;
        if (assetType === undefined || !(assetType in brandingAssetConfig)) {
          callback(new AppError('Unsupported branding asset type', 404), '');
          return;
        }
        const directory = path.join(brandingStorageRoot, brandingAssetConfig[assetType].directory);
        await fs.mkdir(directory, { recursive: true });
        callback(null, directory);
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
    fileSize: 5 * 1024 * 1024,
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
  if (file.size > 5 * 1024 * 1024) {
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
  const absolutePath = resolveBrandingPath(relativePath);

  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'ENOENT') {
      console.warn('Stored branding asset could not be removed.');
    }
  }
}

export function toBrandingRelativePath(assetType: BrandingAssetType, filename: string) {
  return `${brandingAssetConfig[assetType].directory}/${path.basename(filename)}`;
}

export function resolveBrandingPath(relativePath: string) {
  const resolved = path.resolve(brandingStorageRoot, relativePath);
  if (!resolved.startsWith(brandingStorageRoot)) {
    throw new AppError('Invalid branding asset path', 400);
  }
  return resolved;
}
