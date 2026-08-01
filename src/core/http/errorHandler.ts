import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { env } from '../../config/env.js';
import { AppError } from '../errors/AppError.js';
import { sendError } from './apiResponse.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;

  if (error instanceof ZodError) {
    return sendError(res, 400, 'Validation failed', error.flatten());
  }

  if (error instanceof AppError) {
    return sendError(res, error.statusCode, error.message, error.details);
  }

  const details = env.NODE_ENV === 'production' ? undefined : { message: String(error) };
  return sendError(res, 500, 'Internal server error', details);
};
