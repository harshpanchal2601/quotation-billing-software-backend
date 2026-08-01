import { Router } from 'express';

import { requireAuthentication, requireRole } from '../../core/auth/authentication.middleware.js';
import * as categoriesController from './categories.controller.js';

export const categoriesRouter = Router();

categoriesRouter.use(requireAuthentication, requireRole('ADMIN'));

categoriesRouter.get('/', categoriesController.listCategories);
categoriesRouter.get('/options', categoriesController.getCategoryOptions);
categoriesRouter.post('/', categoriesController.createCategory);
categoriesRouter.get('/:id', categoriesController.getCategory);
categoriesRouter.put('/:id', categoriesController.updateCategory);
categoriesRouter.patch('/:id/status', categoriesController.updateCategoryStatus);
categoriesRouter.delete('/:id', categoriesController.deleteCategory);
categoriesRouter.patch('/:id/restore', categoriesController.restoreCategory);
