import type { Request, Response } from 'express';
import multer from 'multer';

import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ItemsService } from './items.service.js';
import {
  createItemSchema,
  idParamSchema,
  itemListQuerySchema,
  itemOptionsQuerySchema,
  itemStatusSchema,
  updateItemSchema,
} from './items.validation.js';

const itemsService = new ItemsService(prisma);

export function getItemsServiceInstance() {
  return itemsService;
}

export const listItems = asyncHandler(async (req: Request, res: Response) => {
  const query = itemListQuerySchema.parse(req.query);
  const result = await itemsService.listItems(query);
  return sendSuccess(res, 200, 'Items retrieved successfully', result);
});

export const getItemOptions = asyncHandler(async (req: Request, res: Response) => {
  const query = itemOptionsQuerySchema.parse(req.query);
  const result = await itemsService.getItemOptions(query);
  return sendSuccess(res, 200, 'Item options retrieved successfully', result);
});

export const createItem = asyncHandler(async (req: Request, res: Response) => {
  const input = createItemSchema.parse(req.body);
  const result = await itemsService.createItem(input, getMetadata(req));
  return sendSuccess(res, 201, 'Item created successfully', { item: result });
});

export const getItem = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const result = await itemsService.getItem(id);
  return sendSuccess(res, 200, 'Item retrieved successfully', { item: result });
});

export const updateItem = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const input = updateItemSchema.parse(req.body);
  const result = await itemsService.updateItem(id, input, getMetadata(req));
  return sendSuccess(res, 200, 'Item updated successfully', { item: result });
});

export const updateItemStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const input = itemStatusSchema.parse(req.body);
  const result = await itemsService.updateItemStatus(id, input.isActive, getMetadata(req));
  return sendSuccess(res, 200, 'Item status updated successfully', { item: result });
});

export const deleteItem = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  await itemsService.deleteItem(id, getMetadata(req));
  return sendSuccess(res, 200, 'Item deleted successfully', null);
});

export const restoreItem = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const result = await itemsService.restoreItem(id, getMetadata(req));
  return sendSuccess(res, 200, 'Item restored successfully', { item: result });
});

export const uploadItemImage = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  if (!req.file) {
    throw new AppError('Image file is required', 400);
  }
  const result = await itemsService.uploadItemImage(id, req.file, getMetadata(req));
  return sendSuccess(res, 200, 'Item image uploaded successfully', { item: result });
});

export const deleteItemImage = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const result = await itemsService.deleteItemImage(id, getMetadata(req));
  return sendSuccess(res, 200, 'Item image deleted successfully', { item: result });
});

export function handleMulterError(error: unknown) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new AppError('Item image exceeds the 5 MB limit', 413);
    }
    return new AppError('The image could not be uploaded. Please choose a supported image and try again.', 400);
  }
  return error;
}

function getMetadata(req: Request) {
  return {
    userId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}
