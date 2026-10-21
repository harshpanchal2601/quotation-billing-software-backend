import { describe, expect, it } from 'vitest';

import {
  findLatestCompanyCodeSequence,
  formatCompanyCode,
  parseCompanyCodeSequence,
} from '../src/modules/companies/code/company-code.js';

describe('company code helpers', () => {
  it('formats padded company codes with the COMP- prefix', () => {
    expect(formatCompanyCode(1)).toBe('COMP-000001');
    expect(formatCompanyCode(123456)).toBe('COMP-123456');
  });

  it('parses valid sequences and ignores malformed codes when finding the latest', () => {
    expect(parseCompanyCodeSequence('COMP-000010')).toBe(10);
    expect(parseCompanyCodeSequence('INVALID')).toBeNull();

    expect(
      findLatestCompanyCodeSequence([
        { companyCode: 'COMP-bad' },
        { companyCode: 'COMP-000005' },
        { companyCode: 'COMP-000003' },
      ]),
    ).toBe(5);
  });
});
