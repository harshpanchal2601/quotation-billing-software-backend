import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';

import { storageConfig } from '../../config/storage.config.js';
import { AppError } from '../../core/errors/AppError.js';

export type PublicAssetDirectory = (typeof storageConfig.publicAssetDirectories)[number];

export const publicAssetDirectories = storageConfig.publicAssetDirectories;

export function resolveStoragePath(relativePath: string) {
  const cleanRelativePath = relativePath.replace(/^\/?/, '');
  const resolvedPath = path.resolve(storageConfig.root, cleanRelativePath);
  const relativeToRoot = path.relative(storageConfig.root, resolvedPath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new AppError('Invalid storage path', 400);
  }

  return resolvedPath;
}

export async function ensureStorageDirectory(relativeDirectory: string) {
  await fs.mkdir(resolveStoragePath(relativeDirectory), { recursive: true });
}

export async function readStorageFile(relativePath: string) {
  return fs.readFile(resolveStoragePath(relativePath));
}

export async function writeStorageFile(relativePath: string, contents: string | Uint8Array | Buffer) {
  await ensureStorageDirectory(path.dirname(relativePath));
  await fs.writeFile(resolveStoragePath(relativePath), contents);
}

export async function deleteStorageFile(relativePath: string) {
  try {
    await fs.unlink(resolveStoragePath(relativePath));
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? (error as { code?: string }).code : undefined;
    if (code !== 'ENOENT') {
      throw new AppError('Storage file could not be removed', 500);
    }
  }
}

export async function fileExists(relativePath: string) {
  try {
    await fs.access(resolveStoragePath(relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function storageFileSize(relativePath: string) {
  try {
    const stat = await fs.stat(resolveStoragePath(relativePath));
    if (!stat.isFile() || !Number.isSafeInteger(stat.size)) throw new AppError('Invalid managed storage file', 409);
    return stat.size;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
}

export function publicAssetPath(directory: PublicAssetDirectory) {
  return path.resolve(storageConfig.root, directory);
}

export function setPublicAssetHeaders(res: Pick<express.Response, 'setHeader'>) {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

export function createPublicAssetStaticMiddleware(directory: PublicAssetDirectory) {
  return express.static(publicAssetPath(directory), {
    dotfiles: 'deny',
    index: false,
    fallthrough: false,
    maxAge: '1d',
    setHeaders: setPublicAssetHeaders,
  });
}

export const storageService = {
  resolveStoragePath,
  ensureStorageDirectory,
  readStorageFile,
  writeStorageFile,
  deleteStorageFile,
  fileExists,
  storageFileSize,
  publicAssetPath,
  createPublicAssetStaticMiddleware,
};
