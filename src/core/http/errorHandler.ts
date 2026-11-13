import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { env } from '../../config/env.js';
import { AppError } from '../errors/AppError.js';
import { sendError } from './apiResponse.js';
import { logOperationalEvent } from '../observability/logger.js';

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    logOperationalEvent('error', { event: 'http.failed', requestId: req.requestId, kind: 'response_started' });
    return next(error);
  }

  const parserError = error as { type?: unknown } | null;
  if (parserError?.type === 'entity.parse.failed' && error instanceof SyntaxError) return sendError(res, 400, 'Request body contains invalid JSON');
  if (parserError?.type === 'entity.too.large') return sendError(res, 413, 'Request body is too large');

  if (error instanceof ZodError) {
    const flattenedError = error.flatten();
    const validationMessage = error.issues.find((issue) => issue.message.trim().length > 0)?.message;
    return sendError(
      res,
      400,
      validationMessage ?? 'Please review the entered information and try again.',
      flattenedError,
    );
  }

  if (error instanceof AppError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      res.vary('Accept');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'GET' && req.get('Accept')?.toLowerCase().includes('text/html') && req.accepts(['html', 'json']) === 'html') {
        const page = error.statusCode === 401 ? '/login' : '/access-denied';
        return res.redirect(303, new URL(page, env.FRONTEND_URL).toString());
      }
    }
    return sendError(res, error.statusCode, error.message, error.details);
  }

  const details = env.NODE_ENV === 'production' ? undefined : { message: String(error) };
  logOperationalEvent('error', { event: 'http.failed', requestId: req.requestId, kind: 'unexpected' });
  return sendError(res, 500, 'Internal server error', details);
};
