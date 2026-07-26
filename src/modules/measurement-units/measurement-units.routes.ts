import { Router } from 'express';

import { requireAuthentication, requireRole } from '../../middleware/authentication.js';
import * as measurementUnitsController from './measurement-units.controller.js';

export const measurementUnitsRouter = Router();

measurementUnitsRouter.use(requireAuthentication, requireRole('ADMIN'));

measurementUnitsRouter.get('/', measurementUnitsController.listMeasurementUnits);
measurementUnitsRouter.get('/options', measurementUnitsController.getMeasurementUnitOptions);
measurementUnitsRouter.post('/', measurementUnitsController.createMeasurementUnit);
measurementUnitsRouter.get('/:id', measurementUnitsController.getMeasurementUnit);
measurementUnitsRouter.put('/:id', measurementUnitsController.updateMeasurementUnit);
measurementUnitsRouter.patch('/:id/status', measurementUnitsController.updateMeasurementUnitStatus);
measurementUnitsRouter.delete('/:id', measurementUnitsController.deleteMeasurementUnit);
measurementUnitsRouter.patch('/:id/restore', measurementUnitsController.restoreMeasurementUnit);
