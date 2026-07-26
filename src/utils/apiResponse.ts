import type { Response } from 'express';

import type { ApiErrorResponse, ApiSuccessResponse } from '../types/api.js';

export function sendSuccess<TData>(
  res: Response,
  statusCode: number,
  message: string,
  data: TData,
) {
  const response: ApiSuccessResponse<TData> = {
    success: true,
    message,
    data,
  };

  return res.status(statusCode).json(response);
}

export function sendError(
  res: Response,
  statusCode: number,
  message: string,
  errors?: unknown,
) {
  const response: ApiErrorResponse = {
    success: false,
    message,
    ...(errors === undefined ? {} : { errors }),
  };

  return res.status(statusCode).json(response);
}
