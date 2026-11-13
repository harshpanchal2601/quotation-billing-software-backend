import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Response } from 'express';
import multer from 'multer';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { createStorageService, storageService, type StorageOptions } from '../src/integrations/storage/storage.service.js';
import { createManagedUploadStorage, storedUploadRelativePath } from '../src/integrations/storage/upload-storage.js';
import { firmPublicAssetDirectory, firmProtectedDirectory, firmStorageFolder, isFirmStoragePath, isFirmPublicAssetPath } from '../src/config/storage.config.js';
import { getBrandingFileDataUrl } from '../src/modules/quotations/documents/quotation-documents.repository.js';

let root: string;
const servers: Server[] = [];
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'qorwell-storage-test-')); });
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }))); await fs.rm(root, { recursive: true, force: true }); });
function options(driver: 'local' | 's3'): StorageOptions { return { driver, root, bucket: 'qorwell-test', region: 'eu-north-1', prefix: 'development', expectedBucketOwner: '429435740649' }; }
function remote(send = vi.fn()) { return { service: createStorageService(options('s3'), { send } as unknown as S3Client), send }; }
function awsError(status: number) { return Object.assign(new Error('Private provider details'), { $metadata: { httpStatusCode: status } }); }
async function listen(app: express.Express) { const server = createServer(app); servers.push(server); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address'); return `http://127.0.0.1:${address.port}`; }

describe('selectable managed file storage', () => {
  it('adds a safe readable firm name while keeping IDs distinct and paths bounded', () => {
    expect(firmProtectedDirectory('billing-documents', 7, '  ACME / Pvt. Ltd.  ')).toBe('billing-documents/7-acme-pvt-ltd');
    expect(firmPublicAssetDirectory(7, 'logos', 'ACME')).toBe('firm-assets/7-acme/logos');
    expect(firmStorageFolder(8, 'ACME')).not.toBe(firmStorageFolder(7, 'ACME'));
    expect(firmStorageFolder(7, 'श्री ट्रेडर्स')).toBe('7-श्री-ट्रेडर्स');
    expect(firmStorageFolder(7, '../../')).toBe('7-firm');
    expect(firmStorageFolder(7, 'x'.repeat(191))).toHaveLength(42);
    expect(() => firmStorageFolder(0, 'ACME')).toThrow();
  });
  it('accepts persisted numeric and named firm paths after a rename while rejecting other firms and traversal', () => {
    for (const file of ['billing-documents/7/doc.pdf', 'billing-documents/7-old-name/doc.pdf', 'billing-documents/7-new-name/doc.pdf']) expect(isFirmStoragePath(file, 'billing-documents', 7)).toBe(true);
    for (const file of ['billing-documents/70-acme/doc.pdf', 'billing-documents/8-acme/doc.pdf', 'billing-documents/7-acme/../doc.pdf', 'billing-documents/7-/doc.pdf', 'billing-documents/7-acme/.hidden', '/billing-documents/7-acme/doc.pdf']) expect(isFirmStoragePath(file, 'billing-documents', 7)).toBe(false);
    expect(isFirmPublicAssetPath('firm-assets/7-old-name/logos/logo.png', 7, 'logos')).toBe(true);
    expect(isFirmPublicAssetPath('firm-assets/7-old-name/signatures/logo.png', 7, 'logos')).toBe(false);
  });
  it('persists the actual upload path and refuses a mismatched tenant, asset type or filename', () => {
    expect(storedUploadRelativePath(7, 'firm-assets', 'logo.png', 'firm-assets/7-name-before-upload/logos/logo.png', 'logos')).toBe('firm-assets/7-name-before-upload/logos/logo.png');
    expect(storedUploadRelativePath(7, 'quotation-attachments', 'file.txt', 'quotation-attachments/7-acme/file.txt')).toBe('quotation-attachments/7-acme/file.txt');
    for (const file of ['firm-assets/8-acme/logos/logo.png', 'firm-assets/7-acme/stamps/logo.png', 'firm-assets/7-acme/logos/other.png']) expect(() => storedUploadRelativePath(7, 'firm-assets', 'logo.png', file, 'logos')).toThrow('Invalid uploaded file path');
  });
  it('embeds named-folder branding in PDFs after a rename and rejects another firm', async () => {
    const read = vi.spyOn(storageService, 'readStorageFile').mockResolvedValue(Buffer.from('logo'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getBrandingFileDataUrl(7, 'logo', 'firm-assets/7-old-name/logos/logo.png')).toBe('data:image/png;base64,bG9nbw==');
    expect(read).toHaveBeenCalledWith('firm-assets/7-old-name/logos/logo.png');
    read.mockClear();
    expect(await getBrandingFileDataUrl(7, 'logo', 'firm-assets/8-acme/logos/logo.png')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it('keeps local bytes, lookup, size and deletion working without calling AWS', async () => {
    const send = vi.fn(); const local = createStorageService(options('local'), { send } as unknown as S3Client);
    await local.writeStorageFile('billing-documents/5/example.pdf', Buffer.from('exact local bytes'));
    expect(await local.readStorageFile('billing-documents/5/example.pdf')).toEqual(Buffer.from('exact local bytes'));
    expect(await local.storageFileSize('billing-documents/5/example.pdf')).toBe(17);
    await local.deleteStorageFile('billing-documents/5/example.pdf');
    await local.deleteStorageFile('billing-documents/5/example.pdf');
    expect(await local.fileExists('billing-documents/5/example.pdf')).toBe(false);
    expect(await local.storageFileSize('billing-documents/5/example.pdf')).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it.each(['../private', 'folder/../../private', '//private', 'folder/.hidden', 'C:\\private', 'folder/./private', 'file\0name'])('rejects unsafe key %s for both providers before any access', async (key) => {
    const { service, send } = remote();
    await expect(service.writeStorageFile(key, 'blocked')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.fileExists(key)).rejects.toMatchObject({ statusCode: 400 });
    await expect(createStorageService(options('local')).writeStorageFile(key, 'blocked')).rejects.toMatchObject({ statusCode: 400 });
    expect(send).not.toHaveBeenCalled();
  });
  it('uploads encrypted provider-independent keys with an expected bucket owner and reads exact bytes', async () => {
    const { service, send } = remote(); send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Body: { transformToByteArray: async () => Buffer.from('cloud bytes') } });
    await service.writeStorageFile('quotation-documents/5/example.pdf', Buffer.from('cloud bytes'));
    expect(send.mock.calls[0]![0].input).toMatchObject({ Bucket: 'qorwell-test', Key: 'development/quotation-documents/5/example.pdf', ExpectedBucketOwner: '429435740649', ServerSideEncryption: 'AES256', ContentType: 'application/pdf' });
    expect(await service.readStorageFile('quotation-documents/5/example.pdf')).toEqual(Buffer.from('cloud bytes'));
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('streams a known-size upload source and leaves no permanent local cloud copy', async () => {
    const source = path.join(root, 'temporary'); await fs.writeFile(source, 'streamed bytes');
    const { service, send } = remote(vi.fn(async (command) => { const chunks = []; for await (const chunk of command.input.Body) chunks.push(chunk); expect(Buffer.concat(chunks).toString()).toBe('streamed bytes'); expect(command.input.ContentLength).toBe(14); return {}; }));
    await service.storeLocalFile('firm-assets/5/items/image.png', source);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(root)).toEqual(['temporary']);
  });
  it('returns missing only for verified absence, without masking permission failures or reading local fallback data', async () => {
    await fs.mkdir(path.join(root, 'billing-documents'), { recursive: true }); await fs.writeFile(path.join(root, 'billing-documents', 'old.pdf'), 'local old bytes');
    const { service, send } = remote();
    send.mockRejectedValueOnce(awsError(404)); expect(await service.fileExists('missing.pdf')).toBe(false);
    send.mockRejectedValueOnce(awsError(404)); expect(await service.storageFileSize('missing.pdf')).toBe(0);
    send.mockRejectedValueOnce(awsError(403)).mockResolvedValueOnce({ Contents: [] }); expect(await service.fileExists('missing.pdf')).toBe(false);
    expect(send.mock.calls.at(-1)![0].input).toMatchObject({ Prefix: 'development/missing.pdf', MaxKeys: 1 });
    send.mockRejectedValueOnce(awsError(403)).mockResolvedValueOnce({ Contents: [{ Key: 'development/exists.pdf' }] }); await expect(service.fileExists('exists.pdf')).rejects.toMatchObject({ statusCode: 503 });
    send.mockRejectedValueOnce(awsError(403)).mockRejectedValueOnce(awsError(403)); await expect(service.fileExists('denied.pdf')).rejects.toMatchObject({ statusCode: 503 });
    send.mockRejectedValueOnce(awsError(500)); await expect(service.readStorageFile('billing-documents/old.pdf')).rejects.toMatchObject({ statusCode: 503 });
  });
  it('does not overwrite an existing local upload destination', async () => {
    const local = createStorageService(options('local')); const source = path.join(root, 'source'); await fs.writeFile(source, 'replacement'); await local.writeStorageFile('items/original.png', 'original');
    await expect(local.storeLocalFile('items/original.png', source)).rejects.toMatchObject({ statusCode: 503 });
    expect((await local.readStorageFile('items/original.png')).toString()).toBe('original');
  });
  it('deletes in the selected bucket/prefix and does not delete a local copy', async () => {
    const { service, send } = remote(); send.mockResolvedValue({}); await fs.writeFile(path.join(root, 'copy.txt'), 'kept');
    await service.deleteStorageFile('copy.txt'); expect(send.mock.calls[0]![0].input).toMatchObject({ Key: 'development/copy.txt' }); expect(await fs.readFile(path.join(root, 'copy.txt'), 'utf8')).toBe('kept');
  });
  it('preserves public image URLs and cache headers while keeping protected folders outside the public middleware', async () => {
    const { service, send } = remote(); send.mockImplementation(async () => ({ Body: Readable.from([Buffer.from('image bytes')]), ContentType: 'image/png', ContentLength: 11, ETag: '"image-version"' }));
    const app = express(); app.use('/storage/firm-assets', service.createPublicAssetStaticMiddleware('firm-assets')); const base = await listen(app);
    const response = await fetch(`${base}/storage/firm-assets/5/logos/logo.png`);
    expect(response.status).toBe(200); expect(await response.text()).toBe('image bytes'); expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin'); expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(send.mock.calls[0]![0].input.Key).toBe('development/firm-assets/5/logos/logo.png');
    expect((await fetch(`${base}/storage/quotation-documents/5/private.pdf`)).status).toBe(404);
    expect((await fetch(`${base}/storage/firm-assets/5/logos/logo.png`, { method: 'POST' })).status).toBe(405);
  });
  it('supports PDF byte ranges with private no-store responses and keeps the download filename', async () => {
    const { service, send } = remote(); send.mockResolvedValue({ Body: Readable.from([Buffer.from('PDF')]), ContentLength: 3, ContentRange: 'bytes 1-3/10' });
    const app = express(); app.get('/file', (_req, res, next) => { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="invoice.pdf"'); void service.sendStorageFile('billing-documents/5/test.pdf', res).catch(next); }); const base = await listen(app);
    const response = await fetch(`${base}/file`, { headers: { Range: 'bytes=1-3' } });
    expect(response.status).toBe(206); expect(await response.text()).toBe('PDF'); expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('content-disposition')).toContain('invoice.pdf'); expect(send.mock.calls[0]![0].input.Range).toBe('bytes=1-3');
  });
});

describe('provider-independent multipart uploads', () => {
  async function upload(bytes: string, limit = 100) {
    const app = express(); const handler = multer({ storage: createManagedUploadStorage({ directory: () => 'quotation-attachments/5', filename: () => 'sample.txt' }), limits: { fileSize: limit } });
    app.post('/upload', handler.single('file'), (req, res) => res.json({ path: req.file?.path, size: req.file?.size }));
    app.use((error: { code?: string; statusCode?: number }, _req: express.Request, res: Response, next: express.NextFunction) => { void next; res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : error.statusCode ?? 503).json({ success: false }); });
    const base = await listen(app); const data = new FormData(); data.append('file', new Blob([bytes], { type: 'text/plain' }), 'sample.txt'); return fetch(`${base}/upload`, { method: 'POST', body: data });
  }
  it('spools, stores exact bytes through the provider and removes the owned temporary file', async () => {
    vi.spyOn(storageService, 'fileExists').mockResolvedValue(false); let spool = '';
    vi.spyOn(storageService, 'storeLocalFile').mockImplementation(async (key, source) => { spool = source; expect(key).toBe('quotation-attachments/5/sample.txt'); expect(await fs.readFile(source, 'utf8')).toBe('exact upload bytes'); });
    const response = await upload('exact upload bytes'); expect(response.status).toBe(200); expect(await response.json()).toEqual({ path: 'quotation-attachments/5/sample.txt', size: 18 }); await expect(fs.stat(spool)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('never persists truncated files and cleans temporary storage on a provider failure', async () => {
    vi.spyOn(storageService, 'fileExists').mockResolvedValue(false); const store = vi.spyOn(storageService, 'storeLocalFile').mockRejectedValue(new Error('Private AWS failure')); const remove = vi.spyOn(storageService, 'deleteStorageFile').mockResolvedValue();
    expect((await upload('too large', 3)).status).toBe(413); expect(store).not.toHaveBeenCalled();
    expect((await upload('within limit')).status).toBe(503); const spool = store.mock.calls[0]![1]; await expect(fs.stat(spool)).rejects.toMatchObject({ code: 'ENOENT' }); expect(remove).toHaveBeenCalledWith('quotation-attachments/5/sample.txt');
  });
  it('does not touch a pre-existing key when rejecting a filename collision', async () => {
    vi.spyOn(storageService, 'fileExists').mockResolvedValue(true); const store = vi.spyOn(storageService, 'storeLocalFile'); const remove = vi.spyOn(storageService, 'deleteStorageFile'); expect((await upload('new bytes')).status).toBe(409); expect(store).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
});
