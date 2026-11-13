import { Router, type Request, type Response } from 'express';

import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { serialiseMeasurementUnit } from './measurement-units.serializer.js';
import { measurementUnitsRepository } from './measurement-units.repository.js';
import {
	idParamSchema,
	measurementUnitCreateSchema,
	measurementUnitListQuerySchema,
	measurementUnitStatusSchema,
	measurementUnitUpdateSchema,
} from './measurement-units.schema.js';

export const measurementUnitsRouter = Router();
export { measurementUnitsRepository };

function metadata(req: Request) {
	return {
		userId: req.user?.id,
		firmId: req.firmId,
		ipAddress: req.ip,
		userAgent: req.get('user-agent'),
	};
}

export async function listMeasurementUnits(req: Request, res: Response) {
	const query = measurementUnitListQuerySchema.parse(req.query);
	const data = await measurementUnitsRepository.listMeasurementUnits(getFirmId(req), query);
	return sendSuccess(res, 200, 'Measurement units retrieved successfully', data);
}

export async function getMeasurementUnitOptions(req: Request, res: Response) {
	const data = await measurementUnitsRepository.getMeasurementUnitOptions(getFirmId(req));
	return sendSuccess(res, 200, 'Measurement unit options retrieved successfully', data);
}

export async function createMeasurementUnit(req: Request, res: Response) {
	const input = measurementUnitCreateSchema.parse(req.body);
	const firmId = getFirmId(req);
	const existing = await measurementUnitsRepository.findDuplicateMeasurementUnit(firmId, input.name, input.symbol);

	if (existing !== null) {
		throw new AppError('Measurement unit name or symbol already exists', 409);
	}

	const measurementUnit = await measurementUnitsRepository.createMeasurementUnit(firmId, input, metadata(req));
	return sendSuccess(res, 201, 'Measurement unit created successfully', { measurementUnit });
}

export async function getMeasurementUnit(req: Request, res: Response) {
	const { id } = idParamSchema.parse(req.params);
	const measurementUnit = await measurementUnitsRepository.findMeasurementUnitById(getFirmId(req), id);

	if (measurementUnit === null) {
		throw new AppError('Measurement unit not found', 404);
	}

	return sendSuccess(res, 200, 'Measurement unit retrieved successfully', {
		measurementUnit: serialiseMeasurementUnit(measurementUnit),
	});
}

export async function updateMeasurementUnit(req: Request, res: Response) {
	const { id } = idParamSchema.parse(req.params);
	const input = measurementUnitUpdateSchema.parse(req.body);
	const firmId = getFirmId(req);
	const existing = await measurementUnitsRepository.findMeasurementUnitById(firmId, id);

	if (existing === null) {
		throw new AppError('Measurement unit not found', 404);
	}

	const duplicateNameOrSymbol =
		input.name !== undefined || input.symbol !== undefined
			? await measurementUnitsRepository.findDuplicateMeasurementUnit(
					firmId,
					input.name ?? existing.name,
					input.symbol ?? existing.symbol,
					id,
				)
			: null;

	if (duplicateNameOrSymbol !== null) {
		throw new AppError('Measurement unit name or symbol already exists', 409);
	}

	const updateData = {
		...(input.name === undefined ? {} : { name: input.name }),
		...(input.symbol === undefined ? {} : { symbol: input.symbol }),
		...(input.allowDecimal === undefined ? {} : { allowDecimal: input.allowDecimal }),
		...(input.isActive === undefined ? {} : { isActive: input.isActive }),
	};

	if (Object.keys(updateData).length === 0) {
		return sendSuccess(res, 200, 'Measurement unit updated successfully', {
			measurementUnit: serialiseMeasurementUnit(existing),
		});
	}

	const measurementUnit = await measurementUnitsRepository.updateMeasurementUnit(id, input, metadata(req), existing);
	return sendSuccess(res, 200, 'Measurement unit updated successfully', { measurementUnit });
}

