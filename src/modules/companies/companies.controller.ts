import type { Request, Response } from 'express';

import { prisma } from '../../core/database/prisma.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import { CompanyAddressesService } from './company-addresses.service.js';
import { CompanyContactsService } from './company-contacts.service.js';
import { CompaniesService } from './companies.service.js';
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
} from './companies.validation.js';

const companiesService = new CompaniesService(prisma);
const contactsService = new CompanyContactsService(prisma);
const addressesService = new CompanyAddressesService(prisma);

function metadata(req: Request) {
  return {
    userId: req.user?.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  };
}

export const listCompanies = asyncHandler(async (req: Request, res: Response) => {
  const query = companyListQuerySchema.parse(req.query);
  const data = await companiesService.listCompanies(query);
  return sendSuccess(res, 200, 'Companies retrieved successfully', data);
});

export const createCompany = asyncHandler(async (req: Request, res: Response) => {
  const input = companyCreateSchema.parse(req.body);
  const company = await companiesService.createCompany(input, metadata(req));
  return sendSuccess(res, 201, 'Company created successfully', { company });
});

export const getCompany = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const company = await companiesService.getCompany(id);
  return sendSuccess(res, 200, 'Company retrieved successfully', { company });
});

export const updateCompany = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const input = companyUpdateSchema.parse(req.body);
  const company = await companiesService.updateCompany(id, input, metadata(req));
  return sendSuccess(res, 200, 'Company updated successfully', { company });
});

export const updateCompanyStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { isActive } = companyStatusSchema.parse(req.body);
  const company = await companiesService.updateCompanyStatus(id, isActive, metadata(req));
  return sendSuccess(res, 200, 'Company status updated successfully', { company });
});

export const deleteCompany = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  await companiesService.deleteCompany(id, metadata(req));
  return sendSuccess(res, 200, 'Company deleted successfully', null);
});

export const restoreCompany = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const company = await companiesService.restoreCompany(id, metadata(req));
  return sendSuccess(res, 200, 'Company restored successfully', { company });
});

export const listCompanyQuotations = asyncHandler(async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const query = quotationHistoryQuerySchema.parse(req.query);
  const data = await companiesService.listCompanyQuotations(id, query);
  return sendSuccess(res, 200, 'Company quotations retrieved successfully', data);
});

export const createCompanyContact = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = companyChildParamSchema.parse(req.params);
  const input = companyContactCreateSchema.parse(req.body);
  const contact = await contactsService.createContact(companyId, input, metadata(req));
  return sendSuccess(res, 201, 'Company contact created successfully', { contact });
});

export const updateCompanyContact = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, contactId } = companyContactParamSchema.parse(req.params);
  const input = companyContactUpdateSchema.parse(req.body);
  const contact = await contactsService.updateContact(companyId, contactId, input, metadata(req));
  return sendSuccess(res, 200, 'Company contact updated successfully', { contact });
});

export const deleteCompanyContact = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, contactId } = companyContactParamSchema.parse(req.params);
  await contactsService.deleteContact(companyId, contactId, metadata(req));
  return sendSuccess(res, 200, 'Company contact deleted successfully', null);
});

export const setPrimaryCompanyContact = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, contactId } = companyContactParamSchema.parse(req.params);
  const contact = await contactsService.setPrimaryContact(companyId, contactId, metadata(req));
  return sendSuccess(res, 200, 'Primary company contact updated successfully', { contact });
});

export const createCompanyAddress = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = companyChildParamSchema.parse(req.params);
  const input = companyAddressCreateSchema.parse(req.body);
  const address = await addressesService.createAddress(companyId, input, metadata(req));
  return sendSuccess(res, 201, 'Company address created successfully', { address });
});

export const updateCompanyAddress = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, addressId } = companyAddressParamSchema.parse(req.params);
  const input = companyAddressUpdateSchema.parse(req.body);
  const address = await addressesService.updateAddress(companyId, addressId, input, metadata(req));
  return sendSuccess(res, 200, 'Company address updated successfully', { address });
});

export const deleteCompanyAddress = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, addressId } = companyAddressParamSchema.parse(req.params);
  await addressesService.deleteAddress(companyId, addressId, metadata(req));
  return sendSuccess(res, 200, 'Company address deleted successfully', null);
});

export const setPrimaryCompanyAddress = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, addressId } = companyAddressParamSchema.parse(req.params);
  const address = await addressesService.setPrimaryAddress(companyId, addressId, metadata(req));
  return sendSuccess(res, 200, 'Primary company address updated successfully', { address });
});
