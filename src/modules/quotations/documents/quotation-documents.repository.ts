import path from 'node:path';

import { AuditAction, DocumentType, type PrismaClient } from '@prisma/client';

import { prisma } from '../../../core/database/prisma.js';
import { storageConfig } from '../../../config/storage.config.js';
import { createAuditLog, type RequestMetadata } from '../../../core/audit/audit-log.service.js';
import {
  brandingAssetConfig,
  resolveBrandingPath,
  type BrandingAssetType,
} from '../../settings/index.js';
import { storageService } from '../../../integrations/storage/index.js';
import type { QuotationPdfViewModel } from './quotation-documents.types.js';

export async function getBrandingFileDataUrl(
  assetType: BrandingAssetType,
  relativePath: string | null | undefined,
): Promise<string | null> {
  if (!relativePath) return null;

  try {
    const normalizedPath = relativePath.replace(/^\/?storage\//, '');
    const expectedDirectory = brandingAssetConfig[assetType].directory;
    const relativeDirectory = normalizedPath.split(/[\\/]/)[0];

    if (relativeDirectory !== expectedDirectory) {
      console.warn(`Configured ${assetType} branding asset is outside its storage area.`);
      return null;
    }

    const fullPath = resolveBrandingPath(normalizedPath);
    const fileBuffer = await storageService.readStorageFile(
      path.relative(storageConfig.root, fullPath).replace(/\\/g, '/'),
    );
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/webp';
    return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code !== 'ENOENT') {
      console.warn(`Configured ${assetType} branding asset could not be loaded for PDF generation.`);
    }
    return null;
  }
}

export function buildQuotationPdfViewModel(
  quotation: {
    quotationNumber: string;
    revisionNumber: number;
    quotationDate: Date;
    validUntil: Date | null;
    status: string;
    currency: string;
    taxMode: string;
    companyNameSnapshot: string;
    companyGstinSnapshot: string | null;
    companyPanSnapshot: string | null;
    contactNameSnapshot: string | null;
    contactEmailSnapshot: string | null;
    contactPhoneSnapshot: string | null;
    billingAddressSnapshot: unknown;
    shippingAddressSnapshot: unknown;
    subtotal: { toString(): string };
    itemDiscountAmount: { toString(): string };
    quotationDiscountType: string;
    quotationDiscountValue: { toString(): string };
    quotationDiscountAmount: { toString(): string };
    taxableAmount: { toString(): string };
    cgstAmount: { toString(): string };
    sgstAmount: { toString(): string };
    igstAmount: { toString(): string };
    freightAmount: { toString(): string };
    otherCharges: { toString(): string };
    roundOffAmount: { toString(): string };
    grandTotal: { toString(): string };
    amountInWords: string | null;
    deliveryTerms: string | null;
    dispatchTerms: string | null;
    paymentTerms: string | null;
    taxTerms: string | null;
    freightTerms: string | null;
    warrantyTerms: string | null;
    remarks: string | null;
    termsAndConditions: string | null;
    items: Array<{
      lineNumber: number;
      itemCodeSnapshot: string | null;
      itemNameSnapshot: string;
      descriptionSnapshot: string | null;
      measurementUnitSnapshot: string;
      quantity: { toString(): string };
      unitRate: { toString(): string };
      discountType: string;
      discountValue: { toString(): string };
      discountAmount: { toString(): string };
      taxableAmount: { toString(): string };
      gstRate: { toString(): string };
      taxAmount: { toString(): string };
      lineTotal: { toString(): string };
    }>;
  },
  businessProfile: {
    legalName: string;
    displayName: string;
    gstin: string | null;
    pan: string | null;
    cin: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    primaryPhone: string | null;
    primaryEmail: string | null;
    website: string | null;
    logoPath: string | null;
    signaturePath: string | null;
    stampPath: string | null;
    primaryColour: string;
    secondaryColour: string;
  } | null,
  fallbackBank: {
    bankName: string;
    accountName: string;
    accountNumber: string;
    ifscCode: string | null;
    branchName: string | null;
    swiftCode: string | null;
  } | null,
  branding: {
    logoDataUrl: string | null;
    signatureDataUrl: string | null;
    stampDataUrl: string | null;
  },
): QuotationPdfViewModel {
  return {
    quotationNumber: quotation.quotationNumber,
    revisionNumber: quotation.revisionNumber,
    quotationDate: quotation.quotationDate.toISOString(),
    validUntil: quotation.validUntil ? quotation.validUntil.toISOString() : null,
    status: quotation.status,
    currency: quotation.currency,
    taxMode: quotation.taxMode,
    companyNameSnapshot: quotation.companyNameSnapshot,
    companyGstinSnapshot: quotation.companyGstinSnapshot,
    companyPanSnapshot: quotation.companyPanSnapshot,
    contactNameSnapshot: quotation.contactNameSnapshot,
    contactEmailSnapshot: quotation.contactEmailSnapshot,
    contactPhoneSnapshot: quotation.contactPhoneSnapshot,
    billingAddressSnapshot: quotation.billingAddressSnapshot as QuotationPdfViewModel['billingAddressSnapshot'],
    shippingAddressSnapshot: quotation.shippingAddressSnapshot as QuotationPdfViewModel['shippingAddressSnapshot'],
    subtotal: quotation.subtotal.toString(),
    itemDiscountAmount: quotation.itemDiscountAmount.toString(),
    quotationDiscountType: quotation.quotationDiscountType,
    quotationDiscountValue: quotation.quotationDiscountValue.toString(),
    quotationDiscountAmount: quotation.quotationDiscountAmount.toString(),
    taxableAmount: quotation.taxableAmount.toString(),
    cgstAmount: quotation.cgstAmount.toString(),
    sgstAmount: quotation.sgstAmount.toString(),
    igstAmount: quotation.igstAmount.toString(),
    freightAmount: quotation.freightAmount.toString(),
    otherCharges: quotation.otherCharges.toString(),
    roundOffAmount: quotation.roundOffAmount.toString(),
    grandTotal: quotation.grandTotal.toString(),
    amountInWords: quotation.amountInWords,
    deliveryTerms: quotation.deliveryTerms,
    dispatchTerms: quotation.dispatchTerms,
    paymentTerms: quotation.paymentTerms,
    taxTerms: quotation.taxTerms,
    freightTerms: quotation.freightTerms,
    warrantyTerms: quotation.warrantyTerms,
    remarks: quotation.remarks,
    termsAndConditions: quotation.termsAndConditions,
    items: quotation.items.map((item) => ({
      lineNumber: item.lineNumber,
      itemCodeSnapshot: item.itemCodeSnapshot,
      itemNameSnapshot: item.itemNameSnapshot,
      descriptionSnapshot: item.descriptionSnapshot,
      measurementUnitSnapshot: item.measurementUnitSnapshot,
      quantity: item.quantity.toString(),
      unitRate: item.unitRate.toString(),
      discountType: item.discountType,
      discountValue: item.discountValue.toString(),
      discountAmount: item.discountAmount.toString(),
      taxableAmount: item.taxableAmount.toString(),
      gstRate: item.gstRate.toString(),
      taxAmount: item.taxAmount.toString(),
      lineTotal: item.lineTotal.toString(),
    })),
    businessProfile: businessProfile
      ? {
          legalName: businessProfile.legalName,
          displayName: businessProfile.displayName,
          gstin: businessProfile.gstin,
          pan: businessProfile.pan,
          cin: businessProfile.cin,
          addressLine1: businessProfile.addressLine1,
          addressLine2: businessProfile.addressLine2,
          city: businessProfile.city,
          state: businessProfile.state,
          postalCode: businessProfile.postalCode,
          country: businessProfile.country,
          primaryPhone: businessProfile.primaryPhone,
          primaryEmail: businessProfile.primaryEmail,
          website: businessProfile.website,
          logoDataUrl: branding.logoDataUrl,
          signatureDataUrl: branding.signatureDataUrl,
          stampDataUrl: branding.stampDataUrl,
          primaryColour: businessProfile.primaryColour,
          secondaryColour: businessProfile.secondaryColour,
        }
      : null,
    bankDetail: fallbackBank
      ? {
          bankName: fallbackBank.bankName,
          accountName: fallbackBank.accountName,
          accountNumber: fallbackBank.accountNumber,
          ifscCode: fallbackBank.ifscCode,
          branchName: fallbackBank.branchName,
          swiftCode: fallbackBank.swiftCode,
        }
      : null,
  };
}

