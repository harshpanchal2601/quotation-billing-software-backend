import type { AuthenticatedRequestUser } from '../modules/auth/auth.types.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedRequestUser;
      firmId?: number;
    }
  }
}

export {};
