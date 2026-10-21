import type { Request, Response } from 'express';

import { sendError } from './apiResponse.js';

export function notFoundHandler(req: Request, res: Response) {
  return sendError(res, 404, `Route not found: ${req.originalUrl}`);
}
