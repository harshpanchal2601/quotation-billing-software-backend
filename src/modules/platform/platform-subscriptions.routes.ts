import { Router, type Request } from 'express';
import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { ALL_PERMISSIONS } from '../auth/permissions.js';
import { platformFirmIdSchema } from './platform.schema.js';
import { platformSubscriptionsRepository as repository } from './platform-subscriptions.repository.js';
import { featureSwitchSchema, firmOverrideSchema, planCreateSchema, planPublishSchema, planUpdateSchema, planVersionSchema, platformAuditQuerySchema, platformChargeIdSchema, platformChargeSchema, platformFeatureKeySchema, platformFirmSubscriptionQuerySchema, platformOverrideIdSchema, platformPageSchema, platformPaymentSchema, platformUsageQuerySchema, platformVersionIdSchema, reasonSchema, subscriptionAssignmentSchema } from './platform-subscriptions.schema.js';

// Mounted only beneath the existing authenticated SUPER_ADMIN platform router.
export const platformSubscriptionsRouter = Router();
function actor(req: Request) {
  if (req.user === undefined) throw new AppError('Authentication required', 401);
  return req.user.id;
}
function firmId(req: Request) { return platformFirmIdSchema.parse(req.params).id; }
function respond(work: (req: Request) => Promise<unknown>, status = 200) {
  return asyncHandler(async (req, res) => {
    const data = await work(req);
    return sendSuccess(res, status, 'Platform subscription operation completed', data ?? null);
  });
}

platformSubscriptionsRouter.get('/features', respond(async () => ({ features: await repository.features() })));
platformSubscriptionsRouter.patch('/features/:key', respond((req) => repository.switchFeature(platformFeatureKeySchema.parse(req.params).key, featureSwitchSchema.parse(req.body), actor(req))));
platformSubscriptionsRouter.get('/plans', respond((req) => { const query = platformPageSchema.parse(req.query); return repository.plans(query.page, query.limit); }));
platformSubscriptionsRouter.post('/plans', respond((req) => repository.createPlan(planCreateSchema.parse(req.body), actor(req)), 201));
platformSubscriptionsRouter.get('/plans/:id', respond((req) => repository.plan(firmId(req))));
platformSubscriptionsRouter.put('/plans/:id', respond((req) => repository.updatePlan(firmId(req), planUpdateSchema.parse(req.body), actor(req))));
platformSubscriptionsRouter.delete('/plans/:id', respond((req) => repository.archivePlan(firmId(req), reasonSchema.parse(req.body).reason, actor(req))));
platformSubscriptionsRouter.post('/plans/:id/versions', respond(async (req) => ({ versionId: await repository.saveVersion(firmId(req), planVersionSchema.parse(req.body), actor(req)) }), 201));
platformSubscriptionsRouter.put('/plans/:id/versions/:versionId', respond(async (req) => { const ids = platformVersionIdSchema.parse(req.params); return { versionId: await repository.saveVersion(ids.id, planVersionSchema.parse(req.body), actor(req), ids.versionId) }; }));
platformSubscriptionsRouter.delete('/plans/:id/versions/:versionId', respond((req) => { const ids = platformVersionIdSchema.parse(req.params); return repository.deleteDraft(ids.id, ids.versionId, reasonSchema.parse(req.body).reason, actor(req)); }));
platformSubscriptionsRouter.get('/plans/:id/versions/:versionId/preview', respond((req) => { const ids = platformVersionIdSchema.parse(req.params); return repository.preview(ids.id, ids.versionId); }));
platformSubscriptionsRouter.post('/plans/:id/versions/:versionId/publish', respond((req) => { const ids = platformVersionIdSchema.parse(req.params); const input = planPublishSchema.parse(req.body); return repository.publish(ids.id, ids.versionId, input.reason, input.previewToken, actor(req)); }));
platformSubscriptionsRouter.get('/firms/:id/subscription', respond((req) => repository.firmDetails(firmId(req), ALL_PERMISSIONS, platformFirmSubscriptionQuerySchema.parse(req.query))));
platformSubscriptionsRouter.put('/firms/:id/subscription', respond((req) => repository.assign(firmId(req), subscriptionAssignmentSchema.parse(req.body), actor(req))));
platformSubscriptionsRouter.delete('/firms/:id/subscription/:versionId', respond((req) => { const ids = platformVersionIdSchema.parse(req.params); return repository.cancelScheduled(ids.id, ids.versionId, reasonSchema.parse(req.body).reason, actor(req)); }));
platformSubscriptionsRouter.get('/firms/:id/overrides', respond((req) => { const query = platformPageSchema.pick({ page: true }).parse(req.query); return repository.firmDetails(firmId(req), ALL_PERMISSIONS, { subscriptions: 1, overrides: query.page, charges: 1 }).then((details) => ({ overrides: details.overrides, pagination: details.pagination.overrides })); }));
platformSubscriptionsRouter.post('/firms/:id/overrides', respond((req) => repository.override(firmId(req), firmOverrideSchema.parse(req.body), actor(req)), 201));
platformSubscriptionsRouter.delete('/firms/:id/overrides/:overrideId', respond((req) => { const ids = platformOverrideIdSchema.parse(req.params); return repository.revokeOverride(ids.id, ids.overrideId, reasonSchema.parse(req.body).reason, actor(req)); }));
platformSubscriptionsRouter.get('/usage', respond((req) => repository.effectiveAccess(platformUsageQuerySchema.parse(req.query).firmId, ALL_PERMISSIONS)));
platformSubscriptionsRouter.get('/firms/:id/usage/events', respond((req) => { const query = platformPageSchema.parse(req.query); return repository.usageEvents(firmId(req), query.page, query.limit); }));
platformSubscriptionsRouter.post('/firms/:id/usage/reconcile', respond((req) => repository.reconcile(firmId(req), reasonSchema.parse(req.body).reason, actor(req))));
platformSubscriptionsRouter.get('/audit', respond((req) => { const query = platformAuditQuerySchema.parse(req.query); return repository.events(query.firmId, query.page, query.limit); }));
platformSubscriptionsRouter.post('/firms/:id/charges', respond((req) => repository.createCharge(firmId(req), platformChargeSchema.parse(req.body), actor(req)), 201));
platformSubscriptionsRouter.post('/firms/:id/charges/:chargeId/payments', respond((req) => { const ids = platformChargeIdSchema.parse(req.params); return repository.recordPayment(ids.id, ids.chargeId, platformPaymentSchema.parse(req.body), actor(req)); }, 201));
