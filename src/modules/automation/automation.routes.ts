import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAccountType, requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { automationRepository, type DefinitionKind } from './automation.repository.js';
import { approvalsRepository } from './approvals.repository.js';
import { customFieldsRepository } from './custom-fields.repository.js';
import { workflowsRepository } from './workflows.repository.js';
import { approvalListSchema, automationVersionListSchema, workflowRunListSchema, approvalCommandSchema, decisionSchema, definitionKeySchema, preferenceSchema, publishDefinitionSchema } from './automation.schema.js';

const id = z.string().uuid();
const pageSchema = z.coerce.number().int().min(1).max(100000).default(1);
function actor(req: Request) { return req.user!.id; }
function securedRouter() {
  const router = Router();
  router.use(requireAuthentication, requireAccountType('FIRM_ADMIN', 'FIRM_USER'), requireFirmContext);
  return router;
}
function definitionRoutes(router: Router, prefix: string, kind: DefinitionKind) {
  router.get(prefix || '/', requirePermission(PERMISSIONS.AUTOMATION_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Published configurations retrieved', { definitions: await automationRepository.list(getFirmId(req), actor(req), kind) })));
  router.get(`${prefix}/:key`, requirePermission(PERMISSIONS.AUTOMATION_MANAGE), asyncHandler(async (req, res) => {
    const query = automationVersionListSchema.parse(req.query);
    return sendSuccess(res, 200, 'Configuration versions retrieved', { versions: await automationRepository.list(getFirmId(req), actor(req), kind, definitionKeySchema.parse(req.params.key), query.page, query) });
  }));
  router.post(`${prefix}/:key/publish`, requirePermission(PERMISSIONS.AUTOMATION_MANAGE), asyncHandler(async (req, res) => {
    const input = publishDefinitionSchema.parse(req.body);
    return sendSuccess(res, 201, 'New immutable version published', { definition: await automationRepository.publish(getFirmId(req), actor(req), kind, definitionKeySchema.parse(req.params.key), input.expectedVersion, input.definition) });
  }));
  router.post(`${prefix}/:key/preview`, requirePermission(PERMISSIONS.AUTOMATION_MANAGE), asyncHandler(async (req, res) => {
    const input = z.object({ definition: z.unknown(), event: z.unknown().optional() }).strict().parse(req.body);
    return sendSuccess(res, 200, 'Preview completed without effects', { preview: await automationRepository.preview(getFirmId(req), actor(req), kind, definitionKeySchema.parse(req.params.key), input.definition, input.event) });
  }));
  router.post(`${prefix}/:key/rollback`, requirePermission(PERMISSIONS.AUTOMATION_MANAGE), asyncHandler(async (req, res) => {
    const input = z.object({ expectedVersion: z.number().int().positive(), version: z.number().int().positive() }).strict().parse(req.body);
    return sendSuccess(res, 201, 'Historical configuration republished as a new version', { definition: await automationRepository.rollback(getFirmId(req), actor(req), kind, definitionKeySchema.parse(req.params.key), input.expectedVersion, input.version) });
  }));
}
export const automationRouter = securedRouter();
definitionRoutes(automationRouter, '/workflows', 'WORKFLOW');
automationRouter.get('/recipients', requirePermission(PERMISSIONS.AUTOMATION_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Firm recipients retrieved', { recipients: await automationRepository.recipients(getFirmId(req), actor(req)) })));
automationRouter.get('/runs', requirePermission(PERMISSIONS.AUTOMATION_MANAGE), asyncHandler(async (req, res) => {
  const query = workflowRunListSchema.parse(req.query);
  return sendSuccess(res, 200, 'Workflow diagnostics retrieved', { runs: await workflowsRepository.runs(getFirmId(req), actor(req), query.page, query) });
}));
automationRouter.post('/runs/:id/:command', requirePermission(PERMISSIONS.AUTOMATION_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Workflow run updated', await workflowsRepository.control(getFirmId(req), actor(req), id.parse(req.params.id), z.enum(['CANCEL', 'RETRY']).parse(req.params.command)))));
automationRouter.get('/preferences', requirePermission(PERMISSIONS.AUTOMATION_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Your automation preferences retrieved', { preference: await automationRepository.preferences(getFirmId(req), actor(req)) })));
automationRouter.put('/preferences', requirePermission(PERMISSIONS.AUTOMATION_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Your automation preferences saved', { preference: await automationRepository.preferences(getFirmId(req), actor(req), preferenceSchema.parse(req.body)) })));

export const approvalsRouter = securedRouter();
definitionRoutes(approvalsRouter, '/policies', 'APPROVAL');
approvalsRouter.get('/', requirePermission(PERMISSIONS.AUTOMATION_VIEW), asyncHandler(async (req, res) => {
  const query = approvalListSchema.parse(req.query);
  return sendSuccess(res, 200, 'Approval inbox retrieved', { approvals: await approvalsRepository.list(getFirmId(req), actor(req), query.page, query) });
}));
approvalsRouter.post('/', asyncHandler(async (req, res) => sendSuccess(res, 201, 'Approval requested', { approval: await approvalsRepository.request(getFirmId(req), actor(req), approvalCommandSchema.parse(req.body)) })));
approvalsRouter.post('/:id/decisions', asyncHandler(async (req, res) => sendSuccess(res, 200, 'Approval decision recorded', await approvalsRepository.decide(getFirmId(req), actor(req), id.parse(req.params.id), decisionSchema.parse(req.body)))));

export const templatesRouter = securedRouter();
definitionRoutes(templatesRouter, '', 'TEMPLATE');
export const notificationRulesRouter = securedRouter();
definitionRoutes(notificationRulesRouter, '', 'NOTIFICATION');
export const customFieldsRouter = securedRouter();
const entity = z.enum(['COMPANY', 'ITEM', 'QUOTATION']);
customFieldsRouter.get('/values/:entity/:entityId', requirePermission(PERMISSIONS.AUTOMATION_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Additional values retrieved', await customFieldsRepository.read(getFirmId(req), actor(req), entity.parse(req.params.entity), z.coerce.number().int().positive().parse(req.params.entityId), pageSchema.parse(req.query.page)))));
customFieldsRouter.put('/values/:entity/:entityId', requirePermission(PERMISSIONS.AUTOMATION_VIEW), asyncHandler(async (req, res) => {
  const input = z.object({ expectedVersion: z.number().int().nonnegative(), definitionId: z.number().int().positive(), values: z.unknown() }).strict().parse(req.body);
  return sendSuccess(res, 201, 'New value version saved', { values: await customFieldsRepository.write(getFirmId(req), actor(req), entity.parse(req.params.entity), z.coerce.number().int().positive().parse(req.params.entityId), input.expectedVersion, input.definitionId, input.values) });
}));
customFieldsRouter.get('/search/:entity', requirePermission(PERMISSIONS.AUTOMATION_VIEW), asyncHandler(async (req, res) => {
  const query = z.object({ key: z.string().regex(/^cf_[a-z][a-z0-9_]{0,44}$/), value: z.string().max(4000) }).strict().parse(req.query);
  return sendSuccess(res, 200, 'Matching entity IDs retrieved', { entityIds: await customFieldsRepository.search(getFirmId(req), actor(req), entity.parse(req.params.entity), query.key, query.value) });
}));
definitionRoutes(customFieldsRouter, '', 'CUSTOM_FIELDS');
