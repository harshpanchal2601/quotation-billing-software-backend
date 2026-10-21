import { UserRole } from '@prisma/client';
import { Router, type Request, type Response } from 'express';

import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { requireAuthentication, requireRole } from '../auth/auth.middleware.js';
import { handleMulterError, uploadItemImage as uploadMiddleware } from './images/item-image.policy.js';
import { itemsRepository } from './items.repository.js';
import {
  createItemSchema,
  idParamSchema,
  itemListQuerySchema,
  itemOptionsQuerySchema,
  itemStatusSchema,
  updateItemSchema,
} from './items.schema.js';

export const itemsRouter = Router();

function metadata(req: Request) {
  return {
    userId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

export async function listItems(req: Request, res: Response) {
  const query = itemListQuerySchema.parse(req.query);
  const result = await itemsRepository.listItems(query);
  return sendSuccess(res, 200, 'Items retrieved successfully', result);
}

export async function getItemOptions(req: Request, res: Response) {
  const query = itemOptionsQuerySchema.parse(req.query);
  const result = await itemsRepository.getItemOptions(query);
  return sendSuccess(res, 200, 'Item options retrieved successfully', result);
}

export async function createItem(req: Request, res: Response) {
  const input = createItemSchema.parse(req.body);
  const item = await itemsRepository.createItem(input, metadata(req));
  return sendSuccess(res, 201, 'Item created successfully', { item });
}

export async function getItem(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const item = await itemsRepository.getItem(id);
  return sendSuccess(res, 200, 'Item retrieved successfully', { item });
}

export async function updateItem(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const input = updateItemSchema.parse(req.body);
  const item = await itemsRepository.updateItem(id, input, metadata(req));
  return sendSuccess(res, 200, 'Item updated successfully', { item });
}

export async function updateItemStatus(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const { isActive } = itemStatusSchema.parse(req.body);
  const item = await itemsRepository.updateItemStatus(id, isActive, metadata(req));
  return sendSuccess(res, 200, 'Item status updated successfully', { item });
}

export async function deleteItem(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  await itemsRepository.deleteItem(id, metadata(req));
  return sendSuccess(res, 200, 'Item deleted successfully', null);
}

export async function restoreItem(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const item = await itemsRepository.restoreItem(id, metadata(req));
  return sendSuccess(res, 200, 'Item restored successfully', { item });
}

export async function uploadItemImage(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  if (!req.file) {
    throw new AppError('Image file is required', 400);
  }
  const item = await itemsRepository.uploadItemImage(id, req.file, metadata(req));
  return sendSuccess(res, 200, 'Item image uploaded successfully', { item });
}

export async function deleteItemImage(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const item = await itemsRepository.deleteItemImage(id, metadata(req));
  return sendSuccess(res, 200, 'Item image deleted successfully', { item });
}

itemsRouter.use(requireAuthentication, requireRole(UserRole.ADMIN));

itemsRouter.get('/', asyncHandler(listItems));
itemsRouter.get('/options', asyncHandler(getItemOptions));
itemsRouter.post('/', asyncHandler(createItem));
itemsRouter.get('/:id', asyncHandler(getItem));
itemsRouter.put('/:id', asyncHandler(updateItem));
itemsRouter.patch('/:id/status', asyncHandler(updateItemStatus));
itemsRouter.delete('/:id', asyncHandler(deleteItem));
itemsRouter.patch('/:id/restore', asyncHandler(restoreItem));

itemsRouter.post('/:id/image', (req, res, next) => {
  uploadMiddleware.single('image')(req, res, (error) => {
    if (error) {
      next(handleMulterError(error));
      return;
    }
    next();
  });
}, asyncHandler(uploadItemImage));

itemsRouter.delete('/:id/image', asyncHandler(deleteItemImage));
