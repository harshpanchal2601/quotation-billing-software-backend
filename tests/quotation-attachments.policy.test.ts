import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { storageConfig } from '../src/config/storage.config';
import {
  getAttachmentStorageDirectory,
  getFileCategory,
  MAX_ATTACHMENTS_PER_QUOTATION,
  MAX_FILE_SIZE_BYTES,
  PREVIEWABLE_MIME_TYPES,
  resolveAttachmentRelativePath,
  validateAttachmentFile,
} from '../src/modules/quotations/attachments/quotation-attachment.policy';

describe('Quotation Attachment Security and Storage Validation', () => {
  it('allows valid document and image types', () => {
    const validPdfFile = { originalname: 'document.pdf', mimetype: 'application/pdf' } as Express.Multer.File;
    const validPngFile = { originalname: 'image.png', mimetype: 'image/png' } as Express.Multer.File;
    const validDocxFile = {
      originalname: 'report.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    } as Express.Multer.File;

    expect(validateAttachmentFile(validPdfFile)).toBeNull();
    expect(validateAttachmentFile(validPngFile)).toBeNull();
    expect(validateAttachmentFile(validDocxFile)).toBeNull();
  });

  it('rejects forbidden file types (HTML, JS, SVG, Executables)', () => {
    const htmlFile = { originalname: 'evil.html', mimetype: 'text/html' } as Express.Multer.File;
    const jsFile = { originalname: 'script.js', mimetype: 'application/javascript' } as Express.Multer.File;
    const svgFile = { originalname: 'vector.svg', mimetype: 'image/svg+xml' } as Express.Multer.File;
    const exeFile = { originalname: 'virus.exe', mimetype: 'application/x-msdownload' } as Express.Multer.File;

    expect(validateAttachmentFile(htmlFile)?.statusCode).toBe(415);
    expect(validateAttachmentFile(jsFile)?.statusCode).toBe(415);
    expect(validateAttachmentFile(svgFile)?.statusCode).toBe(415);
    expect(validateAttachmentFile(exeFile)?.statusCode).toBe(415);
  });

  it('rejects files where extension does not match MIME type', () => {
    const spoofedFile = { originalname: 'script.png', mimetype: 'application/pdf' } as Express.Multer.File;
    expect(validateAttachmentFile(spoofedFile)?.statusCode).toBe(415);
  });

  it('correctly identifies previewable MIME types', () => {
    expect(PREVIEWABLE_MIME_TYPES.has('application/pdf')).toBe(true);
    expect(PREVIEWABLE_MIME_TYPES.has('image/png')).toBe(true);
    expect(PREVIEWABLE_MIME_TYPES.has('text/plain')).toBe(true);
    expect(PREVIEWABLE_MIME_TYPES.has('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false);
    expect(PREVIEWABLE_MIME_TYPES.has('text/csv')).toBe(false);
  });

  it('correctly maps file categories', () => {
    expect(getFileCategory('application/pdf')).toBe('PDF');
    expect(getFileCategory('image/jpeg')).toBe('Image');
    expect(getFileCategory('text/plain')).toBe('Text');
    expect(getFileCategory('text/csv')).toBe('CSV');
    expect(getFileCategory('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('Word document');
    expect(getFileCategory('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('Spreadsheet');
  });

  it('enforces maximum limits parameters', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_ATTACHMENTS_PER_QUOTATION).toBe(20);
  });

  it('confines attachment storage paths to approved directory', () => {
    const attachmentStorageDir = getAttachmentStorageDirectory();
    const validRelative = 'storage/quotation-attachments/5db19d45-3a55-48d2-a683-86f62c1a37b1.pdf';
    const fullPath = path.resolve(storageConfig.root, validRelative.replace(/^\/?storage\//, ''));
    expect(fullPath.startsWith(attachmentStorageDir)).toBe(true);

    const maliciousRelative = 'storage/quotation-attachments/../../etc/passwd';
    const maliciousFullPath = path.resolve(storageConfig.root, maliciousRelative.replace(/^\/?storage\//, ''));
    expect(maliciousFullPath.startsWith(attachmentStorageDir)).toBe(false);
  });

  it('stores attachment paths within the selected firm directory', () => {
    const storedFilename = '5db19d45-3a55-48d2-a683-86f62c1a37b1.pdf';

    expect(resolveAttachmentRelativePath(7, storedFilename)).toBe(
      `storage/quotation-attachments/7/${storedFilename}`,
    );
    expect(getAttachmentStorageDirectory(7)).toMatch(/storage[/\\]quotation-attachments[/\\]7$/);
  });
});
