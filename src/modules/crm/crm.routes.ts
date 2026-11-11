import { Router, type Request } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { AppError } from '../../core/errors/AppError.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { crmRepository } from './crm.repository.js';
import { activityCreateSchema, crmIdSchema, crmListSchema, customerTimelineListSchema, leadConversionSchema, leadCreateSchema, leadUpdateSchema, opportunityCreateSchema, opportunityUpdateSchema, taskCreateSchema, taskUpdateSchema } from './crm.schema.js';

function actor(req: Request) { if (!req.user) throw new AppError('Authentication required', 401); return req.user.id; }
function metadata(req: Request) { return { firmId: getFirmId(req), userId: actor(req), ipAddress: req.ip, userAgent: req.get('user-agent') }; }
function router() { const result = Router(); result.use(requireAuthentication, requireFirmContext); return result; }
export const leadsRouter = router();
export const opportunitiesRouter = router();
export const tasksRouter = router();
export const customerTimelineRouter = router();
for (const [target, kind] of [[leadsRouter, 'leads'], [opportunitiesRouter, 'opportunities'], [tasksRouter, 'tasks']] as const) {
  target.get('/', requirePermission(PERMISSIONS.CRM_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'CRM records retrieved', await crmRepository.list(getFirmId(req), actor(req), kind, crmListSchema.parse(req.query)))));
}
leadsRouter.get('/options', requirePermission(PERMISSIONS.CRM_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'CRM options retrieved', await crmRepository.options(getFirmId(req), actor(req), z.string().trim().max(191).default('').parse(req.query.search)))));
leadsRouter.post('/', requirePermission(PERMISSIONS.CRM_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Lead captured', { record: await crmRepository.createLead(getFirmId(req), actor(req), leadCreateSchema.parse(req.body), metadata(req)) })));
leadsRouter.patch('/:id', requirePermission(PERMISSIONS.CRM_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Lead updated', { record: await crmRepository.updateLead(getFirmId(req), actor(req), crmIdSchema.parse(req.params).id, leadUpdateSchema.parse(req.body), metadata(req)) })));
leadsRouter.get('/:id/suggestions', requirePermission(PERMISSIONS.CRM_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Possible company matches', { companies: await crmRepository.suggestions(getFirmId(req), actor(req), crmIdSchema.parse(req.params).id) })));
leadsRouter.post('/:id/convert', requirePermission(PERMISSIONS.CRM_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Lead converted', { record: await crmRepository.convertLead(getFirmId(req), actor(req), crmIdSchema.parse(req.params).id, leadConversionSchema.parse(req.body), metadata(req)) })));
opportunitiesRouter.post('/', requirePermission(PERMISSIONS.CRM_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Opportunity created', { record: await crmRepository.createOpportunity(getFirmId(req), actor(req), opportunityCreateSchema.parse(req.body), metadata(req)) })));
opportunitiesRouter.patch('/:id', requirePermission(PERMISSIONS.CRM_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Opportunity updated', { record: await crmRepository.updateOpportunity(getFirmId(req), actor(req), crmIdSchema.parse(req.params).id, opportunityUpdateSchema.parse(req.body), metadata(req)) })));
tasksRouter.post('/', requirePermission(PERMISSIONS.CRM_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Follow-up assigned', { record: await crmRepository.createTask(getFirmId(req), actor(req), taskCreateSchema.parse(req.body), metadata(req)) })));
tasksRouter.patch('/:id', requirePermission(PERMISSIONS.CRM_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Follow-up updated', { record: await crmRepository.updateTask(getFirmId(req), actor(req), crmIdSchema.parse(req.params).id, taskUpdateSchema.parse(req.body), metadata(req)) })));
customerTimelineRouter.get('/', requirePermission(PERMISSIONS.CRM_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Customer activity retrieved', await crmRepository.timeline(getFirmId(req), actor(req), customerTimelineListSchema.parse(req.query)))));
customerTimelineRouter.post('/', requirePermission(PERMISSIONS.CRM_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Activity recorded', { record: await crmRepository.activity(getFirmId(req), actor(req), activityCreateSchema.parse(req.body), metadata(req)) })));
