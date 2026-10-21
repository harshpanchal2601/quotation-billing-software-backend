import path from 'node:path';

export const storageConfig = {
  root: path.resolve(process.cwd(), 'storage'),
  publicAssetDirectories: ['items', 'logos', 'signatures', 'stamps'] as const,
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
