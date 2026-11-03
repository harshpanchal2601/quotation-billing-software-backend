import { Router, type Request } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { AppError } from '../../core/errors/AppError.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { billingAccess, invoicesRepository, invoiceSettingsRepository, type DocumentScope } from './invoices.repository.js';
import { invoiceDocumentsRepository as documentsRepository } from './documents/invoice-documents.repository.js';
import { adjustmentSchema, conversionSchema, customFieldValuesSchema, idSchema, invoiceDraftSchema, invoiceListSchema, invoiceUpdateSchema, issueSchema, optionQuerySchema, proformaConversionSchema, voidSchema } from './invoices.schema.js';
import { fiscalSettingsUpdateSchema, invoiceFieldsUpdateSchema } from './invoice-settings.schema.js';
import { INDIA_STATES } from './india-gst.js';

function actor(req: Request) { if (!req.user) throw new AppError('Authentication required', 401); return req.user.id; }
function metadata(req: Request) { return { firmId: getFirmId(req), userId: actor(req), ipAddress: req.ip, userAgent: req.get('user-agent') }; }

function createDocumentRouter(scope: DocumentScope) {
  const router = Router();
  const permissions = billingAccess[scope];
  router.use(requireAuthentication, requireFirmContext);
  router.get('/', requirePermission(permissions.view), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Billing documents retrieved', await invoicesRepository.list(getFirmId(req), scope, invoiceListSchema.parse(req.query)))));
  if (scope !== 'ADJUSTMENT') {
    router.post('/calculate', requirePermission(permissions.create), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Draft totals calculated', await invoicesRepository.preview(getFirmId(req), actor(req), invoiceDraftSchema.parse(req.body), scope))));
    router.post('/', requirePermission(permissions.create), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Draft created', { document: await invoicesRepository.create(getFirmId(req), actor(req), invoiceDraftSchema.parse(req.body), scope, metadata(req)) })));
    router.get('/options/customers', requirePermission(permissions.create, permissions.edit), asyncHandler(async (req, res) => {
      const query = optionQuerySchema.parse(req.query);
      return sendSuccess(res, 200, 'Customers retrieved', { customers: await invoicesRepository.options(getFirmId(req), 'customers', query.search, query.limit) });
    }));
    router.get('/options/customers/:id/addresses', requirePermission(permissions.create, permissions.edit), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Addresses retrieved', { addresses: await invoicesRepository.customerAddresses(getFirmId(req), idSchema.parse(req.params).id) })));
    router.get('/options/items', requirePermission(permissions.create, permissions.edit), asyncHandler(async (req, res) => {
      const query = optionQuerySchema.parse(req.query);
      return sendSuccess(res, 200, 'Catalog options retrieved', { items: await invoicesRepository.options(getFirmId(req), 'items', query.search, query.limit) });
    }));
  } else router.post('/', requirePermission(permissions.create), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Adjustment draft created', { document: await invoicesRepository.createAdjustment(getFirmId(req), actor(req), adjustmentSchema.parse(req.body), metadata(req)) })));
  if (scope === 'INVOICE') router.post('/from-quotation', requirePermission(permissions.create), requirePermission(PERMISSIONS.QUOTATIONS_VIEW), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Accepted revision converted', { document: await invoicesRepository.fromQuotation(getFirmId(req), actor(req), conversionSchema.parse(req.body), metadata(req)) })));
  if (scope === 'PROFORMA') router.post('/:id/convert', requirePermission(permissions.view), requirePermission(PERMISSIONS.INVOICES_CREATE), asyncHandler(async (req, res) => sendSuccess(res, 201, 'Proforma converted to invoice draft', { document: await invoicesRepository.fromProforma(getFirmId(req), actor(req), idSchema.parse(req.params).id, proformaConversionSchema.parse(req.body).idempotencyKey, metadata(req)) })));
  router.get('/:id', requirePermission(permissions.view), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Billing document retrieved', { document: await invoicesRepository.get(getFirmId(req), idSchema.parse(req.params).id, scope) })));
  router.patch('/:id', requirePermission(permissions.edit), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Draft updated', { document: await invoicesRepository.update(getFirmId(req), actor(req), idSchema.parse(req.params).id, invoiceUpdateSchema.parse(req.body), scope, metadata(req)) })));
  router.patch('/:id/custom-fields', requirePermission(permissions.edit), asyncHandler(async (req, res) => {
    const input = z.object({ expectedVersion: z.number().int().positive(), values: customFieldValuesSchema, refresh: z.boolean().default(false) }).strict().parse(req.body);
    return sendSuccess(res, 200, 'Custom values saved', { document: await invoicesRepository.updateCustomValues(getFirmId(req), actor(req), idSchema.parse(req.params).id, scope, input.expectedVersion, input.values, input.refresh, metadata(req)) });
  }));
  router.post('/:id/issue', requirePermission(permissions.issue), asyncHandler(async (req, res) => {
    const input = issueSchema.parse(req.body);
    return sendSuccess(res, 200, 'Document issued', { document: await invoicesRepository.issue(getFirmId(req), actor(req), idSchema.parse(req.params).id, input.expectedVersion, input.confirmedTotal, scope, metadata(req)) });
  }));
  router.post('/:id/void', requirePermission(permissions.void), asyncHandler(async (req, res) => {
    const input = voidSchema.parse(req.body);
    return sendSuccess(res, 200, 'Document voided', { document: await invoicesRepository.void(getFirmId(req), actor(req), idSchema.parse(req.params).id, input.expectedVersion, input.reason, scope, metadata(req)) });
  }));
  router.get('/:id/documents', requirePermission(permissions.documents), asyncHandler(async (req, res) => sendSuccess(res, 200, 'PDF history retrieved', { documents: await documentsRepository.list(getFirmId(req), idSchema.parse(req.params).id, scope) })));
  router.post('/:id/pdf', requirePermission(permissions.documents), asyncHandler(async (req, res) => sendSuccess(res, 201, 'PDF created', { document: await documentsRepository.generate(getFirmId(req), actor(req), idSchema.parse(req.params).id, scope, metadata(req)) })));
  for (const disposition of ['preview', 'download'] as const) router.get(`/:id/documents/:documentId/${disposition}`, requirePermission(permissions.documents), asyncHandler(async (req, res) => {
    const { id, documentId } = idSchema.parse(req.params);
    const file = await documentsRepository.download(getFirmId(req), id, documentId!, scope);
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `${disposition === 'preview' ? 'inline' : 'attachment'}; filename="${file.filename}"`);
    return res.send(file.buffer);
  }));
  return router;
}
export const invoicesRouter = createDocumentRouter('INVOICE');
export const proformasRouter = createDocumentRouter('PROFORMA');
export const billingAdjustmentsRouter = createDocumentRouter('ADJUSTMENT');
export const billingSettingsRouter = Router();
billingSettingsRouter.use(requireAuthentication, requireFirmContext);
billingSettingsRouter.get('/', requirePermission(PERMISSIONS.INVOICES_VIEW, PERMISSIONS.INVOICES_CREATE, PERMISSIONS.INVOICES_EDIT, PERMISSIONS.PROFORMAS_VIEW, PERMISSIONS.PROFORMAS_MANAGE, PERMISSIONS.ADJUSTMENTS_VIEW, PERMISSIONS.ADJUSTMENTS_MANAGE, PERMISSIONS.INVOICE_FIELDS_MANAGE, PERMISSIONS.BILLING_SETTINGS_MANAGE), asyncHandler(async (req, res) => sendSuccess(res, 200, 'Billing configuration retrieved', { ...await invoiceSettingsRepository.get(getFirmId(req)), states: INDIA_STATES })));
billingSettingsRouter.put('/', requirePermission(PERMISSIONS.BILLING_SETTINGS_MANAGE), asyncHandler(async (req, res) => {
  const input = fiscalSettingsUpdateSchema.parse(req.body);
  return sendSuccess(res, 200, 'Fiscal configuration saved', await invoiceSettingsRepository.update(getFirmId(req), actor(req), input.expectedVersion, input.config, PERMISSIONS.BILLING_SETTINGS_MANAGE, metadata(req)));
}));
billingSettingsRouter.put('/fields', requirePermission(PERMISSIONS.INVOICE_FIELDS_MANAGE), asyncHandler(async (req, res) => {
  const input = invoiceFieldsUpdateSchema.parse(req.body);
  return sendSuccess(res, 200, 'Custom-field configuration saved', await invoiceSettingsRepository.update(getFirmId(req), actor(req), input.expectedVersion, { customFields: input.customFields }, PERMISSIONS.INVOICE_FIELDS_MANAGE, metadata(req)));
}));
