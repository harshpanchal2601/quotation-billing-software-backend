import { Router, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { portalRepository } from './portal.repository.js';
import { portalAccessListSchema, portalCompanyOptionsSchema, portalContactOptionsSchema, portalDecisionSchema, portalDocumentListSchema, portalDocumentOptionsSchema, portalExchangeSchema, portalGrantSchema, portalInviteSchema } from './portal.schema.js';

const COOKIE = 'bhuminex_portal_session';
const cookieOptions = { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/api/v1/customer-portal' };
const idSchema = z.object({ id: z.coerce.number().int().positive() });
const trustedOrigin: RequestHandler = (req, _res, next) => req.get('origin') === new URL(env.FRONTEND_URL).origin ? next() : next(new AppError('Portal request origin is not allowed', 403));
function actor(req: Request) { if (!req.user) throw new AppError('Authentication required', 401); return req.user.id; }
function metadata(req: Request) { return { ipAddress: req.ip?.slice(0, 191), userAgent: req.get('user-agent')?.slice(0, 2000) }; }
function token(req: Request): string | undefined { const value: unknown = req.cookies?.[COOKIE]; return typeof value === 'string' ? value : undefined; }
const csrf = (req: Request) => req.get('x-portal-csrf') ?? '';
export const portalAccessRouter = Router();
portalAccessRouter.use(requireAuthentication, requireFirmContext, requirePermission(PERMISSIONS.PORTAL_MANAGE));
portalAccessRouter.post('/identity/:id/restore', asyncHandler(async (req, res) => { await portalRepository.restoreIdentity(getFirmId(req), actor(req), idSchema.parse(req.params).id, metadata(req)); return sendSuccess(res, 200, 'Portal identity restored; issue a new invitation and document grants', {}); }));
portalAccessRouter.get('/', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Portal access retrieved', await portalRepository.staffList(getFirmId(req), actor(req), portalAccessListSchema.parse(req.query)))));
portalAccessRouter.get('/companies', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Portal company choices retrieved', { companies: await portalRepository.companies(getFirmId(req), actor(req), portalCompanyOptionsSchema.parse(req.query)) })));
portalAccessRouter.get('/contacts', asyncHandler(async (req, res) => { const query = portalContactOptionsSchema.parse(req.query); return sendSuccess(res, 200, 'Invitable contacts retrieved', { contacts: await portalRepository.contacts(getFirmId(req), actor(req), query.companyId, query.search) }); }));
portalAccessRouter.get('/document-options', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Shareable document choices retrieved', { documents: await portalRepository.documentOptions(getFirmId(req), actor(req), portalDocumentOptionsSchema.parse(req.query)) })));
portalAccessRouter.post('/invitations', asyncHandler(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); return sendSuccess(res, 201, 'Invitation created for deliberate delivery to the named contact', await portalRepository.invite(getFirmId(req), actor(req), portalInviteSchema.parse(req.body), metadata(req))); }));
portalAccessRouter.post('/grants', asyncHandler(async (req, res) => sendSuccess(res, 201, 'Document explicitly shared', await portalRepository.share(getFirmId(req), actor(req), portalGrantSchema.parse(req.body), metadata(req)))));
for (const kind of ['identity', 'invitation', 'grant'] as const) portalAccessRouter.post(`/${kind}/:id/revoke`, asyncHandler(async (req, res) => { await portalRepository.revoke(getFirmId(req), actor(req), kind, idSchema.parse(req.params).id, metadata(req)); return sendSuccess(res, 200, 'Portal access revoked', {}); }));

// This router deliberately does not use firm-user authentication, selected-firm
// headers, or internal RBAC. Tenant scope comes solely from the portal session.
export const customerPortalRouter = Router();
customerPortalRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
customerPortalRouter.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false }));
customerPortalRouter.post('/exchange', trustedOrigin, rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: true, legacyHeaders: false }), asyncHandler(async (req, res) => {
  const result = await portalRepository.exchange(portalExchangeSchema.parse(req.body).token, token(req), metadata(req));
  res.cookie(COOKIE, result.sessionToken, { ...cookieOptions, expires: result.expiresAt });
  return sendSuccess(res, 200, 'Portal session established', { csrfToken: result.csrfToken, expiresAt: result.expiresAt });
}));
customerPortalRouter.post('/session', trustedOrigin, asyncHandler(async (req, res) => sendSuccess(res, 200, 'Portal session resumed', await portalRepository.resume(token(req)))));
customerPortalRouter.get('/documents', asyncHandler(async (req, res) => { const query = portalDocumentListSchema.parse(req.query); return sendSuccess(res, 200, 'Shared documents retrieved', await portalRepository.listDocuments(token(req), query.page, query)); }));
customerPortalRouter.get('/documents/:id', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Shared document retrieved', await portalRepository.document(token(req), idSchema.parse(req.params).id))));
customerPortalRouter.post('/decisions', trustedOrigin, asyncHandler(async (req, res) => sendSuccess(res, 200, 'Quotation decision recorded', await portalRepository.decide(token(req), csrf(req), portalDecisionSchema.parse(req.body), metadata(req)))));
customerPortalRouter.post('/logout', trustedOrigin, asyncHandler(async (req, res) => { await portalRepository.logout(token(req), csrf(req)); res.clearCookie(COOKIE, cookieOptions); return sendSuccess(res, 200, 'Portal session ended', {}); }));
