import { UserRole } from '@prisma/client';
import { Router, type Request, type Response } from 'express';

import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { requireAuthentication, requireRole } from '../auth/auth.middleware.js';
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
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

export async function listCompanies(req: Request, res: Response) {
  const query = companyListQuerySchema.parse(req.query);
  const data = await companiesRepository.listCompanies(query);
  return sendSuccess(res, 200, 'Companies retrieved successfully', data);
}

export async function createCompany(req: Request, res: Response) {
  const input = companyCreateSchema.parse(req.body);
  const company = await companiesRepository.createCompany(input, metadata(req));
  return sendSuccess(res, 201, 'Company created successfully', { company });
}

export async function getCompany(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const company = await companiesRepository.getCompany(id);
  return sendSuccess(res, 200, 'Company retrieved successfully', { company });
}

export async function updateCompany(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const input = companyUpdateSchema.parse(req.body);
  const company = await companiesRepository.updateCompany(id, input, metadata(req));
  return sendSuccess(res, 200, 'Company updated successfully', { company });
}

export async function updateCompanyStatus(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const { isActive } = companyStatusSchema.parse(req.body);
  const company = await companiesRepository.updateCompanyStatus(id, isActive, metadata(req));
  return sendSuccess(res, 200, 'Company status updated successfully', { company });
}

export async function deleteCompany(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  await companiesRepository.deleteCompany(id, metadata(req));
  return sendSuccess(res, 200, 'Company deleted successfully', null);
}

export async function restoreCompany(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const company = await companiesRepository.restoreCompany(id, metadata(req));
  return sendSuccess(res, 200, 'Company restored successfully', { company });
}

export async function listCompanyQuotations(req: Request, res: Response) {
  const { id } = idParamSchema.parse(req.params);
  const query = quotationHistoryQuerySchema.parse(req.query);
  const data = await companiesRepository.listCompanyQuotations(id, query);
  return sendSuccess(res, 200, 'Company quotations retrieved successfully', data);
}

export async function createCompanyContact(req: Request, res: Response) {
  const { companyId } = companyChildParamSchema.parse(req.params);
  const input = companyContactCreateSchema.parse(req.body);
  const contact = await companyContactsRepository.createContact(companyId, input, metadata(req));
  return sendSuccess(res, 201, 'Company contact created successfully', { contact });
}

export async function updateCompanyContact(req: Request, res: Response) {
  const { companyId, contactId } = companyContactParamSchema.parse(req.params);
  const input = companyContactUpdateSchema.parse(req.body);
  const contact = await companyContactsRepository.updateContact(companyId, contactId, input, metadata(req));
  return sendSuccess(res, 200, 'Company contact updated successfully', { contact });
}

export async function deleteCompanyContact(req: Request, res: Response) {
  const { companyId, contactId } = companyContactParamSchema.parse(req.params);
  await companyContactsRepository.deleteContact(companyId, contactId, metadata(req));
  return sendSuccess(res, 200, 'Company contact deleted successfully', null);
}

export async function setPrimaryCompanyContact(req: Request, res: Response) {
  const { companyId, contactId } = companyContactParamSchema.parse(req.params);
  const contact = await companyContactsRepository.setPrimaryContact(companyId, contactId, metadata(req));
  return sendSuccess(res, 200, 'Primary company contact updated successfully', { contact });
}

export async function createCompanyAddress(req: Request, res: Response) {
  const { companyId } = companyChildParamSchema.parse(req.params);
  const input = companyAddressCreateSchema.parse(req.body);
  const address = await companyAddressesRepository.createAddress(companyId, input, metadata(req));
  return sendSuccess(res, 201, 'Company address created successfully', { address });
}

export async function updateCompanyAddress(req: Request, res: Response) {
  const { companyId, addressId } = companyAddressParamSchema.parse(req.params);
  const input = companyAddressUpdateSchema.parse(req.body);
  const address = await companyAddressesRepository.updateAddress(companyId, addressId, input, metadata(req));
  return sendSuccess(res, 200, 'Company address updated successfully', { address });
}

export async function deleteCompanyAddress(req: Request, res: Response) {
  const { companyId, addressId } = companyAddressParamSchema.parse(req.params);
  await companyAddressesRepository.deleteAddress(companyId, addressId, metadata(req));
  return sendSuccess(res, 200, 'Company address deleted successfully', null);
}

export async function setPrimaryCompanyAddress(req: Request, res: Response) {
  const { companyId, addressId } = companyAddressParamSchema.parse(req.params);
  const address = await companyAddressesRepository.setPrimaryAddress(companyId, addressId, metadata(req));
  return sendSuccess(res, 200, 'Primary company address updated successfully', { address });
}

companiesRouter.use(requireAuthentication, requireRole(UserRole.ADMIN));

companiesRouter.get('/', asyncHandler(listCompanies));
companiesRouter.post('/', asyncHandler(createCompany));
companiesRouter.get('/:id', asyncHandler(getCompany));
companiesRouter.put('/:id', asyncHandler(updateCompany));
companiesRouter.patch('/:id/status', asyncHandler(updateCompanyStatus));
companiesRouter.delete('/:id', asyncHandler(deleteCompany));
companiesRouter.patch('/:id/restore', asyncHandler(restoreCompany));
companiesRouter.get('/:id/quotations', asyncHandler(listCompanyQuotations));

companiesRouter.post('/:companyId/contacts', asyncHandler(createCompanyContact));
companiesRouter.put('/:companyId/contacts/:contactId', asyncHandler(updateCompanyContact));
companiesRouter.delete('/:companyId/contacts/:contactId', asyncHandler(deleteCompanyContact));
companiesRouter.patch('/:companyId/contacts/:contactId/primary', asyncHandler(setPrimaryCompanyContact));

companiesRouter.post('/:companyId/addresses', asyncHandler(createCompanyAddress));
companiesRouter.put('/:companyId/addresses/:addressId', asyncHandler(updateCompanyAddress));
companiesRouter.delete('/:companyId/addresses/:addressId', asyncHandler(deleteCompanyAddress));
companiesRouter.patch('/:companyId/addresses/:addressId/primary', asyncHandler(setPrimaryCompanyAddress));
