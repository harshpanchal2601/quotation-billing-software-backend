import { Router, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';
import { sendError, sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAccountType, requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assistantRepository } from './assistant.repository.js';
import { assistantIdSchema, chatSchema, confirmationSchema, extractionSchema, historyQuerySchema, proposalSchema, searchToolSchema, settingsSchema } from './assistant.schema.js';

export const assistantRouter = Router();
assistantRouter.use(requireAuthentication, requireAccountType('FIRM_ADMIN', 'FIRM_USER'), requireFirmContext);
assistantRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
const trustedOrigin: RequestHandler = (req, _res, next) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('origin') === new URL(env.FRONTEND_URL).origin ? next() : next(new AppError('Assistant request origin is not allowed', 403));
assistantRouter.use(trustedOrigin);
assistantRouter.use(rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `${getFirmId(req)}:${req.user!.id}`,
  handler: (_req, res) => { sendError(res, 429, 'Assistant request rate limit reached'); } }));
const useAssistant = requirePermission(PERMISSIONS.ASSISTANT_LOCAL, PERMISSIONS.ASSISTANT_LLM);
const actor = (req: Request) => req.user!.id;

assistantRouter.get('/usage', useAssistant, asyncHandler(async (req, res) => sendSuccess(res, 200, 'Assistant mode and usage retrieved', await assistantRepository.status(getFirmId(req), actor(req)))));
assistantRouter.get('/settings', requirePermission(PERMISSIONS.ASSISTANT_SETTINGS_MANAGE), requireAccountType('FIRM_ADMIN'), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Assistant settings retrieved', await assistantRepository.status(getFirmId(req), actor(req)))));
assistantRouter.put('/settings', requirePermission(PERMISSIONS.ASSISTANT_SETTINGS_MANAGE), requireAccountType('FIRM_ADMIN'), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Assistant settings saved', await assistantRepository.saveSettings(getFirmId(req), actor(req), settingsSchema.parse(req.body)))));
assistantRouter.post('/chat', useAssistant, asyncHandler(async (req, res) => sendSuccess(res, 200, 'Assistant request completed', await assistantRepository.chat(getFirmId(req), actor(req), chatSchema.parse(req.body)))));
assistantRouter.post('/search', useAssistant, asyncHandler(async (req, res) => {
  const input = chatSchema.omit({ plan: true }).extend({ plan: searchToolSchema }).parse(req.body);
  return sendSuccess(res, 200, 'Assistant search completed', await assistantRepository.chat(getFirmId(req), actor(req), input));
}));
assistantRouter.get('/history', useAssistant, asyncHandler(async (req, res) => sendSuccess(res, 200, 'Your assistant history retrieved', await assistantRepository.history(getFirmId(req), actor(req), historyQuerySchema.parse(req.query).page))));
assistantRouter.delete('/history/:id', useAssistant, asyncHandler(async (req, res) => {
  await assistantRepository.erase(getFirmId(req), actor(req), assistantIdSchema.parse(req.params.id));
  return sendSuccess(res, 200, 'Conversation content erased; required action and usage audit retained', {});
}));
assistantRouter.post('/proposals', useAssistant, asyncHandler(async (req, res) => sendSuccess(res, 201, 'Review the exact proposed action', await assistantRepository.propose(getFirmId(req), actor(req), proposalSchema.parse(req.body)))));
assistantRouter.post('/proposals/:id/confirm', useAssistant, asyncHandler(async (req, res) => {
  const input = confirmationSchema.parse(req.body);
  return sendSuccess(res, 200, 'The confirmed domain action completed', await assistantRepository.confirm(getFirmId(req), actor(req), assistantIdSchema.parse(req.params.id), input.nonce));
}));
assistantRouter.post('/proposals/:id/cancel', useAssistant, asyncHandler(async (req, res) => {
  await assistantRepository.cancel(getFirmId(req), actor(req), assistantIdSchema.parse(req.params.id));
  return sendSuccess(res, 200, 'Proposal cancelled', {});
}));
assistantRouter.post('/extractions', useAssistant, asyncHandler(async (req, res) => {
  const input = extractionSchema.parse(req.body);
  return sendSuccess(res, 200, 'Untrusted document candidates prepared for review', await assistantRepository.extraction(getFirmId(req), actor(req), input.text));
}));
