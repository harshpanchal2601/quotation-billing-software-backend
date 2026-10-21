import crypto from 'node:crypto';
import path from 'node:path';

import multer from 'multer';

import { firmPublicAssetDirectory, storageConfig } from '../../../config/storage.config.js';
import { AppError } from '../../../core/errors/AppError.js';
import {
  deleteStorageFile,
  ensureStorageDirectory,
  resolveStoragePath,
} from '../../../integrations/storage/index.js';

const allowedMimeExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
} as const;

export const ITEM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const uploadItemImage = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, callback) => {
      try {
        if (req.firmId === undefined) {
          callback(new AppError('Firm context is required', 500), '');
          return;
        }
        const directory = firmPublicAssetDirectory(req.firmId, storageConfig.itemImageDirectory);
        await ensureStorageDirectory(directory);
        callback(null, resolveStoragePath(directory));
      } catch (error) {
        callback(error as Error, '');
      }
    },
    filename: (_req, file, callback) => {
      const extension = allowedMimeExtensions[file.mimetype as keyof typeof allowedMimeExtensions];
      if (extension === undefined) {
        callback(new AppError('Unsupported item image type', 415), '');
        return;
      }
      callback(null, `item-${crypto.randomUUID()}${extension}`);
    },
  }),
  limits: {
    fileSize: ITEM_IMAGE_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const error = validateItemImageFile(file);
    if (error !== null) {
      callback(error);
      return;
    }
    callback(null, true);
  },
});

export function validateItemImageFile(file: Pick<Express.Multer.File, 'mimetype' | 'originalname' | 'size'>) {
  if (file.size > ITEM_IMAGE_MAX_BYTES) {
    return new AppError('Item image exceeds the 5 MB limit', 413);
  }

  if (!(file.mimetype in allowedMimeExtensions)) {
    return new AppError('Unsupported item image type', 415);
  }

  const extension = path.extname(file.originalname).toLowerCase();
  const expectedExtension = allowedMimeExtensions[file.mimetype as keyof typeof allowedMimeExtensions];
  const allowedExtensions = expectedExtension === '.jpg' ? ['.jpg', '.jpeg'] : [expectedExtension];

  if (!allowedExtensions.includes(extension)) {
    return new AppError('File extension does not match image type', 415);
  }

  return null;
}

export function toItemRelativePath(firmId: number, filename: string): string {
  return `${firmPublicAssetDirectory(firmId, storageConfig.itemImageDirectory)}/${path.basename(filename)}`;
}

export async function removeStoredItemImage(relativePath: string | null): Promise<void> {
  if (relativePath === null || relativePath === undefined || relativePath.trim().length === 0) {
    return;
  }

  try {
    await deleteStorageFile(relativePath);
  } catch (error) {
    if (error instanceof AppError) {
      console.warn('Stored item image could not be removed.');
    }
  }
}

export function handleMulterError(error: unknown) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new AppError('Item image exceeds the 5 MB limit', 413);
    }
    return new AppError('The image could not be uploaded. Please choose a supported image and try again.', 400);
  }
  return error;
}
