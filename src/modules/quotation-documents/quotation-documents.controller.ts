import type { Request, Response } from 'express';
import fs from 'node:fs';

import { AppError } from '../../utils/AppError.js';
import { generateQuotationPdfService, getQuotationPdfDocumentService } from './quotation-documents.service.js';

export async function generatePdfController(req: Request, res: Response): Promise<void> {
  const quotationId = Number(req.params.id);
  if (!Number.isInteger(quotationId) || quotationId <= 0) {
    throw new AppError('Invalid quotation ID', 400);
  }

  const userId = req.user?.id;
  if (!userId) {
    throw new AppError('Authentication required', 401);
  }

  const result = await generateQuotationPdfService(quotationId, userId);

  res.status(201).json({
    status: 'success',
    data: result,
  });
}

export async function previewPdfController(req: Request, res: Response): Promise<void> {
  const quotationId = Number(req.params.id);
  const documentId = Number(req.params.documentId);

  if (!Number.isInteger(quotationId) || quotationId <= 0) {
    throw new AppError('Invalid quotation ID', 400);
  }
  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new AppError('Invalid document ID', 400);
  }

  const { absolutePath, downloadFilename } = await getQuotationPdfDocumentService(quotationId, documentId);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${downloadFilename}"`);

  const fileStream = fs.createReadStream(absolutePath);
  fileStream.pipe(res);
}

export async function downloadPdfController(req: Request, res: Response): Promise<void> {
  const quotationId = Number(req.params.id);
  const documentId = Number(req.params.documentId);

  if (!Number.isInteger(quotationId) || quotationId <= 0) {
    throw new AppError('Invalid quotation ID', 400);
  }
  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new AppError('Invalid document ID', 400);
  }

  const { absolutePath, downloadFilename } = await getQuotationPdfDocumentService(quotationId, documentId);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);

  const fileStream = fs.createReadStream(absolutePath);
  fileStream.pipe(res);
}
