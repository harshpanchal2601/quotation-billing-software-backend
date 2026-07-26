import { describe, expect, it } from 'vitest';

import {
  companyCreateSchema,
  companyListQuerySchema,
  quotationHistoryQuerySchema,
} from '../src/modules/companies/companies.validation.js';

describe('company validation', () => {
  it('normalises company input and rejects invalid GSTIN or PAN', () => {
    expect(() => companyCreateSchema.parse({ name: 'Acme Pharma', gstin: 'invalid' })).toThrow();
    expect(() => companyCreateSchema.parse({ name: 'Acme Pharma', pan: 'invalid' })).toThrow();

    expect(
      companyCreateSchema.parse({
        name: '  Acme Pharma  ',
        gstin: '24aamcb7736k1z9',
        pan: 'aamcb7736k',
        website: 'https://example.com',
      }),
    ).toMatchObject({
      name: 'Acme Pharma',
      gstin: '24AAMCB7736K1Z9',
      pan: 'AAMCB7736K',
      isActive: true,
    });
  });

  it('parses list filters safely and rejects invalid quotation date ranges', () => {
    expect(companyListQuerySchema.parse({ page: '2', limit: '50', isActive: 'false' })).toMatchObject({
      page: 2,
      limit: 50,
      isActive: false,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(() =>
      quotationHistoryQuerySchema.parse({
        dateFrom: '2026-02-01',
        dateTo: '2026-01-01',
      }),
    ).toThrow();
  });
});
