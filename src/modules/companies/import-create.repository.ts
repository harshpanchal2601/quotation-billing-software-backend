import type { Prisma } from '@prisma/client';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { jsonObject } from '../../core/serialization/json.js';
import type { RequestMetadata } from '../../core/audit/audit-log.service.js';
import { companiesRepository } from './companies.repository.js';
import type { CompanyCreateInput } from './companies.schema.js';

export async function createCompanyForImport(tx: Prisma.TransactionClient, firmId: number, input: CompanyCreateInput, metadata: RequestMetadata) {
  const company = await companiesRepository.createCompanyInTransaction(tx, firmId, input, metadata);
  return { id: company.id, updatedAt: company.updatedAt, fingerprint: requestHash(jsonObject(company)) };
}
