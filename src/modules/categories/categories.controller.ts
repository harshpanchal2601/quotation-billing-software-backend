import type { Request, Response } from 'express';

import { prisma } from '../../core/database/prisma.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { CategoriesService } from './categories.service.js';
import {
  categoryCreateSchema,
  categoryListQuerySchema,
  categoryStatusSchema,
  categoryUpdateSchema,
  idParamSchema,
} from './categories.schema.js';

const categoriesService = new CategoriesService(prisma);

function metadata(req: Request) {
  return {
    userId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

export const listCategories = asyncHandler(async (req: Request, res: Response) => {
  const query = categoryListQuerySchema.parse(req.query);
  const data = await categoriesService.listCategories(query);
  return sendSuccess(res, 200, 'Categories retrieved successfully', data);
});

export const getCategoryOptions = asyncHandler(async (_req: Request, res: Response) => {
  const data = await categoriesService.getCategoryOptions();
  return sendSuccess(res, 200, 'Category options retrieved successfully', data);
});

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const input = categoryCreateSchema.parse(req.body);
  const category = await categoriesService.createCategory(input, metadata(req));
  return sendSuccess(res, 201, 'Category created successfully', { category });
});

export const getCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const category = await categoriesService.getCategory(id);
  return sendSuccess(res, 200, 'Category retrieved successfully', { category });
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const input = categoryUpdateSchema.parse(req.body);
  const category = await categoriesService.updateCategory(id, input, metadata(req));
  return sendSuccess(res, 200, 'Category updated successfully', { category });
});

export const updateCategoryStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { isActive } = categoryStatusSchema.parse(req.body);
  const category = await categoriesService.updateCategoryStatus(id, isActive, metadata(req));
  return sendSuccess(res, 200, 'Category status updated successfully', { category });
});

export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  await categoriesService.deleteCategory(id, metadata(req));
  return sendSuccess(res, 200, 'Category deleted successfully', null);
});

export const restoreCategory = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const category = await categoriesService.restoreCategory(id, metadata(req));
  return sendSuccess(res, 200, 'Category restored successfully', { category });
});
