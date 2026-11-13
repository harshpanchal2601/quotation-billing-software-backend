import path from 'node:path';
import { env } from './env.js';

// Select one persistent provider at startup; restart after changing the environment.
export const storageConfig = {
  driver: env.STORAGE_DRIVER,
  root: path.resolve(process.cwd(), env.STORAGE_LOCAL_ROOT),
  bucket: env.STORAGE_S3_BUCKET,
  region: env.STORAGE_S3_REGION,
  prefix: env.STORAGE_S3_PREFIX.replace(/\/$/, ''),
  expectedBucketOwner: env.STORAGE_S3_EXPECTED_BUCKET_OWNER || undefined,
  publicAssetDirectories: ['items', 'logos', 'signatures', 'stamps', 'firm-assets'] as const,
  firmAssetDirectory: 'firm-assets',
  itemImageDirectory: 'items',
  brandingDirectories: {
    logo: 'logos',
    signature: 'signatures',
    stamp: 'stamps',
  } as const,
  quotationAttachmentDirectory: 'quotation-attachments',
  quotationDocumentDirectory: 'quotation-documents',
  quotationsDirectory: 'quotations',
  attachmentsDirectory: 'attachments',
} as const;

// The numeric ID remains the tenant identity. The name is a readable snapshot,
// so renaming a firm never changes a file's previously persisted path.
export function firmStorageFolder(firmId: number, firmName?: string) {
  if (!Number.isSafeInteger(firmId) || firmId <= 0) throw new Error('Invalid storage firm ID');
  if (firmName === undefined) return String(firmId);
  const name = Array.from(firmName.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '-'))
    .slice(0, 40).join('').replace(/^-+|-+$/g, '') || 'firm';
  return `${firmId}-${name}`;
}

export function firmPublicAssetDirectory(firmId: number, assetDirectory: string, firmName?: string) {
  return `${storageConfig.firmAssetDirectory}/${firmStorageFolder(firmId, firmName)}/${assetDirectory}`;
}

export function firmProtectedDirectory(baseDirectory: string, firmId: number, firmName?: string) {
  return `${baseDirectory}/${firmStorageFolder(firmId, firmName)}`;
}

// Accept historical numeric folders and named folders, without depending on a
// firm's current name. This check supplements database ownership authorization.
export function isFirmStoragePath(relativePath: string, baseDirectory: string, firmId: number) {
  if (!Number.isSafeInteger(firmId) || firmId <= 0) return false;
  const parts = relativePath.split('/');
  if (parts.length < 3 || parts.some((part) => !part || part.startsWith('.') || part.includes('\\') || part.includes('\0'))) return false;
  const folder = parts[1]!;
  return parts[0] === baseDirectory && (folder === String(firmId) ||
    folder.startsWith(`${firmId}-`) && /^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u.test(folder.slice(String(firmId).length + 1)));
}

export function isFirmPublicAssetPath(relativePath: string, firmId: number, assetDirectory: string) {
  return isFirmStoragePath(relativePath, storageConfig.firmAssetDirectory, firmId) &&
    relativePath.split('/')[2] === assetDirectory && relativePath.split('/').length === 4;
}
