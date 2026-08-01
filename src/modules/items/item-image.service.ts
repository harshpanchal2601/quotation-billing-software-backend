import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import multer from 'multer';

import { AppError } from '../../core/errors/AppError.js';

export const itemsStorageDirectory = path.resolve(process.cwd(), 'storage', 'items');
const storageRoot = path.resolve(process.cwd(), 'storage');

const allowedMimeExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
} as const;

export const uploadItemImage = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, callback) => {
      try {
        await fs.mkdir(itemsStorageDirectory, { recursive: true });
        callback(null, itemsStorageDirectory);
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
    fileSize: 5 * 1024 * 1024,
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
  if (file.size > 5 * 1024 * 1024) {
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

export function toItemRelativePath(filename: string): string {
  return `items/${path.basename(filename)}`;
}

export function resolveItemImagePath(relativePath: string): string {
  const resolved = path.resolve(storageRoot, relativePath);
  if (!resolved.startsWith(itemsStorageDirectory)) {
    throw new AppError('Invalid item image path', 400);
  }
  return resolved;
}

export async function removeStoredItemImage(relativePath: string | null): Promise<void> {
  if (relativePath === null || relativePath === undefined || relativePath.trim().length === 0) {
    return;
  }

  try {
    const absolutePath = resolveItemImagePath(relativePath);
    await fs.unlink(absolutePath);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'ENOENT') {
      console.warn('Stored item image could not be removed.');
    }
  }
}
