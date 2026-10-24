import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';

import { firmProtectedDirectory, storageConfig } from '../../../config/storage.config.js';
import { AppError } from '../../../core/errors/AppError.js';
import { storageService } from '../../../integrations/storage/index.js';

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_QUOTATION = 20;

export const ALLOWED_MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

export const PREVIEWABLE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
]);

export function getAttachmentStorageDirectory(firmId?: number) {
  const directory = firmId === undefined
    ? storageConfig.quotationAttachmentDirectory
    : firmProtectedDirectory(storageConfig.quotationAttachmentDirectory, firmId);
  return storageService.resolveStoragePath(directory);
}

export function getFileCategory(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.startsWith('image/')) return 'Image';
  if (mimeType === 'text/plain') return 'Text';
  if (mimeType === 'text/csv') return 'CSV';
  if (mimeType.includes('wordprocessingml')) return 'Word document';
  if (mimeType.includes('spreadsheetml')) return 'Spreadsheet';
  if (mimeType.includes('presentationml')) return 'Presentation';
  return 'Document';
}

export function validateAttachmentFile(file: Express.Multer.File): AppError | null {
  const ext = path.extname(file.originalname).toLowerCase();
  const mimeType = file.mimetype;

  const expectedExt = ALLOWED_MIME_EXTENSIONS[mimeType];
  if (!expectedExt) {
    return new AppError('Unsupported file type. Executable, script, HTML, and SVG files are not allowed.', 415);
  }

  const matchesExt =
    ext === expectedExt ||
    (expectedExt === '.jpg' && ext === '.jpeg') ||
    (expectedExt === '.jpeg' && ext === '.jpg');
  if (!matchesExt) {
    return new AppError('File extension does not match MIME type.', 415);
  }

  return null;
}

export const uploadQuotationAttachment = multer({
  storage: multer.diskStorage({
    destination: async (req, _file, callback) => {
      try {
        if (req.firmId === undefined) {
          callback(new AppError('Firm context is required', 500), '');
          return;
        }
        const directory = firmProtectedDirectory(storageConfig.quotationAttachmentDirectory, req.firmId);
        await storageService.ensureStorageDirectory(directory);
        callback(null, getAttachmentStorageDirectory(req.firmId));
      } catch (error) {
        callback(error as Error, '');
      }
    },
    filename: (_req, file, callback) => {
      const mimeType = file.mimetype;
      const extension = ALLOWED_MIME_EXTENSIONS[mimeType] || path.extname(file.originalname).toLowerCase();
      const storedFilename = `${crypto.randomUUID()}${extension}`;
      callback(null, storedFilename);
    },
  }),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    const error = validateAttachmentFile(file);
    if (error) {
      callback(error);
    } else {
      callback(null, true);
    }
  },
});

export function resolveAttachmentRelativePath(firmId: number, storedFilename: string) {
  return `storage/${firmProtectedDirectory(storageConfig.quotationAttachmentDirectory, firmId)}/${storedFilename}`;
}

export function resolveAttachmentAbsolutePath(relativePath: string) {
  const normalised = relativePath.replace(/^\/?storage\//, '');
  const absolutePath = storageService.resolveStoragePath(normalised);
  const attachmentRoot = getAttachmentStorageDirectory();
  const relativeToAttachments = path.relative(attachmentRoot, absolutePath);
  if (relativeToAttachments === '' || relativeToAttachments === '..' ||
      relativeToAttachments.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToAttachments)) {
    throw new AppError('Invalid attachment path', 403);
  }
  return absolutePath;
}

export function sanitiseAttachmentFilename(filename: string): string {
  return filename.replace(/["\r\n/\\]/g, '_');
}
