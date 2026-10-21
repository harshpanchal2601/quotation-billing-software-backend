import { bankDetailsRepository } from './bank-details/bank-details.repository.js';
import { businessProfileRepository } from './business-profile/business-profile.repository.js';

/** Narrow read boundary for Quotation PDF/email consumers. Returns raw profile record. */
export async function getBusinessProfileRecordForQuotation(firmId: number) {
  return businessProfileRepository.getOrCreateBusinessProfile(firmId);
}

/** Narrow read boundary for Quotation PDF consumers. Returns raw default/fallback bank record. */
export async function getDefaultBankDetailRecordForQuotation(firmId: number) {
  return bankDetailsRepository.getDefaultBankDetailRecord(firmId);
}
