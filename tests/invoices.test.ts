import { describe, expect, it } from 'vitest';
import { calculateInvoiceLines, type InvoiceFinancialPolicy } from '../src/modules/invoices/invoice-calculations.js';
import { assertCreditReductionEligibility, domesticGstMode, financialYear, formatBillingNumber, indiaToday, isValidGstin } from '../src/modules/invoices/india-gst.js';
import { validateCustomFieldValues } from '../src/modules/invoices/invoice-fields.js';
import { customFieldDefinitionsSchema, customValuesUpdateSchema, fieldHistoryQuerySchema, invoiceDraftSchema, type InvoiceLineInput } from '../src/modules/invoices/invoices.schema.js';
import { expandAssignablePermissions, PERMISSIONS } from '../src/modules/auth/permissions.js';
import { evaluateFeature, type EntitlementContext } from '../src/modules/entitlements/entitlement-evaluator.js';

const policy: InvoiceFinancialPolicy = { version: 1, businessPolicyVersion: 0, currency: 'INR', rounding: 'HALF_UP', grandTotal: 'MINOR_UNIT', registration: 'REGULAR', sellerStateCode: '24', taxMode: 'CGST_SGST', localTaxLabel: 'SGST' };
const line: InvoiceLineInput = { itemName: 'Consulting', supplyType: 'SERVICE', hsnCode: '998311', measurementUnit: 'HOUR', quantity: '1', unitRate: '100.10', discountType: 'NONE', discountValue: '0', taxRate: '18' };
const fields = customFieldDefinitionsSchema.parse([
  { key: 'cf_order', label: 'Purchase order', type: 'TEXT', required: true, showOnPdf: true, width: 'FULL' },
  { key: 'cf_inspected', label: 'Inspected', type: 'BOOLEAN', required: true, showOnPdf: false, width: 'HALF' },
  { key: 'cf_date', label: 'Delivery date', type: 'DATE', required: false, showOnPdf: true, width: 'HALF' },
  { key: 'cf_project', label: 'Project', type: 'SELECT', required: false, showOnPdf: true, width: 'HALF', options: ['A', 'B'] },
  { key: 'cf_decimal', label: 'Reading', type: 'NUMBER', required: false, showOnPdf: true, width: 'HALF' },
]);
describe('billing Decimal and Indian state policy', () => {
  it('validates reviewed settings versions while preserving existing draft-value updates', () => {
    expect(customValuesUpdateSchema.parse({ expectedVersion: 2, values: {}, refresh: true, expectedSettingsVersion: 0 }).expectedSettingsVersion).toBe(0);
    expect(customValuesUpdateSchema.parse({ expectedVersion: 2, values: {} })).toEqual({ expectedVersion: 2, values: {}, refresh: false });
    expect(customValuesUpdateSchema.safeParse({ expectedVersion: 2, values: {}, expectedSettingsVersion: 3 }).success).toBe(false);
    expect(customValuesUpdateSchema.safeParse({ expectedVersion: 2, values: {}, refresh: true, expectedSettingsVersion: -1 }).success).toBe(false);
    expect(customValuesUpdateSchema.safeParse({ expectedVersion: 2, values: {}, refresh: true, expectedSettingsVersion: 3, firmId: 9 }).success).toBe(false);
  });
  it('accepts only supported server-side field-history ordering', () => {
    expect(fieldHistoryQuerySchema.parse({})).toEqual({ page: 1, sortBy: 'version', sortOrder: 'desc' });
    expect(fieldHistoryQuerySchema.parse({ page: '2', sortBy: 'createdAt', sortOrder: 'asc' })).toEqual({ page: 2, sortBy: 'createdAt', sortOrder: 'asc' });
    expect(fieldHistoryQuerySchema.safeParse({ sortBy: 'values' }).success).toBe(false);
    expect(fieldHistoryQuerySchema.safeParse({ sortOrder: 'arbitrary' }).success).toBe(false);
  });
  it('keeps exact service totals and reconciles split tax down to the paisa', () => {
    expect(calculateInvoiceLines([line], policy)).toMatchObject({ subtotal: '100.10', taxAmount: '18.02', grandTotal: '118.12', lines: [{ cgstAmount: '9.01', sgstAmount: '9.01' }] });
    expect(calculateInvoiceLines([{ ...line, unitRate: '0.05', taxRate: '5' }], policy).grandTotal).toBe('0.05');
    const oddTax = calculateInvoiceLines([{ ...line, unitRate: '0.10', taxRate: '5' }], policy);
    expect(oddTax.lines[0]).toMatchObject({ cgstAmount: '0.01', sgstAmount: '0.00', taxAmount: '0.01', lineTotal: '0.11' });
  });
  it('handles three-decimal currencies without binary floating point or GST leakage', () => {
    const result = calculateInvoiceLines([{ ...line, unitRate: '0.101', taxRate: '0', quantity: '3' }], { ...policy, currency: 'KWD', registration: 'UNREGISTERED', taxMode: 'NONE' });
    expect(result.grandTotal).toBe('0.303');
    expect(() => calculateInvoiceLines([line], { ...policy, currency: 'USD' })).toThrow('requires INR');
    expect(() => calculateInvoiceLines([{ ...line, unitRate: '1.001' }], policy)).toThrow('precision');
  });
  it('validates discounts instead of clamping incorrect financial input', () => {
    expect(calculateInvoiceLines([{ ...line, discountType: 'PERCENTAGE', discountValue: '10' }], policy)).toMatchObject({ discountAmount: '10.01', taxableAmount: '90.09', taxAmount: '16.22', grandTotal: '106.31' });
    expect(() => calculateInvoiceLines([{ ...line, discountType: 'PERCENTAGE', discountValue: '101' }], policy)).toThrow('100');
    expect(() => calculateInvoiceLines([{ ...line, discountType: 'FIXED', discountValue: '101' }], policy)).toThrow('exceed');
    expect(() => calculateInvoiceLines([{ ...line, discountValue: '1' }], policy)).toThrow('type');
  });
  it('keeps whole-unit rounding explicit and preserves negative round off', () => {
    expect(calculateInvoiceLines([line], { ...policy, grandTotal: 'WHOLE_UNIT' })).toMatchObject({ grandTotal: '118.00', roundOffAmount: '-0.12' });
  });
  it.each([['24', '24', 'CGST_SGST', 'SGST'], ['24', '27', 'IGST', 'SGST'], ['04', '04', 'CGST_SGST', 'UTGST'], ['38', '38', 'CGST_SGST', 'UTGST'], ['07', '07', 'CGST_SGST', 'SGST']])('selects domestic GST for %s → %s', (seller, buyer, mode, local) => {
    expect(domesticGstMode(seller!, buyer!)).toEqual({ taxMode: mode, localTaxLabel: local });
  });
  it('rejects retired/unsupported state codes', () => { expect(() => domesticGstMode('25', '24')).toThrow(); expect(() => domesticGstMode('24', '99')).toThrow(); });
  it('validates GSTIN structure, state and checksum', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false);
    expect(isValidGstin('99AAPFU0939F1ZV')).toBe(false);
  });
  it('allocates compact unique financial-year numbers at the Indian date boundary', () => {
    expect(indiaToday(new Date('2026-03-31T18:30:00Z'))).toBe('2026-04-01');
    expect(financialYear('2026-03-31').label).toBe('2526');
    expect(formatBillingNumber('ABCD', '2026-04-01', 999999n)).toHaveLength(16);
    expect(() => formatBillingNumber('INV', '2026-04-01', 1000000n)).toThrow('exhausted');
  });
  it('enforces GST credit deadline and recipient ITC conditions', () => {
    const confirmed = { gstReductionEligible: true, annualReturnFiledAt: null, recipientItcReversalConfirmed: true };
    expect(() => assertCreditReductionEligibility('2025-04-01', '2026-11-30', confirmed, true)).not.toThrow();
    expect(() => assertCreditReductionEligibility('2025-04-01', '2026-12-01', confirmed, true)).toThrow('ineligible');
    expect(() => assertCreditReductionEligibility('2025-04-01', '2026-10-01', { ...confirmed, annualReturnFiledAt: '2026-09-30' }, true)).toThrow();
    expect(() => assertCreditReductionEligibility('2025-04-01', '2026-10-01', { ...confirmed, recipientItcReversalConfirmed: false }, true)).toThrow();
  });
});
describe('firm-defined fields and delegated design', () => {
  it('allows incomplete drafts but requires an answer, including false, at issuance', () => {
    expect(validateCustomFieldValues(fields, {}, false)).toMatchObject({ cf_order: null });
    expect(() => validateCustomFieldValues(fields, {}, true)).toThrow('required');
    expect(validateCustomFieldValues(fields, { cf_order: 'PO-1', cf_inspected: false }, true)).toMatchObject({ cf_inspected: false });
  });
  it.each([{ cf_date: '2026-02-30' }, { cf_project: 'C' }, { cf_inspected: 'true' }, { cf_decimal: '1e8' }, { total: '0' }])('rejects typed-value/unknown-field abuse %j', (values) => { expect(() => validateCustomFieldValues(fields, values, false)).toThrow(); });
  it('preserves exact decimal strings and escapes only at rendering', () => {
    expect(validateCustomFieldValues(fields, { cf_decimal: '9007199254740993.000001', cf_order: '<script>bad()</script>' }, false)).toMatchObject({ cf_decimal: '9007199254740993.000001', cf_order: '<script>bad()</script>' });
  });
  it('reserves core namespaces, rejects duplicate keys and validates selection choices', () => {
    expect(customFieldDefinitionsSchema.safeParse([{ ...fields[0], key: 'grandTotal' }]).success).toBe(false);
    expect(customFieldDefinitionsSchema.safeParse([fields[0], fields[0]]).success).toBe(false);
    expect(customFieldDefinitionsSchema.safeParse([{ ...fields[3], options: ['A', 'A'] }]).success).toBe(false);
  });
  it('requires explicit field-design delegation and never delegates fiscal or role administration', () => {
    expect(expandAssignablePermissions([PERMISSIONS.INVOICES_EDIT])).not.toContain(PERMISSIONS.INVOICE_FIELDS_MANAGE);
    expect(expandAssignablePermissions([PERMISSIONS.INVOICE_FIELDS_MANAGE])).toContain(PERMISSIONS.INVOICES_VIEW);
    expect(expandAssignablePermissions([PERMISSIONS.BILLING_SETTINGS_MANAGE, PERMISSIONS.ROLES_MANAGE])).toEqual([]);
  });
  it('does not accept client tenancy, status or document-number overrides', () => {
    const draft = { companyId: 1, billingAddressId: 2, invoiceDate: '2026-10-27', supply: { placeOfSupplyStateCode: '24', placeOfSupplyBasis: 'GOODS_MOVEMENT' }, lines: [line], idempotencyKey: 'fixture-key' };
    expect(invoiceDraftSchema.safeParse(draft).success).toBe(true);
    for (const extra of [{ firmId: 2 }, { status: 'ISSUED' }, { documentNumber: 'FRAUD' }]) expect(invoiceDraftSchema.safeParse({ ...draft, ...extra }).success).toBe(false);
  });
  it('requires explicit billing entitlement even for legacy administrators', () => {
    const context: EntitlementContext = { firmActive: true, legacy: true, subscription: null, features: new Set(), hardDisabled: new Set(), overrides: [], now: new Date() };
    expect(evaluateFeature(context, 'billing.invoices').allowed).toBe(false);
    expect(evaluateFeature({ ...context, features: new Set(['billing.invoices']) }, 'billing.invoices', false).reason).toBe('RBAC_DENIED');
  });
});
