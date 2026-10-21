import path from 'node:path';

export const storageConfig = {
  root: path.resolve(process.cwd(), 'storage'),
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

export function firmPublicAssetDirectory(firmId: number, assetDirectory: string) {
  return `${storageConfig.firmAssetDirectory}/${firmId}/${assetDirectory}`;
}

export function firmProtectedDirectory(baseDirectory: string, firmId: number) {
  return `${baseDirectory}/${firmId}`;
}
