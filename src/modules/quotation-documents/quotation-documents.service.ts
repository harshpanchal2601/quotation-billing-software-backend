import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AuditAction, DocumentType } from '@prisma/client';

import { prisma } from '../../config/database.js';
import { AppError } from '../../utils/AppError.js';
import { generatePdfBufferFromHtml } from './quotation-pdf.service.js';
import { renderQuotationHtmlTemplate } from './quotation-pdf-template.js';
import type { GeneratedDocumentDto, QuotationPdfViewModel } from './quotation-documents.types.js';

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
const PDF_STORAGE_DIR = path.resolve(STORAGE_ROOT, 'quotation-documents');

async function ensureStorageDirExists(): Promise<void> {
  await fs.mkdir(PDF_STORAGE_DIR, { recursive: true });
}

async function getFileDataUrl(relativePath: string | null | undefined): Promise<string | null> {
  if (!relativePath) return null;
  try {
    const fullPath = path.resolve(STORAGE_ROOT, relativePath.replace(/^\/?storage\//, ''));
    const fileBuffer = await fs.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/webp';
    return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function generateQuotationPdfService(
  quotationId: number,
  userId: number,
): Promise<{ document: GeneratedDocumentDto; previewUrl: string; downloadUrl: string }> {
  // 1. Fetch saved quotation with items
  const quotation = await prisma.quotation.findFirst({
    where: { id: quotationId, deletedAt: null },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!quotation) {
    throw new AppError('Quotation not found', 404);
  }

  // 2. Fetch business profile & bank details
  const businessProfile = await prisma.businessProfile.findFirst();
  const defaultBank = await prisma.bankDetail.findFirst({
    where: { deletedAt: null, isDefault: true },
  });
  const fallbackBank = defaultBank || (await prisma.bankDetail.findFirst({ where: { deletedAt: null } }));

  // Convert branding images to base64 data URLs for local Puppeteer resolution
  const logoDataUrl = await getFileDataUrl(businessProfile?.logoPath);
  const signatureDataUrl = await getFileDataUrl(businessProfile?.signaturePath);
  const stampDataUrl = await getFileDataUrl(businessProfile?.stampPath);

  // 3. Build view model using ONLY saved quotation snapshots and saved authoritative calculations
  const viewModel: QuotationPdfViewModel = {
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
    items: quotation.items.map((item: (typeof quotation.items)[number]) => ({
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
          logoDataUrl,
          signatureDataUrl,
          stampDataUrl,
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

  // 4. Render HTML and generate PDF buffer
  const html = renderQuotationHtmlTemplate(viewModel);
  const pdfBuffer = await generatePdfBufferFromHtml(html);

  // 5. Save PDF file to storage directory
  await ensureStorageDirExists();
  const fileUuid = crypto.randomUUID();
  const filename = `${fileUuid}.pdf`;
  const relativeFilePath = `quotation-documents/${filename}`;
  const fullFilePath = path.resolve(PDF_STORAGE_DIR, filename);

  try {
    await fs.writeFile(fullFilePath, pdfBuffer);
  } catch {
    throw new AppError('Failed to save PDF file to disk', 500);
  }

  // Calculate SHA256 file hash
  const fileHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  // 6. Record GeneratedDocument in database
  let generatedDoc;
  try {
    generatedDoc = await prisma.generatedDocument.create({
      data: {
        quotationId: quotation.id,
        versionNumber: quotation.revisionNumber,
        documentType: DocumentType.QUOTATION_PDF,
        filePath: relativeFilePath,
        fileHash,
        generatedById: userId,
      },
    });
  } catch {
    // Cleanup generated file if DB record creation fails
    await fs.unlink(fullFilePath).catch(() => {});
    throw new AppError('Failed to record generated document metadata', 500);
  }

  // 7. Audit log
  await prisma.auditLog
    .create({
      data: {
        userId,
        entityType: 'Quotation',
        entityId: quotation.id.toString(),
        action: AuditAction.GENERATE_PDF,
        newValues: {
          documentId: generatedDoc.id,
          quotationNumber: quotation.quotationNumber,
          revisionNumber: quotation.revisionNumber,
          fileSize: pdfBuffer.length,
        },
      },
    })
    .catch(() => {});

  const previewUrl = `/api/v1/quotations/${quotation.id}/pdf/${generatedDoc.id}/preview`;
  const downloadUrl = `/api/v1/quotations/${quotation.id}/pdf/${generatedDoc.id}/download`;

  return {
    document: {
      id: generatedDoc.id,
      quotationId: generatedDoc.quotationId,
      versionNumber: generatedDoc.versionNumber,
      documentType: generatedDoc.documentType,
      filePath: generatedDoc.filePath,
      fileHash: generatedDoc.fileHash,
      generatedById: generatedDoc.generatedById,
      generatedAt: generatedDoc.generatedAt.toISOString(),
    },
    previewUrl,
    downloadUrl,
  };
}

export async function getQuotationPdfDocumentService(
  quotationId: number,
  documentId: number,
): Promise<{ absolutePath: string; downloadFilename: string }> {
  // 1. Fetch document and quotation
  const doc = await prisma.generatedDocument.findFirst({
    where: { id: documentId, quotationId },
    include: { quotation: true },
  });

  if (!doc || !doc.quotation || doc.quotation.deletedAt) {
    throw new AppError('Generated document not found for this quotation', 404);
  }

  // 2. Resolve absolute file path
  const absolutePath = path.resolve(STORAGE_ROOT, doc.filePath);

  try {
    await fs.access(absolutePath);
  } catch {
    throw new AppError('PDF file not found on storage disk', 404);
  }

  // Format safe download filename based on quotation number
  const safeQuotationNum = doc.quotation.quotationNumber.replace(/[^a-zA-Z0-9_-]/g, '-');
  const downloadFilename = `Quotation-${safeQuotationNum}.pdf`;

  return { absolutePath, downloadFilename };
}
