import type { Request } from 'express';
import multer from 'multer';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../../core/errors/AppError.js';
import { storageService } from './storage.service.js';
import { isFirmPublicAssetPath, isFirmStoragePath, storageConfig } from '../../config/storage.config.js';

// Persist the exact path chosen before the upload, including its firm-name
// snapshot. Rebuilding a path afterwards could point at a different object.
export function storedUploadRelativePath(firmId: number, baseDirectory: string, filename: string, storedPath: string, assetDirectory?: string) {
  const valid = assetDirectory === undefined
    ? isFirmStoragePath(storedPath, baseDirectory, firmId) && storedPath.split('/').length === 3
    : baseDirectory === storageConfig.firmAssetDirectory && isFirmPublicAssetPath(storedPath, firmId, assetDirectory);
  if (!valid || path.basename(storedPath) !== path.basename(filename)) throw new AppError('Invalid uploaded file path', 400);
  return storedPath;
}

// Multipart streams are bounded by each feature's existing Multer limits. Only
// an owned temporary spool is used; successful S3 uploads leave no local file.
export function createManagedUploadStorage(options: { directory: (req: Request) => string; filename: (req: Request, file: Express.Multer.File) => string }): multer.StorageEngine {
  return {
    _handleFile(req, file, callback) {
      let limited = false;
      const limit = () => { limited = true; };
      file.stream.once('limit', limit);
      void (async () => {
        const directory = options.directory(req);
        const filename = options.filename(req, file);
        const key = `${directory}/${filename}`;
        storageService.resolveStoragePath(key);
        if (await storageService.fileExists(key)) throw new AppError('Upload filename is already in use. Please try again.', 409);
        const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'qorwell-upload-'));
        const temporaryPath = path.join(temporaryDirectory, 'payload');
        const interrupted = () => file.stream.destroy(new Error('Upload interrupted'));
        req.once('aborted', interrupted);
        try {
          await pipeline(file.stream, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
          if (limited) throw new multer.MulterError('LIMIT_FILE_SIZE', file.fieldname);
          if (req.aborted) throw new Error('Upload interrupted');
          const { size } = await fs.stat(temporaryPath);
          try {
            await storageService.storeLocalFile(key, temporaryPath);
            if (req.aborted) throw new Error('Upload interrupted');
          } catch (error) {
            await storageService.deleteStorageFile(key).catch(() => {});
            throw error;
          }
          return { destination: directory, filename, path: key, size };
        } finally {
          req.off('aborted', interrupted);
          await fs.rm(temporaryDirectory, { recursive: true, force: true });
        }
      })().finally(() => { file.stream.off('limit', limit); }).then((result) => callback(null, result), (error: Error) => callback(error));
    },
    _removeFile(_req, file, callback) {
      void storageService.deleteStorageFile(file.path).then(() => callback(null), (error: Error) => callback(error));
    },
  };
}
