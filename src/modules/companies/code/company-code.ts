const COMPANY_CODE_PREFIX = 'COMP-';
const COMPANY_CODE_WIDTH = 6;

export function formatCompanyCode(sequence: number) {
  return `${COMPANY_CODE_PREFIX}${String(sequence).padStart(COMPANY_CODE_WIDTH, '0')}`;
}

export function findLatestCompanyCodeSequence(companies: Array<{ companyCode: string }>) {
  for (const company of companies) {
    const sequence = parseCompanyCodeSequence(company.companyCode);
    if (sequence !== null) return sequence;
  }
  return 0;
}

export function parseCompanyCodeSequence(companyCode: string | undefined) {
  if (companyCode === undefined) return null;
  const match = /^COMP-(\d+)$/.exec(companyCode);
  if (match === null) return null;
  return Number(match[1]);
}
