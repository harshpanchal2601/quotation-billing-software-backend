import { createHash } from 'node:crypto';
import { pdfService } from '../pdf/index.js';
import { storageService } from '../storage/index.js';

// Callers own templates, access checks, tenant paths and document history.
// This boundary only composes the existing rendering and storage providers.
export async function renderAndStorePdf(html: string, filePath: string) {
  const buffer = await pdfService.generateBufferFromHtml(html);
  try {
    await storageService.writeStorageFile(filePath, buffer);
  } catch (error) {
    await storageService.deleteStorageFile(filePath).catch(() => {});
    throw error;
  }
  return { filePath, fileSize: buffer.length, fileHash: createHash('sha256').update(buffer).digest('hex') };
}
