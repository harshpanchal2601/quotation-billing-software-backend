import { Router, type Request, type Response } from 'express';

import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { requireAuthentication, requireRole } from '../auth/auth.middleware.js';
import { serialiseCategory } from './categories.serializer.js';
import { categoriesRepository } from './categories.repository.js';
import {
	categoryCreateSchema,
	categoryListQuerySchema,
	categoryStatusSchema,
	categoryUpdateSchema,
	idParamSchema,
} from './categories.schema.js';

export const categoriesRouter = Router();
export { categoriesRepository };

function metadata(req: Request) {
	return {
		userId: req.user?.id,
		ipAddress: req.ip,
		userAgent: req.get('user-agent'),
	};
}

export async function listCategories(req: Request, res: Response) {
	const query = categoryListQuerySchema.parse(req.query);
	const data = await categoriesRepository.listCategories(query);
	return sendSuccess(res, 200, 'Categories retrieved successfully', data);
}

export async function getCategoryOptions(_req: Request, res: Response) {
	const data = await categoriesRepository.getCategoryOptions();
	return sendSuccess(res, 200, 'Category options retrieved successfully', data);
}

export async function createCategory(req: Request, res: Response) {
	const input = categoryCreateSchema.parse(req.body);
	const existing = await categoriesRepository.findCategoryByName(input.name);

	if (existing !== null) {
		throw new AppError('Category with this name already exists', 409);
	}

	const slug = await categoriesRepository.generateUniqueSlug(input.name);
	const category = await categoriesRepository.createCategory({ ...input, slug }, metadata(req));
	return sendSuccess(res, 201, 'Category created successfully', { category });
}

export async function getCategory(req: Request, res: Response) {
	const { id } = idParamSchema.parse(req.params);
	const category = await categoriesRepository.findCategoryById(id);

	if (category === null) {
		throw new AppError('Category not found', 404);
	}

	return sendSuccess(res, 200, 'Category retrieved successfully', { category: serialiseCategory(category) });
}

export async function updateCategory(req: Request, res: Response) {
	const { id } = idParamSchema.parse(req.params);
	const input = categoryUpdateSchema.parse(req.body);
	const existing = await categoriesRepository.findCategoryById(id);

	if (existing === null) {
		throw new AppError('Category not found', 404);
	}

	if (existing.slug === 'uncategorised' && input.isActive === false) {
		throw new AppError('The default Uncategorised category cannot be deactivated or deleted.', 409);
	}

	if (input.name !== undefined && input.name !== existing.name) {
		const duplicate = await categoriesRepository.findCategoryByName(input.name);
		if (duplicate !== null && duplicate.id !== id) {
			throw new AppError('Category with this name already exists', 409);
		}
	}

	const updateData = {
		...(input.name === undefined ? {} : { name: input.name }),
		...(input.description === undefined ? {} : { description: input.description ?? null }),
		...(input.isActive === undefined ? {} : { isActive: input.isActive }),
	};

	if (Object.keys(updateData).length === 0) {
		return sendSuccess(res, 200, 'Category updated successfully', { category: serialiseCategory(existing) });
	}

	const category = await categoriesRepository.updateCategory(id, input, metadata(req), existing);
	return sendSuccess(res, 200, 'Category updated successfully', { category });
}

export async function updateCategoryStatus(req: Request, res: Response) {
	const { id } = idParamSchema.parse(req.params);
	const { isActive } = categoryStatusSchema.parse(req.body);
	const existing = await categoriesRepository.findCategoryById(id);

	if (existing === null) {
		throw new AppError('Category not found', 404);
	}

	if (existing.slug === 'uncategorised' && isActive === false) {
		throw new AppError('The default Uncategorised category cannot be deactivated or deleted.', 409);
	}

	if (existing.isActive === isActive) {
		return sendSuccess(res, 200, 'Category status updated successfully', { category: serialiseCategory(existing) });
	}

	const category = await categoriesRepository.updateCategoryStatus(id, isActive, metadata(req), existing);
	return sendSuccess(res, 200, 'Category status updated successfully', { category });
}

export async function deleteCategory(req: Request, res: Response) {
	const { id } = idParamSchema.parse(req.params);
	const existing = await categoriesRepository.findCategoryById(id);

	if (existing === null) {
		throw new AppError('Category not found', 404);
	}

	if (existing.slug === 'uncategorised') {
		throw new AppError('The default Uncategorised category cannot be deactivated or deleted.', 409);
	}

	const linkedItemsCount = await categoriesRepository.countLinkedItems(id);

	if (linkedItemsCount > 0) {
		throw new AppError('Category cannot be deleted because items are linked to it.', 409);
	}

	await categoriesRepository.deleteCategory(id, metadata(req), existing);
	return sendSuccess(res, 200, 'Category deleted successfully', null);
}

export async function restoreCategory(req: Request, res: Response) {
	const { id } = idParamSchema.parse(req.params);
	const existing = await categoriesRepository.findDeletedCategoryById(id);

	if (existing === null) {
		throw new AppError('Category not found', 404);
	}

	const conflict = await categoriesRepository.findRestoreConflict(existing.id, existing.name, existing.slug);

	if (conflict !== null) {
		throw new AppError('Cannot restore category because its name or slug conflicts with an existing category.', 409);
	}

	const category = await categoriesRepository.restoreCategory(id, metadata(req), existing);
	return sendSuccess(res, 200, 'Category restored successfully', { category });
}

categoriesRouter.use(requireAuthentication, requireRole('ADMIN'));

categoriesRouter.get('/', asyncHandler(listCategories));
categoriesRouter.get('/options', asyncHandler(getCategoryOptions));
categoriesRouter.post('/', asyncHandler(createCategory));
categoriesRouter.get('/:id', asyncHandler(getCategory));
categoriesRouter.put('/:id', asyncHandler(updateCategory));
categoriesRouter.patch('/:id/status', asyncHandler(updateCategoryStatus));
categoriesRouter.delete('/:id', asyncHandler(deleteCategory));
categoriesRouter.patch('/:id/restore', asyncHandler(restoreCategory));