export async function updateMeasurementUnitStatus(req: Request, res: Response) {
	const { id } = idParamSchema.parse(req.params);
	const { isActive } = measurementUnitStatusSchema.parse(req.body);
	const existing = await measurementUnitsRepository.findMeasurementUnitById(getFirmId(req), id);

	if (existing === null) {
		throw new AppError('Measurement unit not found', 404);
	}

	if (existing.isActive === isActive) {
		return sendSuccess(res, 200, 'Measurement unit status updated successfully', {
			measurementUnit: serialiseMeasurementUnit(existing),
		});
	}

	const measurementUnit = await measurementUnitsRepository.updateMeasurementUnitStatus(
		id,
		isActive,
		metadata(req),
		existing,
	);
	return sendSuccess(res, 200, 'Measurement unit status updated successfully', { measurementUnit });
}

export async function deleteMeasurementUnit(req: Request, res: Response) {
	const { id } = idParamSchema.parse(req.params);
	const firmId = getFirmId(req);
	const existing = await measurementUnitsRepository.findMeasurementUnitById(firmId, id);

	if (existing === null) {
		throw new AppError('Measurement unit not found', 404);
	}

	const linkedItemsCount = await measurementUnitsRepository.countLinkedItems(firmId, id);

	if (linkedItemsCount > 0) {
		throw new AppError('Measurement unit cannot be deleted because items are linked to it.', 409);
	}

	await measurementUnitsRepository.deleteMeasurementUnit(id, metadata(req), existing);
	return sendSuccess(res, 200, 'Measurement unit deleted successfully', null);
}

export async function restoreMeasurementUnit(req: Request, res: Response) {
	const { id } = idParamSchema.parse(req.params);
	const firmId = getFirmId(req);
	const existing = await measurementUnitsRepository.findDeletedMeasurementUnitById(firmId, id);

	if (existing === null) {
		throw new AppError('Measurement unit not found', 404);
	}

	const conflict = await measurementUnitsRepository.findRestoreConflict(firmId, existing.id, existing.name, existing.symbol);

	if (conflict !== null) {
		throw new AppError('Cannot restore measurement unit because its name or symbol conflicts with an existing unit.', 409);
	}

	const measurementUnit = await measurementUnitsRepository.restoreMeasurementUnit(id, metadata(req), existing);
	return sendSuccess(res, 200, 'Measurement unit restored successfully', { measurementUnit });
}

measurementUnitsRouter.use(requireAuthentication, requireFirmContext);

measurementUnitsRouter.get('/', requirePermission(PERMISSIONS.CATALOG_VIEW), asyncHandler(listMeasurementUnits));
measurementUnitsRouter.get(
  '/options',
  requirePermission(PERMISSIONS.CATALOG_VIEW, PERMISSIONS.ITEMS_MANAGE),
  asyncHandler(getMeasurementUnitOptions),
);
measurementUnitsRouter.post('/', requirePermission(PERMISSIONS.CATALOG_MANAGE), asyncHandler(createMeasurementUnit));
measurementUnitsRouter.get('/:id', requirePermission(PERMISSIONS.CATALOG_VIEW), asyncHandler(getMeasurementUnit));
measurementUnitsRouter.put('/:id', requirePermission(PERMISSIONS.CATALOG_MANAGE), asyncHandler(updateMeasurementUnit));
measurementUnitsRouter.patch('/:id/status', requirePermission(PERMISSIONS.CATALOG_MANAGE), asyncHandler(updateMeasurementUnitStatus));
measurementUnitsRouter.delete('/:id', requirePermission(PERMISSIONS.CATALOG_MANAGE), asyncHandler(deleteMeasurementUnit));
measurementUnitsRouter.patch('/:id/restore', requirePermission(PERMISSIONS.CATALOG_MANAGE), asyncHandler(restoreMeasurementUnit));
