import { AuditAction, type Prisma, type PrismaClient } from '@prisma/client';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS, type Permission } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { AppError } from '../../core/errors/AppError.js';
import { invoiceSettingsSchema, type InvoiceSettings } from './invoice-settings.schema.js';
import { assertStateCode } from './india-gst.js';

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  schemaVersion: 1, registration: 'UNCONFIGURED', sellerStateCode: null, einvoiceRequired: null,
  prefixes: { INVOICE: 'INV', PROFORMA: 'PF', CREDIT_NOTE: 'CN', DEBIT_NOTE: 'DN' },
  template: 'STANDARD', primaryColour: '#168A56', paymentInstructions: '', termsAndConditions: '', customFields: [],
};
export async function readInvoiceSettings(db: PrismaClient | Prisma.TransactionClient, firmId: number) {
  const row = await db.invoiceSetting.findUnique({ where: { firmId } });
  return { version: row?.version ?? 0, config: invoiceSettingsSchema.parse(row?.config ?? DEFAULT_INVOICE_SETTINGS) };
}
export class InvoiceSettingsRepository {
  constructor(private readonly db: PrismaClient) {}
  async get(firmId: number) {
    await assertTransactionFeature(this.db, firmId, 'billing.invoices');
    return readInvoiceSettings(this.db, firmId);
  }
  async update(firmId: number, actorId: number, expectedVersion: number, change: { customFields: InvoiceSettings['customFields'] } | Omit<InvoiceSettings, 'customFields'>, permission: Permission, metadata: RequestMetadata) {
    // A fields delegate may never use this method to change fiscal configuration.
    const fieldsOnly = permission === PERMISSIONS.INVOICE_FIELDS_MANAGE;
    if (!fieldsOnly && permission !== PERMISSIONS.BILLING_SETTINGS_MANAGE) throw new AppError('Configuration permission unavailable', 403);
    if (fieldsOnly && (Object.keys(change).length !== 1 || !('customFields' in change))) throw new AppError('Only custom-field definitions may be changed', 403);
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorizeFirmJobActor(tx, firmId, actorId, permission);
      await assertTransactionFeature(tx, firmId, 'billing.invoices');
      const previous = await readInvoiceSettings(tx, firmId);
      if (previous.version !== expectedVersion) throw new AppError('Billing configuration changed; reload before saving', 409);
      const config = invoiceSettingsSchema.parse({ ...previous.config, ...change });
      if (config.sellerStateCode !== null) assertStateCode(config.sellerStateCode);
      if (config.registration !== 'UNCONFIGURED' && (config.sellerStateCode === null || config.einvoiceRequired === null)) throw new AppError('Select seller state and e-invoice applicability explicitly', 400);
      const version = previous.version + 1;
      await tx.invoiceSetting.upsert({ where: { firmId }, create: { firmId, version, config }, update: { version, config } });
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'InvoiceSetting', entityId: String(firmId), action: AuditAction.UPDATE, policy: 'REQUIRED', oldValues: { version: previous.version, config: previous.config }, newValues: { version, config } });
      return { version, config };
    });
  }
}
