import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router, type Request, type Response } from 'express';

import { storageConfig } from '../../../config/storage.config.js';
import { AppError } from '../../../core/errors/AppError.js';
import { asyncHandler } from '../../../core/http/asyncHandler.js';
import { pdfService } from '../../../integrations/pdf/index.js';
import { storageService } from '../../../integrations/storage/index.js';
import { requireAuthentication, requireRole } from '../../auth/auth.middleware.js';
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
quotationDocumentsRouter.use(requireRole('ADMIN'));

quotationDocumentsRouter.post(
  '/:id/pdf',
  asyncHandler(async (req: Request, res: Response) => {
    const quotationId = Number(req.params.id);
    if (!Number.isInteger(quotationId) || quotationId <= 0) {
      throw new AppError('Invalid quotation ID', 400);
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new AppError('Authentication required', 401);
    }

    const quotation = await quotationDocumentsRepository.findQuotationForPdf(quotationId);
    if (!quotation) {
      throw new AppError('Quotation not found', 404);
    }

    const businessProfile = await getBusinessProfileRecordForQuotation();
    const fallbackBank = await getDefaultBankDetailRecordForQuotation();

    const [logoDataUrl, signatureDataUrl, stampDataUrl] = await Promise.all([
      getBrandingFileDataUrl('logo', businessProfile?.logoPath),
      getBrandingFileDataUrl('signature', businessProfile?.signaturePath),
      getBrandingFileDataUrl('stamp', businessProfile?.stampPath),
    ]);

    const viewModel = buildQuotationPdfViewModel(
      quotation,
      businessProfile,
      fallbackBank,
      { logoDataUrl, signatureDataUrl, stampDataUrl },
    );

    const html = renderQuotationHtmlTemplate(viewModel);
    const pdfBuffer = await pdfService.generateBufferFromHtml(html);

    const fileUuid = crypto.randomUUID();
    const filename = `${fileUuid}.pdf`;
    const relativeFilePath = `${storageConfig.quotationDocumentDirectory}/${filename}`;

    try {
      await storageService.writeStorageFile(relativeFilePath, pdfBuffer);
    } catch {
      throw new AppError('Failed to save PDF file to disk', 500);
    }

    const fileHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
    const documentVersionNumber = await quotationDocumentsRepository.getNextDocumentVersionNumber(quotation.id);

    let generatedDoc;
    try {
      generatedDoc = await quotationDocumentsRepository.createGeneratedDocument({
        quotationId: quotation.id,
        versionNumber: documentVersionNumber,
        filePath: relativeFilePath,
        fileHash,
        generatedById: userId,
      });
    } catch {
      await storageService.deleteStorageFile(relativeFilePath).catch(() => {});
      throw new AppError('Failed to record generated document metadata', 500);
    }

    await quotationDocumentsRepository.recordGeneratedDocumentAudit(
      {
        userId,
        documentId: generatedDoc.id,
        quotationId: quotation.id,
        quotationNumber: quotation.quotationNumber,
        revisionNumber: quotation.revisionNumber,
        fileSize: pdfBuffer.length,
      },
      {
        userId,
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

  const doc = await quotationDocumentsRepository.findDocumentForQuotation(quotationId, documentId);
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

quotationDocumentsRouter.get('/:id/pdf/:documentId/preview', asyncHandler(async (req, res) => {
  await streamPdfDocument(req, res, 'inline');
}));

quotationDocumentsRouter.get('/:id/pdf/:documentId/download', asyncHandler(async (req, res) => {
  await streamPdfDocument(req, res, 'attachment');
}));
