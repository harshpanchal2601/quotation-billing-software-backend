import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';

import { firmProtectedDirectory, storageConfig } from '../../../config/storage.config.js';
import { AppError } from '../../../core/errors/AppError.js';
import { asyncHandler } from '../../../core/http/asyncHandler.js';
import { getFirmId } from '../../../core/tenancy/tenant-context.js';
import { renderAndStorePdf } from '../../../integrations/documents/index.js';
import { storageService } from '../../../integrations/storage/index.js';
import { requireAuthentication, requirePermission } from '../../auth/auth.middleware.js';
import { PERMISSIONS } from '../../auth/permissions.js';
import {
  getBusinessProfileRecordForQuotation,
  getDefaultBankDetailRecordForQuotation,
} from '../../settings/index.js';
import {
  buildQuotationPdfViewModel,
  getBrandingFileDataUrl,
  quotationDocumentsRepository,
} from './quotation-documents.repository.js';
import { renderQuotationHtmlTemplate } from './quotation-document.template.js';
import type { GeneratedDocumentDto } from './quotation-documents.types.js';

export const quotationDocumentsRouter = Router({ mergeParams: true });

quotationDocumentsRouter.use(requireAuthentication);

quotationDocumentsRouter.post(
  '/:id/pdf',
  requirePermission(PERMISSIONS.QUOTATIONS_DOCUMENTS),
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = Number(req.params.id);
    if (!Number.isInteger(quotationId) || quotationId <= 0) {
      throw new AppError('Invalid quotation ID', 400);
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const firmId = getFirmId(req);
    const quotation = await quotationDocumentsRepository.findQuotationForPdf(firmId, quotationId);
    if (!quotation) {
      throw new AppError('Quotation not found', 404);
    }

    const businessProfile = await getBusinessProfileRecordForQuotation(firmId);
    const fallbackBank = await getDefaultBankDetailRecordForQuotation(firmId);

    const [logoDataUrl, signatureDataUrl, stampDataUrl] = await Promise.all([
      getBrandingFileDataUrl(firmId, 'logo', businessProfile?.logoPath),
      getBrandingFileDataUrl(firmId, 'signature', businessProfile?.signaturePath),
      getBrandingFileDataUrl(firmId, 'stamp', businessProfile?.stampPath),
    ]);

    const viewModel = buildQuotationPdfViewModel(
      quotation,
      businessProfile,
      fallbackBank,
      { logoDataUrl, signatureDataUrl, stampDataUrl },
    );

    const html = renderQuotationHtmlTemplate(viewModel);

    const fileUuid = crypto.randomUUID();
    const filename = `${fileUuid}.pdf`;
    const relativeFilePath = `${firmProtectedDirectory(storageConfig.quotationDocumentDirectory, firmId)}/${filename}`;

    const rendered = await renderAndStorePdf(html, relativeFilePath);

    let generatedDoc;
    try {
      generatedDoc = await quotationDocumentsRepository.createGeneratedDocument({
        firmId,
        quotationId: quotation.id,
        fileSize: rendered.fileSize,
        filePath: relativeFilePath,
        fileHash: rendered.fileHash,
        generatedById: userId,
      });
    } catch (error) {
      await storageService.deleteStorageFile(relativeFilePath).catch(() => {});
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to record generated document metadata', 500);
    }

    await quotationDocumentsRepository.recordGeneratedDocumentAudit(
      {
        userId,
        documentId: generatedDoc.id,
        quotationId: quotation.id,
        quotationNumber: quotation.quotationNumber,
        revisionNumber: quotation.revisionNumber,
        fileSize: rendered.fileSize,
      },
      {
        userId,
        firmId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      },
    );

    const previewUrl = `/api/v1/quotations/${quotation.id}/pdf/${generatedDoc.id}/preview`;
    const downloadUrl = `/api/v1/quotations/${quotation.id}/pdf/${generatedDoc.id}/download`;

    const document: GeneratedDocumentDto = {
      id: generatedDoc.id,
      quotationId: generatedDoc.quotationId,
      versionNumber: generatedDoc.versionNumber,
      documentType: generatedDoc.documentType,
      filePath: generatedDoc.filePath,
      fileHash: generatedDoc.fileHash,
      generatedById: generatedDoc.generatedById,
      generatedAt: generatedDoc.generatedAt.toISOString(),
    };

    res.status(201).json({
      status: 'success',
      data: { document, previewUrl, downloadUrl },
    });
  }),
);

async function streamPdfDocument(req: Request, res: Response, disposition: 'inline' | 'attachment') {
  const quotationId = Number(req.params.id);
  const documentId = Number(req.params.documentId);

  if (!Number.isInteger(quotationId) || quotationId <= 0) {
    throw new AppError('Invalid quotation ID', 400);
  }
  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new AppError('Invalid document ID', 400);
  }

  const doc = await quotationDocumentsRepository.findDocumentForQuotation(getFirmId(req), quotationId, documentId);
  if (!doc || !doc.quotation || doc.quotation.deletedAt) {
    throw new AppError('Generated document not found for this quotation', 404);
  }

  const absolutePath = quotationDocumentsRepository.resolveDocumentAbsolutePath(doc.filePath);
  const exists = await quotationDocumentsRepository.documentFileExists(doc.filePath);
  if (!exists) {
    throw new AppError('PDF file not found on storage disk', 404);
  }

  const safeQuotationNum = doc.quotation.quotationNumber.replace(/[^a-zA-Z0-9_-]/g, '-');
  const downloadFilename = `Quotation-${safeQuotationNum}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${downloadFilename}"`);

  const fileStream = fs.createReadStream(absolutePath);
  fileStream.pipe(res);
}

quotationDocumentsRouter.get('/:id/pdf/:documentId/preview', requirePermission(PERMISSIONS.QUOTATIONS_DOCUMENTS), asyncHandler(async (req, res) => {
  await streamPdfDocument(req, res, 'inline');
}));

quotationDocumentsRouter.get('/:id/pdf/:documentId/download', requirePermission(PERMISSIONS.QUOTATIONS_DOCUMENTS), asyncHandler(async (req, res) => {
  await streamPdfDocument(req, res, 'attachment');
}));
