import { Router } from 'express';

import { asyncHandler } from '../../utils/asyncHandler.js';
import { requireAuthentication } from '../../middleware/authentication.js';
import { changePassword, login, logout, me, refresh } from './auth.controller.js';
import { loginRateLimiter } from './auth.rateLimit.js';

export const authRouter = Router();

authRouter.post('/login', loginRateLimiter, asyncHandler(login));
authRouter.post('/refresh', asyncHandler(refresh));
authRouter.post('/logout', asyncHandler(logout));
authRouter.get('/me', requireAuthentication, asyncHandler(me));
authRouter.post('/change-password', requireAuthentication, asyncHandler(changePassword));