export class QuotationDocumentsRepository {
  constructor(private readonly db: PrismaClient) {}

  async findQuotationForPdf(quotationId: number) {
    return this.db.quotation.findFirst({
      where: { id: quotationId, deletedAt: null },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  async getNextDocumentVersionNumber(quotationId: number) {
    const count = await this.db.generatedDocument.count({
      where: {
        quotationId,
        documentType: DocumentType.QUOTATION_PDF,
      },
    });
    return count + 1;
  }

  async createGeneratedDocument(data: {
    quotationId: number;
    versionNumber: number;
    filePath: string;
    fileHash: string;
    generatedById: number;
  }) {
    return this.db.generatedDocument.create({
      data: {
        quotationId: data.quotationId,
        versionNumber: data.versionNumber,
        documentType: DocumentType.QUOTATION_PDF,
        filePath: data.filePath,
        fileHash: data.fileHash,
        generatedById: data.generatedById,
      },
    });
  }

  async recordGeneratedDocumentAudit(
    input: {
      userId: number;
      documentId: number;
      quotationId: number;
      quotationNumber: string;
      revisionNumber: number;
      fileSize: number;
    },
    metadata: RequestMetadata,
  ) {
    await createAuditLog(this.db, {
      metadata: { ...metadata, userId: input.userId },
      entityType: 'Quotation',
      entityId: input.quotationId.toString(),
      action: AuditAction.GENERATE_PDF,
      newValues: {
        documentId: input.documentId,
        quotationNumber: input.quotationNumber,
        revisionNumber: input.revisionNumber,
        fileSize: input.fileSize,
      },
    });
  }

  async findDocumentForQuotation(quotationId: number, documentId: number) {
    return this.db.generatedDocument.findFirst({
      where: { id: documentId, quotationId },
      include: { quotation: true },
    });
  }

  async listDocumentHistory(
    quotationId: number,
    query: { page: number; limit: number; sortOrder: 'asc' | 'desc' },
  ) {
    const { page, limit, sortOrder } = query;
    const skip = (page - 1) * limit;

    const [total, documents] = await Promise.all([
      this.db.generatedDocument.count({ where: { quotationId } }),
      this.db.generatedDocument.findMany({
        where: { quotationId },
        orderBy: { generatedAt: sortOrder },
        skip,
        take: limit,
        include: {
          generatedBy: { select: { id: true, name: true } },
        },
      }),
    ]);

    return { total, documents, page, limit };
  }

  resolveDocumentAbsolutePath(relativeFilePath: string) {
    const normalised = relativeFilePath.replace(/^\/?storage\//, '');
    return storageService.resolveStoragePath(normalised);
  }

  async documentFileExists(relativeFilePath: string) {
    const normalised = relativeFilePath.replace(/^\/?storage\//, '');
    return storageService.fileExists(normalised);
  }
}

export const quotationDocumentsRepository = new QuotationDocumentsRepository(prisma);
