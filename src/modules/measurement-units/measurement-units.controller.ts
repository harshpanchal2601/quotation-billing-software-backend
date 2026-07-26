import type { Request, Response } from 'express';

import { prisma } from '../../config/database.js';
import { sendSuccess } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { MeasurementUnitsService } from './measurement-units.service.js';
import {
  idParamSchema,
  measurementUnitCreateSchema,
  measurementUnitListQuerySchema,
  measurementUnitStatusSchema,
  measurementUnitUpdateSchema,
} from './measurement-units.validation.js';

const measurementUnitsService = new MeasurementUnitsService(prisma);

function metadata(req: Request) {
  return {
    userId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

export const listMeasurementUnits = asyncHandler(async (req: Request, res: Response) => {
  const query = measurementUnitListQuerySchema.parse(req.query);
  const data = await measurementUnitsService.listMeasurementUnits(query);
  return sendSuccess(res, 200, 'Measurement units retrieved successfully', data);
});

export const getMeasurementUnitOptions = asyncHandler(async (_req: Request, res: Response) => {
  const data = await measurementUnitsService.getMeasurementUnitOptions();
  return sendSuccess(res, 200, 'Measurement unit options retrieved successfully', data);
});

export const createMeasurementUnit = asyncHandler(async (req: Request, res: Response) => {
  const input = measurementUnitCreateSchema.parse(req.body);
  const measurementUnit = await measurementUnitsService.createMeasurementUnit(input, metadata(req));
  return sendSuccess(res, 201, 'Measurement unit created successfully', { measurementUnit });
});

export const getMeasurementUnit = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const measurementUnit = await measurementUnitsService.getMeasurementUnit(id);
  return sendSuccess(res, 200, 'Measurement unit retrieved successfully', { measurementUnit });
});

export const updateMeasurementUnit = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const input = measurementUnitUpdateSchema.parse(req.body);
  const measurementUnit = await measurementUnitsService.updateMeasurementUnit(id, input, metadata(req));
  return sendSuccess(res, 200, 'Measurement unit updated successfully', { measurementUnit });
});

export const updateMeasurementUnitStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { isActive } = measurementUnitStatusSchema.parse(req.body);
  const measurementUnit = await measurementUnitsService.updateMeasurementUnitStatus(id, isActive, metadata(req));
  return sendSuccess(res, 200, 'Measurement unit status updated successfully', { measurementUnit });
});

export const deleteMeasurementUnit = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  await measurementUnitsService.deleteMeasurementUnit(id, metadata(req));
  return sendSuccess(res, 200, 'Measurement unit deleted successfully', null);
});

export const restoreMeasurementUnit = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const measurementUnit = await measurementUnitsService.restoreMeasurementUnit(id, metadata(req));
  return sendSuccess(res, 200, 'Measurement unit restored successfully', { measurementUnit });
});
