import { AppError } from '../../core/errors/AppError.js';
import { calendarDate } from '../../core/validation/calendar-date.js';

// GST state master; historical codes 25/28 are not offered for new documents.
export const INDIA_STATES: Readonly<Record<string, string>> = Object.freeze({
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
});
const utgstStates = new Set(['04', '26', '31', '35', '38']);
export function assertStateCode(code: string) {
  if (!Object.hasOwn(INDIA_STATES, code)) throw new AppError('Choose a supported Indian state or union territory', 400);
  return code;
}
export function domesticGstMode(sellerState: string, placeOfSupply: string) {
  assertStateCode(sellerState); assertStateCode(placeOfSupply);
  return { taxMode: sellerState === placeOfSupply ? 'CGST_SGST' as const : 'IGST' as const, localTaxLabel: utgstStates.has(sellerState) ? 'UTGST' as const : 'SGST' as const };
}
export function isValidGstin(value: string) {
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(value) || !Object.hasOwn(INDIA_STATES, value.slice(0, 2))) return false;
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let factor = 2; let sum = 0;
  for (let i = 13; i >= 0; i--) {
    const product = alphabet.indexOf(value[i]!) * factor;
    sum += Math.floor(product / 36) + product % 36;
    factor = factor === 2 ? 1 : 2;
  }
  return alphabet[(36 - sum % 36) % 36] === value[14];
}
export function indiaToday(now = new Date()) {
  return calendarDate(now, 'Asia/Kolkata');
}
export function financialYear(date: string) {
  const year = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 4 ? year : year - 1;
  return { period: `FY:${start}:4`, label: `${String(start).slice(-2)}${String(start + 1).slice(-2)}`, start };
}
export function formatBillingNumber(prefix: string, date: string, sequence: bigint) {
  if (!/^[A-Z0-9]{1,4}$/.test(prefix) || sequence < 1n || sequence > 999999n) throw new AppError('Billing number series exhausted or invalid', 409);
  return `${prefix}/${financialYear(date).label}/${String(sequence).padStart(6, '0')}`;
}
export function assertCreditReductionEligibility(sourceDate: string, issueDate: string, eligibility: { gstReductionEligible: boolean; annualReturnFiledAt: string | null; recipientItcReversalConfirmed: boolean }, registeredBuyer: boolean) {
  const deadline = `${financialYear(sourceDate).start + 1}-11-30`;
  if (!eligibility.gstReductionEligible || issueDate > deadline || (eligibility.annualReturnFiledAt !== null && eligibility.annualReturnFiledAt <= issueDate) || (registeredBuyer && !eligibility.recipientItcReversalConfirmed)) {
    throw new AppError('GST-reducing credit note is ineligible: confirm the statutory deadline, annual return and recipient ITC reversal; use a separately reviewed commercial adjustment otherwise', 409);
  }
}
