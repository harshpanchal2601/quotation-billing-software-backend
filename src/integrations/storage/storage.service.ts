import express, { type Request, type Response } from 'express';
import { createReadStream, constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

import { storageConfig } from '../../config/storage.config.js';
import { AppError } from '../../core/errors/AppError.js';

export type PublicAssetDirectory = (typeof storageConfig.publicAssetDirectories)[number];
export const publicAssetDirectories = storageConfig.publicAssetDirectories;
export type StorageOptions = Pick<typeof storageConfig, 'driver' | 'root' | 'bucket' | 'region' | 'prefix' | 'expectedBucketOwner'>;

const contentTypes: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function statusCode(error: unknown) {
  return error && typeof error === 'object' && '$metadata' in error
    ? (error.$metadata as { httpStatusCode?: number } | undefined)?.httpStatusCode : undefined;
}
function missing(error: unknown) {
  return error instanceof AppError && error.statusCode === 404 || statusCode(error) === 404 || (error instanceof Error && 'code' in error && error.code === 'ENOENT');
}
function failure(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (missing(error)) throw new AppError('Storage file not found', 404);
  if (statusCode(error) === 416) throw new AppError('Requested file range is not available', 416);
  throw new AppError('File storage is temporarily unavailable. Please try again.', 503);
}

// Keys and database paths stay provider-independent. S3 mode never silently
// falls back to disk: a provider outage must not look like a successful save.
export function createStorageService(options: StorageOptions, suppliedClient?: S3Client) {
  let client = suppliedClient;
  const s3 = () => client ??= new S3Client({ region: options.region, maxAttempts: 3, requestHandler: { connectionTimeout: 5000, requestTimeout: 60000 } });
  const key = (relativePath: string) => {
    const clean = relativePath.replace(/\\/g, '/').replace(/^\//, '');
    if (!clean || clean.includes('\0') || clean.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.')) || /^[A-Za-z]:/.test(clean)) throw new AppError('Invalid storage path', 400);
    return clean;
  };
  const object = (relativePath: string) => ({ Bucket: options.bucket, Key: [options.prefix, key(relativePath)].filter(Boolean).join('/'), ExpectedBucketOwner: options.expectedBucketOwner });
  const resolveStoragePath = (relativePath: string) => path.resolve(options.root, key(relativePath));
  const ensureStorageDirectory = async (relativeDirectory: string) => {
    if (options.driver === 'local') await fs.mkdir(resolveStoragePath(relativeDirectory), { recursive: true });
    else key(relativeDirectory);
  };
  const writeStorageFile = async (relativePath: string, contents: string | Uint8Array | Buffer) => {
    const clean = key(relativePath);
    try {
      if (options.driver === 's3') {
        await s3().send(new PutObjectCommand({ ...object(clean), Body: contents, ContentType: contentTypes[path.extname(clean).toLowerCase()] ?? 'application/octet-stream', ServerSideEncryption: 'AES256' }));
      } else {
        await fs.mkdir(path.dirname(resolveStoragePath(clean)), { recursive: true });
        await fs.writeFile(resolveStoragePath(clean), contents);
      }
    } catch (error) { failure(error); }
  };
  const storeLocalFile = async (relativePath: string, sourcePath: string) => {
    const clean = key(relativePath);
    try {
      if (options.driver === 's3') {
        const info = await fs.stat(sourcePath);
        if (!info.isFile()) throw new AppError('Invalid upload source', 400);
        const body = createReadStream(sourcePath);
        try { await s3().send(new PutObjectCommand({ ...object(clean), Body: body, ContentLength: info.size, ContentType: contentTypes[path.extname(clean).toLowerCase()] ?? 'application/octet-stream', ServerSideEncryption: 'AES256' })); }
        finally { body.destroy(); }
      } else {
        await fs.mkdir(path.dirname(resolveStoragePath(clean)), { recursive: true });
        await fs.copyFile(sourcePath, resolveStoragePath(clean), constants.COPYFILE_EXCL);
      }
    } catch (error) { failure(error); }
  };
  const readStorageFile = async (relativePath: string) => {
    const clean = key(relativePath);
    try {
      if (options.driver === 'local') return await fs.readFile(resolveStoragePath(clean));
      const result = await s3().send(new GetObjectCommand(object(clean)));
      if (!result.Body) throw new AppError('Storage file not found', 404);
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) { return failure(error); }
  };
  const deleteStorageFile = async (relativePath: string) => {
    const clean = key(relativePath);
    try {
      if (options.driver === 's3') await s3().send(new DeleteObjectCommand(object(clean)));
      else await fs.unlink(resolveStoragePath(clean));
    } catch (error) { if (!missing(error)) failure(error); }
  };
  const metadata = async (relativePath: string) => {
    const clean = key(relativePath);
    if (options.driver === 's3') {
      try {
        const result = await s3().send(new HeadObjectCommand(object(clean)));
        return { size: result.ContentLength };
      } catch (error) {
        // A prefix-scoped ListBucket grant can make HEAD of a missing object
        // return 403. An exact-key listing proves absence without treating an
        // authentication/storage outage as a missing file.
        if (statusCode(error) !== 403) throw error;
        const request = object(clean);
        const listing = await s3().send(new ListObjectsV2Command({ Bucket: request.Bucket, Prefix: request.Key, MaxKeys: 1, ExpectedBucketOwner: request.ExpectedBucketOwner }));
        if (!(listing.Contents ?? []).some((entry) => entry.Key === request.Key)) throw new AppError('Storage file not found', 404);
        throw error;
      }
    }
    const info = await fs.stat(resolveStoragePath(clean));
    if (!info.isFile()) throw new AppError('Invalid managed storage file', 409);
    return { size: info.size };
  };
  const fileExists = async (relativePath: string) => {
    key(relativePath);
    try { await metadata(relativePath); return true; }
    catch (error) { if (missing(error)) return false; return failure(error); }
  };
  const storageFileSize = async (relativePath: string) => {
    key(relativePath);
    try {
      const { size } = await metadata(relativePath);
      if (size === undefined || !Number.isSafeInteger(size) || size < 0) throw new AppError('Invalid managed storage file', 409);
      return size;
    } catch (error) { if (missing(error)) return 0; return failure(error); }
  };
  const sendStorageFile = async (relativePath: string, res: Response, publicAsset = false) => {
    const clean = key(relativePath);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', publicAsset ? 'public, max-age=86400' : 'private, no-store');
    if (options.driver === 'local') {
      try { await new Promise<void>((resolve, reject) => res.sendFile(resolveStoragePath(clean), (error) => error ? reject(error) : resolve())); }
      catch (error) { failure(error); }
      return;
    }
    let result;
    try {
      result = await s3().send(new GetObjectCommand({ ...object(clean), Range: res.req.get('range'), IfNoneMatch: publicAsset ? res.req.get('if-none-match') : undefined }));
    } catch (error) {
      if (statusCode(error) === 304) { res.status(304).end(); return; }
      failure(error);
    }
    if (!result.Body) throw new AppError('Storage file not found', 404);
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', result.ContentType ?? contentTypes[path.extname(clean)] ?? 'application/octet-stream');
    if (result.ContentLength !== undefined) res.setHeader('Content-Length', result.ContentLength);
    if (result.ETag) res.setHeader('ETag', result.ETag);
    if (result.LastModified) res.setHeader('Last-Modified', result.LastModified.toUTCString());
    res.setHeader('Accept-Ranges', 'bytes');
    if (result.ContentRange) { res.status(206); res.setHeader('Content-Range', result.ContentRange); }
    const body = result.Body as Readable;
    if (res.req.method === 'HEAD') { body.destroy(); res.end(); return; }
    await pipeline(body, res);
  };
  const publicAssetPath = (directory: PublicAssetDirectory) => resolveStoragePath(directory);
  const createPublicAssetStaticMiddleware = (directory: PublicAssetDirectory): express.RequestHandler => {
    if (options.driver === 'local') return express.static(publicAssetPath(directory), { dotfiles: 'deny', index: false, fallthrough: false, maxAge: '1d', setHeaders: setPublicAssetHeaders });
    return (req: Request, res: Response, next: express.NextFunction) => {
      if (!['GET', 'HEAD'].includes(req.method)) { next(new AppError('Method not allowed', 405)); return; }
      let relativePath: string;
      try { relativePath = key(`${directory}/${decodeURIComponent(req.path).replace(/^\//, '')}`); }
      catch { next(new AppError('Asset not found', 404)); return; }
      setPublicAssetHeaders(res);
      void sendStorageFile(relativePath, res, true).catch(next);
    };
  };
  return { resolveStoragePath, ensureStorageDirectory, readStorageFile, writeStorageFile, storeLocalFile, deleteStorageFile, fileExists, storageFileSize, sendStorageFile, publicAssetPath, createPublicAssetStaticMiddleware };
}

export function setPublicAssetHeaders(res: Pick<express.Response, 'setHeader'>) {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}
export const storageService = createStorageService(storageConfig);
export const { resolveStoragePath, ensureStorageDirectory, readStorageFile, writeStorageFile, storeLocalFile, deleteStorageFile, fileExists, storageFileSize, sendStorageFile, publicAssetPath, createPublicAssetStaticMiddleware } = storageService;
