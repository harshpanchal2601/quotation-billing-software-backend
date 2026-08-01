import { Router } from 'express';

import { requireAuthentication, requireRole } from '../auth/auth.middleware.js';
import { uploadItemImage as uploadMiddleware } from './item-image.service.js';
import * as itemsController from './items.controller.js';

export const itemsRouter = Router();

itemsRouter.use(requireAuthentication, requireRole('ADMIN'));

itemsRouter.get('/', itemsController.listItems);
itemsRouter.get('/options', itemsController.getItemOptions);
itemsRouter.post('/', itemsController.createItem);
itemsRouter.get('/:id', itemsController.getItem);
itemsRouter.put('/:id', itemsController.updateItem);
itemsRouter.patch('/:id/status', itemsController.updateItemStatus);
itemsRouter.delete('/:id', itemsController.deleteItem);
itemsRouter.patch('/:id/restore', itemsController.restoreItem);

itemsRouter.post('/:id/image', (req, res, next) => {
  uploadMiddleware.single('image')(req, res, (error) => {
    if (error) {
      next(itemsController.handleMulterError(error));
      return;
    }
    next();
  });
}, itemsController.uploadItemImage);

itemsRouter.delete('/:id/image', itemsController.deleteItemImage);
