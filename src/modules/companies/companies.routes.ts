import { Router, type Request, type Response } from 'express';

import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { getFirmId, requireFirmContext } from '../../core/tenancy/tenant-context.js';
import { requireAuthentication, requirePermission } from '../auth/auth.middleware.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { companyAddressesRepository } from './company-addresses.repository.js';
import { companyContactsRepository } from './company-contacts.repository.js';
import { companiesRepository } from './companies.repository.js';
import {
  companyAddressCreateSchema,
  companyAddressParamSchema,
  companyAddressUpdateSchema,
  companyChildParamSchema,
  companyContactCreateSchema,
  companyContactParamSchema,
  companyContactUpdateSchema,
  companyCreateSchema,
  companyListQuerySchema,
  companyStatusSchema,
  companyUpdateSchema,
  idParamSchema,
  quotationHistoryQuerySchema,
} from './companies.schema.js';

export const companiesRouter = Router();

function metadata(req: Request) {
  return {
    userId: req.user?.id,
    firmId: req.firmId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

export async function listCompanies(req: Request, res: Response) {
  const query = companyListQuerySchema.parse(req.query);
  const data = await companiesRepository.listCompanies(getFirmId(req), query);
  return sendSuccess(res, 200, 'Companies retrieved successfully', data);
}

export async function createCompany(req: Request, res: Response) {
  const input = companyCreateSchema.parse(req.body);
  const company = await companiesRepository.createCompany(getFirmId(req), input, metadata(req));
  return sendSuccess(res, 201, 'Company created successfully', { company });
}

export async function getCompany(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const company = await companiesRepository.getCompany(getFirmId(req), id);
  return sendSuccess(res, 200, 'Company retrieved successfully', { company });
}

export async function updateCompany(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const input = companyUpdateSchema.parse(req.body);
  const company = await companiesRepository.updateCompany(getFirmId(req), id, input, metadata(req));
  return sendSuccess(res, 200, 'Company updated successfully', { company });
}

export async function updateCompanyStatus(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const { isActive } = companyStatusSchema.parse(req.body);
  const company = await companiesRepository.updateCompanyStatus(getFirmId(req), id, isActive, metadata(req));
  return sendSuccess(res, 200, 'Company status updated successfully', { company });
}

export async function deleteCompany(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  await companiesRepository.deleteCompany(getFirmId(req), id, metadata(req));
  return sendSuccess(res, 200, 'Company deleted successfully', null);
}

export async function restoreCompany(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const company = await companiesRepository.restoreCompany(getFirmId(req), id, metadata(req));
  return sendSuccess(res, 200, 'Company restored successfully', { company });
}

export async function listCompanyQuotations(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const query = quotationHistoryQuerySchema.parse(req.query);
  const data = await companiesRepository.listCompanyQuotations(getFirmId(req), id, query);
  return sendSuccess(res, 200, 'Company quotations retrieved successfully', data);
}

export async function createCompanyContact(req: Request, res: Response) {
  const { companyId } = companyChildParamSchema.parse(req.params);
  const input = companyContactCreateSchema.parse(req.body);
  const contact = await companyContactsRepository.createContact(getFirmId(req), companyId, input, metadata(req));
  return sendSuccess(res, 201, 'Company contact created successfully', { contact });
}

export async function updateCompanyContact(req: Request, res: Response) {
  const { companyId, contactId } = companyContactParamSchema.parse(req.params);
  const input = companyContactUpdateSchema.parse(req.body);
  const contact = await companyContactsRepository.updateContact(getFirmId(req), companyId, contactId, input, metadata(req));
  return sendSuccess(res, 200, 'Company contact updated successfully', { contact });
}

export async function deleteCompanyContact(req: Request, res: Response) {
  const { companyId, contactId } = companyContactParamSchema.parse(req.params);
  await companyContactsRepository.deleteContact(getFirmId(req), companyId, contactId, metadata(req));
  return sendSuccess(res, 200, 'Company contact deleted successfully', null);
}

export async function setPrimaryCompanyContact(req: Request, res: Response) {
  const { companyId, contactId } = companyContactParamSchema.parse(req.params);
  const contact = await companyContactsRepository.setPrimaryContact(getFirmId(req), companyId, contactId, metadata(req));
  return sendSuccess(res, 200, 'Primary company contact updated successfully', { contact });
}

export async function createCompanyAddress(req: Request, res: Response) {
  const { companyId } = companyChildParamSchema.parse(req.params);
  const input = companyAddressCreateSchema.parse(req.body);
  const address = await companyAddressesRepository.createAddress(getFirmId(req), companyId, input, metadata(req));
  return sendSuccess(res, 201, 'Company address created successfully', { address });
}

export async function updateCompanyAddress(req: Request, res: Response) {
  const { companyId, addressId } = companyAddressParamSchema.parse(req.params);
  const input = companyAddressUpdateSchema.parse(req.body);
  const address = await companyAddressesRepository.updateAddress(getFirmId(req), companyId, addressId, input, metadata(req));
  return sendSuccess(res, 200, 'Company address updated successfully', { address });
}

export async function deleteCompanyAddress(req: Request, res: Response) {
  const { companyId, addressId } = companyAddressParamSchema.parse(req.params);
  await companyAddressesRepository.deleteAddress(getFirmId(req), companyId, addressId, metadata(req));
  return sendSuccess(res, 200, 'Company address deleted successfully', null);
}

export async function setPrimaryCompanyAddress(req: Request, res: Response) {
  const { companyId, addressId } = companyAddressParamSchema.parse(req.params);
  const address = await companyAddressesRepository.setPrimaryAddress(getFirmId(req), companyId, addressId, metadata(req));
  return sendSuccess(res, 200, 'Primary company address updated successfully', { address });
}

companiesRouter.use(requireAuthentication, requireFirmContext);

companiesRouter.get(
  '/',
  requirePermission(PERMISSIONS.COMPANIES_VIEW, PERMISSIONS.QUOTATIONS_CREATE, PERMISSIONS.QUOTATIONS_EDIT),
  asyncHandler(listCompanies),
);
companiesRouter.post('/', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(createCompany));
companiesRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.COMPANIES_VIEW, PERMISSIONS.QUOTATIONS_CREATE, PERMISSIONS.QUOTATIONS_EDIT),
  asyncHandler(getCompany),
);
companiesRouter.put('/:id', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(updateCompany));
companiesRouter.patch('/:id/status', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(updateCompanyStatus));
companiesRouter.delete('/:id', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(deleteCompany));
companiesRouter.patch('/:id/restore', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(restoreCompany));
companiesRouter.get('/:id/quotations', requirePermission(PERMISSIONS.COMPANIES_VIEW), asyncHandler(listCompanyQuotations));

companiesRouter.post('/:companyId/contacts', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(createCompanyContact));
companiesRouter.put('/:companyId/contacts/:contactId', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(updateCompanyContact));
companiesRouter.delete('/:companyId/contacts/:contactId', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(deleteCompanyContact));
companiesRouter.patch('/:companyId/contacts/:contactId/primary', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(setPrimaryCompanyContact));

companiesRouter.post('/:companyId/addresses', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(createCompanyAddress));
companiesRouter.put('/:companyId/addresses/:addressId', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(updateCompanyAddress));
companiesRouter.delete('/:companyId/addresses/:addressId', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(deleteCompanyAddress));
companiesRouter.patch('/:companyId/addresses/:addressId/primary', requirePermission(PERMISSIONS.COMPANIES_MANAGE), asyncHandler(setPrimaryCompanyAddress));
