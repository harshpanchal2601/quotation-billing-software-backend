import { UserRole } from '@prisma/client';
import { Router } from 'express';

import { requireAuthentication, requireRole } from '../../core/auth/authentication.middleware.js';
import {
  createCompany,
  createCompanyAddress,
  createCompanyContact,
  deleteCompany,
  deleteCompanyAddress,
  deleteCompanyContact,
  getCompany,
  listCompanies,
  listCompanyQuotations,
  restoreCompany,
  setPrimaryCompanyAddress,
  setPrimaryCompanyContact,
  updateCompany,
  updateCompanyAddress,
  updateCompanyContact,
  updateCompanyStatus,
} from './companies.controller.js';

export const companiesRouter = Router();

companiesRouter.use(requireAuthentication, requireRole(UserRole.ADMIN));

companiesRouter.get('/', listCompanies);
companiesRouter.post('/', createCompany);
companiesRouter.get('/:id', getCompany);
companiesRouter.put('/:id', updateCompany);
companiesRouter.patch('/:id/status', updateCompanyStatus);
companiesRouter.delete('/:id', deleteCompany);
companiesRouter.patch('/:id/restore', restoreCompany);
companiesRouter.get('/:id/quotations', listCompanyQuotations);

companiesRouter.post('/:companyId/contacts', createCompanyContact);
companiesRouter.put('/:companyId/contacts/:contactId', updateCompanyContact);
companiesRouter.delete('/:companyId/contacts/:contactId', deleteCompanyContact);
companiesRouter.patch('/:companyId/contacts/:contactId/primary', setPrimaryCompanyContact);

companiesRouter.post('/:companyId/addresses', createCompanyAddress);
companiesRouter.put('/:companyId/addresses/:addressId', updateCompanyAddress);
companiesRouter.delete('/:companyId/addresses/:addressId', deleteCompanyAddress);
companiesRouter.patch('/:companyId/addresses/:addressId/primary', setPrimaryCompanyAddress);
