import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';

import { AppError } from '../../core/errors/AppError.js';

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
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

export const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
export const ATTACHMENT_STORAGE_DIR = path.resolve(STORAGE_ROOT, 'quotation-attachments');

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

  // Handle jpeg/jpg variant mapping
  const matchesExt = ext === expectedExt || (expectedExt === '.jpg' && ext === '.jpeg') || (expectedExt === '.jpeg' && ext === '.jpg');
  if (!matchesExt) {
    return new AppError('File extension does not match MIME type.', 415);
  }

  return null;
}

export const uploadQuotationAttachment = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, callback) => {
      try {
        await fs.mkdir(ATTACHMENT_STORAGE_DIR, { recursive: true });
        callback(null, ATTACHMENT_STORAGE_DIR);
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
