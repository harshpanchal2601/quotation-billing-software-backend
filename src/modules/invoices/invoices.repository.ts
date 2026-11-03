import { createHash } from 'node:crypto';
import { AuditAction, Prisma, type BillingDocumentKind, type PrismaClient } from '@prisma/client';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { currencyCode, decimal, money } from '../../core/money/index.js';
import { reserveDocumentSequence } from '../../core/sequences/index.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS, type Permission } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction, type FeatureKey } from '../entitlements/index.js';
import { resolveBusinessPolicy } from '../settings/index.js';
import { readAcceptedQuotationForBilling } from '../quotations/index.js';
import { calculateInvoiceLines, invoiceFinancialPolicySchema, lineSnapshotSchema, sumInvoiceLines, type InvoiceFinancialPolicy, type InvoiceLineSnapshot } from './invoice-calculations.js';
import { validateCustomFieldValues } from './invoice-fields.js';
import { readInvoiceSettings, InvoiceSettingsRepository } from './invoice-settings.repository.js';
import { assertCreditReductionEligibility, assertStateCode, domesticGstMode, financialYear, formatBillingNumber, indiaToday, isValidGstin, INDIA_STATES } from './india-gst.js';
import { customFieldDefinitionsSchema, type AdjustmentInput, type InvoiceDraftInput, type InvoiceUpdateInput, type InvoiceLineInput, type InvoiceListInput, type SupplyInput, type conversionSchema } from './invoices.schema.js';
import type { z } from 'zod';

export const invoiceInclude = { lines: { orderBy: { lineNumber: 'asc' as const } }, statusHistory: { orderBy: { version: 'asc' as const } } } satisfies Prisma.InvoiceInclude;
export type InvoiceRecord = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;
export type DocumentScope = 'INVOICE' | 'PROFORMA' | 'ADJUSTMENT';
export const billingAccess = {
  INVOICE: { feature: 'billing.invoices', view: PERMISSIONS.INVOICES_VIEW, create: PERMISSIONS.INVOICES_CREATE, edit: PERMISSIONS.INVOICES_EDIT, issue: PERMISSIONS.INVOICES_ISSUE, void: PERMISSIONS.INVOICES_VOID, documents: PERMISSIONS.INVOICES_DOCUMENTS },
  PROFORMA: { feature: 'billing.proforma', view: PERMISSIONS.PROFORMAS_VIEW, create: PERMISSIONS.PROFORMAS_MANAGE, edit: PERMISSIONS.PROFORMAS_MANAGE, issue: PERMISSIONS.PROFORMAS_MANAGE, void: PERMISSIONS.PROFORMAS_MANAGE, documents: PERMISSIONS.PROFORMAS_MANAGE },
  ADJUSTMENT: { feature: 'billing.adjustments', view: PERMISSIONS.ADJUSTMENTS_VIEW, create: PERMISSIONS.ADJUSTMENTS_MANAGE, edit: PERMISSIONS.ADJUSTMENTS_MANAGE, issue: PERMISSIONS.ADJUSTMENTS_MANAGE, void: PERMISSIONS.ADJUSTMENTS_MANAGE, documents: PERMISSIONS.ADJUSTMENTS_MANAGE },
} as const satisfies Record<DocumentScope, { feature: FeatureKey; view: Permission; create: Permission; edit: Permission; issue: Permission; void: Permission; documents: Permission }>;
export function kindsForScope(scope: DocumentScope): BillingDocumentKind[] { return scope === 'ADJUSTMENT' ? ['CREDIT_NOTE', 'DEBIT_NOTE'] : [scope]; }
export function scopeForKind(kind: BillingDocumentKind): DocumentScope { return kind === 'CREDIT_NOTE' || kind === 'DEBIT_NOTE' ? 'ADJUSTMENT' : kind; }
export function jsonObject(value: unknown): Prisma.InputJsonObject { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject; }
function requestHash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function dateOnly(value: Date | null) { return value?.toISOString().slice(0, 10) ?? null; }
export function serialiseInvoice(record: InvoiceRecord) {
  const scale = money('0', currencyCode(record.currency)).amount.split('.')[1]?.length ?? 0;
  return {
    id: record.id, firmId: record.firmId, kind: record.kind, status: record.status, version: record.version,
    documentNumber: record.documentNumber, invoiceDate: dateOnly(record.invoiceDate), dueDate: dateOnly(record.dueDate),
    companyId: record.companyId, customerReference: record.customerReference, paymentTerms: record.paymentTerms, notes: record.notes,
    currency: record.currency, buyerSnapshot: record.buyerSnapshot, sellerSnapshot: record.sellerSnapshot, bankSnapshot: record.bankSnapshot,
    financialPolicySnapshot: record.financialPolicySnapshot, supplySnapshot: record.supplySnapshot,
    customFieldSchema: record.customFieldSchema, customFieldValues: record.customFieldValues, presentationSnapshot: record.presentationSnapshot,
    sourceSnapshot: record.sourceSnapshot, sourceQuotationId: record.sourceQuotationId, sourceProformaId: record.sourceProformaId, sourceInvoiceId: record.sourceInvoiceId,
    adjustmentReason: record.adjustmentReason, issuedAt: record.issuedAt?.toISOString() ?? null, voidedAt: record.voidedAt?.toISOString() ?? null, voidReason: record.voidReason,
    subtotal: record.subtotal.toFixed(scale), discountAmount: record.discountAmount.toFixed(scale), taxableAmount: record.taxableAmount.toFixed(scale), taxAmount: record.taxAmount.toFixed(scale),
    roundOffAmount: record.roundOffAmount.toFixed(scale), grandTotal: record.grandTotal.toFixed(scale),
    lines: record.lines.map((line) => lineSnapshotSchema.parse(line.snapshot)),
    statusHistory: record.statusHistory.map((entry) => ({ version: entry.version, fromStatus: entry.fromStatus, toStatus: entry.toStatus, changedById: entry.changedById, changedAt: entry.changedAt.toISOString() })),
    createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
    postingEffect: record.status !== 'ISSUED' || record.kind === 'PROFORMA' ? 'NONE' : record.kind === 'CREDIT_NOTE' ? 'CREDIT' : 'DEBIT',
  };
}
export class InvoicesRepository {
  constructor(readonly db: PrismaClient) {}
  async authorize(tx: Prisma.TransactionClient, firmId: number, actorId: number, scope: DocumentScope, action: keyof Omit<(typeof billingAccess)['INVOICE'], 'feature'>) {
    await authorizeFirmJobActor(tx, firmId, actorId, billingAccess[scope][action]);
    await assertTransactionFeature(tx, firmId, billingAccess[scope].feature);
  }
  async find(tx: Prisma.TransactionClient | PrismaClient, firmId: number, id: number, scope: DocumentScope) {
    const row = await tx.invoice.findFirst({ where: { id, firmId, kind: { in: kindsForScope(scope) } }, include: invoiceInclude });
    if (row === null) throw new AppError('Billing document not found', 404);
    return row;
  }
  async get(firmId: number, id: number, scope: DocumentScope) {
    await assertTransactionFeature(this.db, firmId, billingAccess[scope].feature);
    return serialiseInvoice(await this.find(this.db, firmId, id, scope));
  }
  async list(firmId: number, scope: DocumentScope, query: InvoiceListInput) {
    await assertTransactionFeature(this.db, firmId, billingAccess[scope].feature);
    const where: Prisma.InvoiceWhereInput = {
      firmId, kind: { in: kindsForScope(scope) }, status: query.status, companyId: query.companyId,
      ...(query.dateFrom || query.dateTo ? { invoiceDate: { ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}), ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}) } } : {}),
      ...(query.search ? { OR: [{ documentNumber: { contains: query.search } }, { customerReference: { contains: query.search } }, { company: { firmId, name: { contains: query.search } } }] } : {}),
    };
    const [documents, total] = await this.db.$transaction([
      this.db.invoice.findMany({ where, orderBy: [{ [query.sortBy]: query.sortOrder }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit, include: invoiceInclude }),
      this.db.invoice.count({ where }),
    ]);
    return { documents: documents.map(serialiseInvoice), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }
  async options(firmId: number, type: 'customers' | 'items', search: string, limit: number) {
    await assertTransactionFeature(this.db, firmId, 'billing.invoices');
    if (type === 'customers') return this.db.company.findMany({ where: { firmId, deletedAt: null, isActive: true, name: { contains: search } }, select: { id: true, name: true, gstin: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: limit });
    await assertTransactionFeature(this.db, firmId, 'items');
    const items = await this.db.item.findMany({ where: { firmId, deletedAt: null, isActive: true, name: { contains: search }, measurementUnit: { firmId, deletedAt: null, isActive: true } }, include: { measurementUnit: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: limit });
    return items.map((item) => ({ id: item.id, name: item.name, itemCode: item.itemCode, unitRate: item.defaultRate.toFixed(2), taxRate: item.gstRate.toFixed(2), hsnCode: item.hsnCode, measurementUnit: item.measurementUnit.symbol }));
  }
  async customerAddresses(firmId: number, companyId: number) {
    await assertTransactionFeature(this.db, firmId, 'billing.invoices');
    const company = await this.db.company.findFirst({ where: { id: companyId, firmId, isActive: true, deletedAt: null }, select: { id: true, addresses: { where: { deletedAt: null }, orderBy: { id: 'asc' } } } });
    if (!company) throw new AppError('Customer unavailable', 404);
    return company.addresses;
  }
  async policy(tx: Prisma.TransactionClient, firmId: number, supply: SupplyInput) {
    const settings = await readInvoiceSettings(tx, firmId);
    const { registration, sellerStateCode } = settings.config;
    if (registration === 'UNCONFIGURED' || sellerStateCode === null) throw new AppError('Ask a firm admin to configure billing registration and seller state first', 409);
    assertStateCode(supply.placeOfSupplyStateCode);
    if (registration === 'COMPOSITION' && supply.placeOfSupplyStateCode !== sellerStateCode) throw new AppError('Inter-state outward supplies require review of composition eligibility', 409);
    const business = await resolveBusinessPolicy(tx, firmId);
    const tax = domesticGstMode(sellerStateCode, supply.placeOfSupplyStateCode);
    const policy: InvoiceFinancialPolicy = { version: 1, businessPolicyVersion: business.version, currency: business.policy.currency, rounding: business.policy.rounding, grandTotal: business.policy.grandTotal, registration, sellerStateCode, taxMode: registration === 'REGULAR' && !supply.isExempt ? tax.taxMode : 'NONE', localTaxLabel: tax.localTaxLabel };
    return { settings, policy };
  }
  private async buyer(tx: Prisma.TransactionClient, firmId: number, input: Pick<InvoiceDraftInput, 'companyId' | 'billingAddressId' | 'shippingAddressId'>) {
    const company = await tx.company.findFirst({ where: { id: input.companyId, firmId, deletedAt: null, isActive: true } });
    if (!company) throw new AppError('Customer unavailable', 404);
    const address = async (id: number) => {
      const row = await tx.companyAddress.findFirst({ where: { id, companyId: company.id, deletedAt: null, company: { firmId } } });
      if (!row) throw new AppError('Customer address unavailable', 404);
      if (!['INDIA', 'IN'].includes(row.country.trim().toUpperCase())) throw new AppError('This wave supports domestic Indian supplies; exports require a separate workflow', 409);
      return { id: row.id, addressLine1: row.addressLine1, addressLine2: row.addressLine2, city: row.city, state: row.state, postalCode: row.postalCode, country: row.country };
    };
    return { name: company.name, legalName: company.legalName, gstin: company.gstin, pan: company.pan, billingAddress: await address(input.billingAddressId), shippingAddress: input.shippingAddressId ? await address(input.shippingAddressId) : null };
  }
  private async enrichLines(tx: Prisma.TransactionClient, firmId: number, lines: InvoiceLineInput[]) {
    const ids = [...new Set(lines.flatMap((line) => line.itemId ? [line.itemId] : []))];
    if (ids.length > 0) await assertTransactionFeature(tx, firmId, 'items');
    const items = ids.length === 0 ? [] : await tx.item.findMany({ where: { id: { in: ids }, firmId, deletedAt: null, isActive: true }, include: { measurementUnit: true } });
    const byId = new Map(items.map((item) => [item.id, item]));
    const enriched = lines.map((line) => {
      if (!line.itemId) return line;
      const item = byId.get(line.itemId);
      if (!item || item.measurementUnit.firmId !== firmId || !item.measurementUnit.isActive || item.measurementUnit.deletedAt !== null) throw new AppError('Catalog item unavailable', 404);
      if (!item.measurementUnit.allowDecimal && !decimal(line.quantity).isInteger()) throw new AppError(`Quantity for ${item.measurementUnit.symbol} must be a whole number`, 400);
      return { ...line, itemName: line.itemName ?? item.name, description: line.description ?? item.shortDescription, hsnCode: line.hsnCode ?? item.hsnCode, measurementUnit: item.measurementUnit.symbol };
    });
    return { lines: enriched, codes: new Map(items.map((item) => [item.id, item.itemCode])) };
  }
  private async audit(tx: Prisma.TransactionClient, firmId: number, actorId: number, record: InvoiceRecord, action: AuditAction, metadata: RequestMetadata, previous?: InvoiceRecord) {
    await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'BillingDocument', entityId: String(record.id), action, policy: 'REQUIRED', ...(previous ? { oldValues: jsonObject(serialiseInvoice(previous)) } : {}), newValues: jsonObject(serialiseInvoice(record)) });
  }
  private async history(tx: Prisma.TransactionClient, firmId: number, id: number, version: number, actorId: number, fromStatus: 'DRAFT' | 'ISSUED' | 'VOID' | null, toStatus: 'DRAFT' | 'ISSUED' | 'VOID') {
    await tx.invoiceStatusHistory.create({ data: { firmId, invoiceId: id, version, changedById: actorId, fromStatus, toStatus } });
  }
  async preview(firmId: number, actorId: number, input: InvoiceDraftInput, scope: DocumentScope) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, scope, 'create');
      await this.buyer(tx, firmId, input);
      const { policy } = await this.policy(tx, firmId, input.supply);
      const enriched = await this.enrichLines(tx, firmId, input.lines);
      return { currency: policy.currency, financialPolicy: policy, ...calculateInvoiceLines(enriched.lines, policy, enriched.codes) };
    });
  }
  async create(firmId: number, actorId: number, input: InvoiceDraftInput, scope: 'INVOICE' | 'PROFORMA', metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, scope, 'create');
      const hash = requestHash({ scope, input });
      const previous = await tx.invoice.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey: input.idempotencyKey } }, include: invoiceInclude });
      if (previous) {
        if (previous.requestHash !== hash) throw new AppError('Idempotency key was used for a different request', 409);
        return serialiseInvoice(previous);
      }
      const buyer = await this.buyer(tx, firmId, input);
      const { settings, policy } = await this.policy(tx, firmId, input.supply);
      const enriched = await this.enrichLines(tx, firmId, input.lines);
      const { lines, ...totals } = calculateInvoiceLines(enriched.lines, policy, enriched.codes);
      const customFieldValues = validateCustomFieldValues(settings.config.customFields, input.customFieldValues, false);
      const row = await tx.invoice.create({ data: {
        firmId, kind: scope, companyId: input.companyId, invoiceDate: new Date(input.invoiceDate), dueDate: input.dueDate ? new Date(input.dueDate) : null,
        customerReference: input.customerReference, paymentTerms: input.paymentTerms ?? settings.config.paymentInstructions, notes: input.notes,
        currency: policy.currency, buyerSnapshot: buyer, financialPolicySnapshot: jsonObject(policy), supplySnapshot: jsonObject(input.supply),
        customFieldSchema: settings.config.customFields, customFieldValues, presentationSnapshot: jsonObject(settings.config),
        ...totals, idempotencyKey: input.idempotencyKey, requestHash: hash, createdById: actorId, updatedById: actorId,
        lines: { create: lines.map((line) => ({ itemId: line.itemId, lineNumber: line.lineNumber, snapshot: jsonObject(line) })) },
      }, include: invoiceInclude });
      await this.history(tx, firmId, row.id, 1, actorId, null, 'DRAFT');
      const record = await this.find(tx, firmId, row.id, scope);
      await this.audit(tx, firmId, actorId, record, AuditAction.CREATE, metadata);
      return serialiseInvoice(record);
    });
  }
  async update(firmId: number, actorId: number, id: number, input: InvoiceUpdateInput, scope: DocumentScope, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, scope, 'edit');
      const old = await this.find(tx, firmId, id, scope);
      if (old.status !== 'DRAFT' || old.version !== input.expectedVersion) throw new AppError('Only the current draft version can be edited; reload', 409);
      if (old.sourceQuotationId || old.sourceProformaId || old.sourceInvoiceId) throw new AppError('Source-derived document values are locked; create a new manual draft for changes', 409);
      const buyer = await this.buyer(tx, firmId, input);
      const { policy, settings } = await this.policy(tx, firmId, input.supply);
      const enriched = await this.enrichLines(tx, firmId, input.lines);
      const { lines, ...totals } = calculateInvoiceLines(enriched.lines, policy, enriched.codes);
      const fields = input.refreshCustomFields ? settings.config.customFields : customFieldDefinitionsSchema.parse(old.customFieldSchema);
      const values = validateCustomFieldValues(fields, input.customFieldValues, false);
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id, firmId } });
      const updated = await tx.invoice.updateMany({ where: { id, firmId, status: 'DRAFT', version: input.expectedVersion }, data: {
        companyId: input.companyId, invoiceDate: new Date(input.invoiceDate), dueDate: input.dueDate ? new Date(input.dueDate) : null,
        customerReference: input.customerReference ?? null, paymentTerms: input.paymentTerms ?? null, notes: input.notes ?? null,
        buyerSnapshot: buyer, currency: policy.currency, financialPolicySnapshot: jsonObject(policy), supplySnapshot: jsonObject(input.supply),
        customFieldSchema: fields, customFieldValues: values, presentationSnapshot: jsonObject(settings.config), ...totals, version: { increment: 1 }, updatedById: actorId,
      } });
      if (updated.count !== 1) throw new AppError('Draft changed; reload before editing', 409);
      await tx.invoiceLine.createMany({ data: lines.map((line) => ({ invoiceId: id, firmId, itemId: line.itemId, lineNumber: line.lineNumber, snapshot: jsonObject(line) })) });
      await this.history(tx, firmId, id, old.version + 1, actorId, 'DRAFT', 'DRAFT');
      const record = await this.find(tx, firmId, id, scope);
      await this.audit(tx, firmId, actorId, record, AuditAction.UPDATE, metadata, old);
      return serialiseInvoice(record);
    });
  }
  async issue(firmId: number, actorId: number, id: number, expectedVersion: number, confirmedTotal: string, scope: DocumentScope, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, scope, 'issue');
      const old = await this.find(tx, firmId, id, scope);
      if (old.status === 'ISSUED' && old.version === expectedVersion + 1 && old.grandTotal.eq(confirmedTotal)) return serialiseInvoice(old);
      if (old.status !== 'DRAFT' || old.version !== expectedVersion) throw new AppError('Only the current draft can be issued; reload', 409);
      if (!old.grandTotal.eq(confirmedTotal)) throw new AppError('Displayed total changed; reload before issuing', 409);
      if (old.sourceQuotationId) await readAcceptedQuotationForBilling(tx, firmId, old.sourceQuotationId);
      if (old.sourceProformaId && (await this.find(tx, firmId, old.sourceProformaId, 'PROFORMA')).status !== 'ISSUED') throw new AppError('Source proforma is no longer eligible', 409);
      const policy = invoiceFinancialPolicySchema.parse(old.financialPolicySnapshot);
      const lines = old.lines.map((line) => lineSnapshotSchema.parse(line.snapshot));
      const fields = customFieldDefinitionsSchema.parse(old.customFieldSchema);
      validateCustomFieldValues(fields, old.customFieldValues as Record<string, string | boolean | null>, true);
      const settings = await readInvoiceSettings(tx, firmId);
      if (settings.config.registration !== policy.registration || settings.config.sellerStateCode !== policy.sellerStateCode || settings.config.einvoiceRequired === null) throw new AppError('Fiscal configuration changed; review a new draft', 409);
      const buyer = old.buyerSnapshot as Prisma.JsonObject;
      if (policy.registration === 'REGULAR' && policy.taxMode !== 'NONE' && old.kind !== 'PROFORMA' && settings.config.einvoiceRequired && buyer.gstin) throw new AppError('This supply requires IRN registration. E-invoice provider integration is required before fiscal issuance', 409, { code: 'EINVOICE_PROVIDER_REQUIRED' });
      if (buyer.gstin && !isValidGstin(String(buyer.gstin))) throw new AppError('Buyer GSTIN is invalid', 400);
      if (lines.some((line) => !line.itemName.trim() || (policy.registration !== 'UNREGISTERED' && !/^\d{4}(?:\d{2})?(?:\d{2})?$/.test(line.hsnCode ?? '')))) throw new AppError('Every registered supply requires a valid HSN/SAC and description', 400);
      const extras = this.sourceExtraCharges(old);
      const totals = sumInvoiceLines(lines, policy, extras);
      for (const key of ['subtotal', 'discountAmount', 'taxableAmount', 'taxAmount', 'roundOffAmount', 'grandTotal'] as const) if (!old[key].eq(totals[key])) throw new AppError('Stored totals are inconsistent; review the draft', 409);
      for (const line of lines) {
        if (!decimal(line.baseAmount).sub(line.discountAmount).eq(line.taxableAmount) || !decimal(line.cgstAmount).add(line.sgstAmount).add(line.igstAmount).eq(line.taxAmount) || !decimal(line.taxableAmount).add(line.taxAmount).eq(line.lineTotal)) throw new AppError('Stored line totals are inconsistent', 409);
      }
      const profile = await tx.businessProfile.findUnique({ where: { firmId } });
      if (!profile || !profile.legalName.trim() || !profile.addressLine1.trim() || !profile.city.trim() || !profile.postalCode.trim()) throw new AppError('Complete the seller legal profile first', 409);
      if (policy.registration !== 'UNREGISTERED' && (!profile.gstin || !isValidGstin(profile.gstin) || profile.gstin.slice(0, 2) !== policy.sellerStateCode)) throw new AppError('Seller GSTIN must be valid and match the configured registration state', 409);
      const today = indiaToday();
      if (old.dueDate && dateOnly(old.dueDate)! < today) throw new AppError('Due date precedes issuance; update the draft', 409);
      if (old.sourceInvoiceId) {
        const source = await this.find(tx, firmId, old.sourceInvoiceId, 'INVOICE');
        if (source.status !== 'ISSUED') throw new AppError('Adjustment source must remain an issued invoice', 409);
        if (old.kind === 'CREDIT_NOTE') {
          const eligibility = (old.sourceSnapshot as Prisma.JsonObject).eligibility as { gstReductionEligible: boolean; annualReturnFiledAt: string | null; recipientItcReversalConfirmed: boolean };
          if (policy.registration === 'REGULAR') assertCreditReductionEligibility(dateOnly(source.invoiceDate)!, today, eligibility, Boolean(buyer.gstin));
          await this.assertCreditCapacity(tx, firmId, source, lines);
        }
      }
      const sequence = await reserveDocumentSequence(tx, { firmId, documentType: old.kind, period: financialYear(today).period });
      const documentNumber = formatBillingNumber(settings.config.prefixes[old.kind], today, sequence);
      const bank = await tx.bankDetail.findFirst({ where: { businessProfileId: profile.id, deletedAt: null, isDefault: true }, orderBy: { id: 'asc' } });
      let seller = jsonObject({ legalName: profile.legalName, displayName: profile.displayName, gstin: policy.registration === 'UNREGISTERED' ? null : profile.gstin, pan: profile.pan, addressLine1: profile.addressLine1, addressLine2: profile.addressLine2, city: profile.city, state: profile.state, stateCode: policy.sellerStateCode, stateName: INDIA_STATES[policy.sellerStateCode], postalCode: profile.postalCode, country: profile.country, phone: profile.primaryPhone, email: profile.primaryEmail });
      if (old.sourceInvoiceId) {
        const source = await this.find(tx, firmId, old.sourceInvoiceId, 'INVOICE');
        const originalSeller = source.sellerSnapshot as Prisma.JsonObject;
        if (originalSeller.gstin !== seller.gstin) throw new AppError('Adjustment seller registration differs from its original invoice', 409);
        seller = jsonObject(originalSeller);
      }
      const bankSnapshot = bank ? { bankName: bank.bankName, accountName: bank.accountName, accountNumber: bank.accountNumber, ifscCode: bank.ifscCode, branchName: bank.branchName, swiftCode: bank.swiftCode, upiId: bank.upiId } : null;
      const snapshot = jsonObject({ ...serialiseInvoice(old), status: 'ISSUED', documentNumber, invoiceDate: today, version: old.version + 1, sellerSnapshot: seller, bankSnapshot });
      const updated = await tx.invoice.updateMany({ where: { id, firmId, version: expectedVersion, status: 'DRAFT' }, data: { status: 'ISSUED', version: { increment: 1 }, documentNumber, period: financialYear(today).period, invoiceDate: new Date(today), sellerSnapshot: seller, bankSnapshot: bankSnapshot ?? Prisma.JsonNull, issueSnapshot: snapshot, issuedAt: new Date(), updatedById: actorId } });
      if (updated.count !== 1) throw new AppError('Draft changed during issuance', 409);
      await this.history(tx, firmId, id, old.version + 1, actorId, 'DRAFT', 'ISSUED');
      const record = await this.find(tx, firmId, id, scope);
      await this.audit(tx, firmId, actorId, record, AuditAction.STATUS_CHANGE, metadata, old);
      return serialiseInvoice(record);
    });
  }
  async updateCustomValues(firmId: number, actorId: number, id: number, scope: DocumentScope, expectedVersion: number, input: Record<string, string | boolean | null>, refresh: boolean, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, scope, 'edit');
      const old = await this.find(tx, firmId, id, scope);
      if (old.status !== 'DRAFT' || old.version !== expectedVersion) throw new AppError('Only the current draft custom values can be edited', 409);
      const fields = refresh ? (await readInvoiceSettings(tx, firmId)).config.customFields : customFieldDefinitionsSchema.parse(old.customFieldSchema);
      const values = validateCustomFieldValues(fields, input, false);
      await tx.invoice.updateMany({ where: { id, firmId, status: 'DRAFT', version: expectedVersion }, data: { customFieldSchema: fields, customFieldValues: values, version: { increment: 1 }, updatedById: actorId } });
      await this.history(tx, firmId, id, old.version + 1, actorId, 'DRAFT', 'DRAFT');
      const row = await this.find(tx, firmId, id, scope);
      await this.audit(tx, firmId, actorId, row, AuditAction.UPDATE, metadata, old);
      return serialiseInvoice(row);
    });
  }
  private sourceExtraCharges(record: InvoiceRecord) {
    const source = record.sourceSnapshot as Prisma.JsonObject | null;
    return typeof source?.extraCharges === 'string' ? source.extraCharges : '0';
  }
  async void(firmId: number, actorId: number, id: number, expectedVersion: number, reason: string, scope: DocumentScope, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, scope, 'void');
      const old = await this.find(tx, firmId, id, scope);
      if (old.status !== 'ISSUED' || old.version !== expectedVersion) throw new AppError('Only the current issued document can be voided', 409);
      if (scope === 'ADJUSTMENT') throw new AppError('Issued adjustment notes require a compensating document; originals are preserved', 409);
      if (indiaToday(old.issuedAt!) !== indiaToday()) throw new AppError('Only an unreported document cancelled on its issue date can be voided; use an adjustment otherwise', 409);
      const dependants = await tx.invoice.count({ where: { firmId, OR: [{ sourceInvoiceId: id }, { sourceProformaId: id }] } });
      if (dependants > 0) throw new AppError('A document with adjustments or a conversion cannot be voided', 409);
      await tx.invoice.updateMany({ where: { id, firmId, status: 'ISSUED', version: expectedVersion }, data: { status: 'VOID', version: { increment: 1 }, voidedAt: new Date(), voidReason: reason, updatedById: actorId } });
      await this.history(tx, firmId, id, old.version + 1, actorId, 'ISSUED', 'VOID');
      const record = await this.find(tx, firmId, id, scope);
      await this.audit(tx, firmId, actorId, record, AuditAction.STATUS_CHANGE, metadata, old);
      return serialiseInvoice(record);
    });
  }
  private async assertCreditCapacity(tx: Prisma.TransactionClient, firmId: number, source: InvoiceRecord, requested: InvoiceLineSnapshot[]) {
    const notes = await tx.invoice.findMany({ where: { firmId, sourceInvoiceId: source.id, status: 'ISSUED' }, include: { lines: true } });
    for (const line of requested) {
      const original = source.lines.map((entry) => lineSnapshotSchema.parse(entry.snapshot)).find((entry) => entry.lineNumber === line.sourceLineNumber);
      if (!original) throw new AppError('Adjustment line does not reference its source invoice', 400);
      for (const field of ['taxableAmount', 'cgstAmount', 'sgstAmount', 'igstAmount'] as const) {
        let available = decimal(original[field]);
        for (const note of notes) for (const stored of note.lines) {
          const previous = lineSnapshotSchema.parse(stored.snapshot);
          if (previous.sourceLineNumber === original.lineNumber) available = note.kind === 'DEBIT_NOTE' ? available.add(previous[field]) : available.sub(previous[field]);
        }
        if (decimal(line[field]).gt(available)) throw new AppError('Credit exceeds the unadjusted source line amount or tax', 409);
      }
    }
  }
  private async derivedDraft(tx: Prisma.TransactionClient, firmId: number, actorId: number, idempotencyKey: string, hash: string, data: Omit<Prisma.InvoiceUncheckedCreateInput, 'firmId' | 'idempotencyKey' | 'requestHash' | 'createdById' | 'updatedById' | 'lines'>, lines: InvoiceLineSnapshot[], metadata: RequestMetadata) {
    const record = await tx.invoice.create({ data: {
      ...data, firmId, idempotencyKey, requestHash: hash, createdById: actorId, updatedById: actorId,
      lines: { create: lines.map((line) => ({ lineNumber: line.lineNumber, itemId: line.itemId, snapshot: jsonObject(line) })) },
    }, include: invoiceInclude });
    await this.history(tx, firmId, record.id, 1, actorId, null, 'DRAFT');
    const result = await this.find(tx, firmId, record.id, scopeForKind(record.kind));
    await this.audit(tx, firmId, actorId, result, AuditAction.CREATE, metadata);
    return serialiseInvoice(result);
  }
  private async replay(tx: Prisma.TransactionClient, firmId: number, idempotencyKey: string, hash: string) {
    const existing = await tx.invoice.findUnique({ where: { firmId_idempotencyKey: { firmId, idempotencyKey } }, include: invoiceInclude });
    if (!existing) return null;
    if (existing.requestHash !== hash) throw new AppError('Idempotency key was used for a different request', 409);
    return serialiseInvoice(existing);
  }
  async fromQuotation(firmId: number, actorId: number, input: z.infer<typeof conversionSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, 'INVOICE', 'create');
      await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.QUOTATIONS_VIEW);
      await assertTransactionFeature(tx, firmId, 'quotations');
      const hash = requestHash({ operation: 'quotation', input });
      const replay = await this.replay(tx, firmId, input.idempotencyKey, hash);
      if (replay) return replay;
      const source = await readAcceptedQuotationForBilling(tx, firmId, input.sourceRevisionId);
      if (await tx.invoice.findUnique({ where: { firmId_sourceQuotationId: { firmId, sourceQuotationId: source.id } } })) throw new AppError('This accepted revision already has an invoice', 409);
      const { policy, settings } = await this.policy(tx, firmId, input.supply);
      if (policy.taxMode !== source.taxMode || (policy.registration === 'REGULAR' && source.currency !== 'INR')) throw new AppError('Accepted quotation tax mode is incompatible with the invoice registration/place of supply; review a new quotation revision', 409);
      if (!source.billingAddressSnapshot) throw new AppError('Accepted quotation has no billing address; review a new quotation revision', 409);
      currencyCode(source.currency);
      const metadataByLine = new Map(input.lineMetadata.map((line) => [line.lineNumber, line]));
      if (metadataByLine.size !== input.lineMetadata.length || input.lineMetadata.length !== source.items.length || source.items.some((line) => !metadataByLine.has(line.lineNumber))) throw new AppError('Provide HSN/SAC and goods/service metadata for each exact source line', 400);
      const lines: InvoiceLineSnapshot[] = source.items.map((line) => {
        const tax = source.taxMode === 'CGST_SGST' ? line.taxAmount.div(2).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : new Prisma.Decimal(0);
        return { lineNumber: line.lineNumber, itemId: line.itemId, itemCode: line.itemCodeSnapshot, itemName: line.itemNameSnapshot, description: line.descriptionSnapshot,
          hsnCode: metadataByLine.get(line.lineNumber)!.hsnCode, supplyType: metadataByLine.get(line.lineNumber)!.supplyType,
          measurementUnit: line.measurementUnitSnapshot, quantity: line.quantity.toFixed(3), unitRate: line.unitRate.toFixed(2), discountType: line.discountType, discountValue: line.discountValue.toFixed(2),
          taxRate: line.gstRate.toFixed(2), baseAmount: line.baseAmount.toFixed(2), discountAmount: line.discountAmount.toFixed(2), taxableAmount: line.taxableAmount.toFixed(2), taxAmount: line.taxAmount.toFixed(2),
          cgstAmount: tax.toFixed(2), sgstAmount: source.taxMode === 'CGST_SGST' ? line.taxAmount.sub(tax).toFixed(2) : '0.00', igstAmount: source.taxMode === 'IGST' ? line.taxAmount.toFixed(2) : '0.00', lineTotal: line.lineTotal.toFixed(2) };
      });
      // Exact legacy quotation amounts and rounding are copied, not recalculated under new defaults.
      const financialPolicy: InvoiceFinancialPolicy = { ...policy, currency: source.currency, rounding: 'HALF_UP', grandTotal: 'WHOLE_UNIT' };
      const extraCharges = source.freightAmount.add(source.otherCharges).toFixed(2);
      const totals = sumInvoiceLines(lines, financialPolicy, extraCharges);
      if (!decimal(totals.grandTotal).eq(source.grandTotal)) throw new AppError('Accepted quotation totals are inconsistent', 409);
      const values = validateCustomFieldValues(settings.config.customFields, input.customFieldValues, false);
      return this.derivedDraft(tx, firmId, actorId, input.idempotencyKey, hash, {
        kind: 'INVOICE', companyId: source.companyId, invoiceDate: new Date(indiaToday()), currency: source.currency,
        buyerSnapshot: { name: source.companyNameSnapshot, legalName: source.companyNameSnapshot, gstin: source.companyGstinSnapshot, pan: source.companyPanSnapshot, billingAddress: source.billingAddressSnapshot, shippingAddress: source.shippingAddressSnapshot },
        financialPolicySnapshot: jsonObject(financialPolicy), supplySnapshot: jsonObject(input.supply), presentationSnapshot: jsonObject(settings.config),
        customFieldSchema: settings.config.customFields, customFieldValues: values, sourceQuotationId: source.id,
        sourceSnapshot: { quotationId: source.id, quotationNumber: source.quotationNumber, revisionNumber: source.revisionNumber, acceptedAt: source.acceptedAt?.toISOString() ?? null, extraCharges, quotationFinancialPolicy: source.financialPolicySnapshot, freightAmount: source.freightAmount.toFixed(2), otherCharges: source.otherCharges.toFixed(2), termsAndConditions: source.termsAndConditions, deliveryTerms: source.deliveryTerms, taxTerms: source.taxTerms },
        customerReference: source.customerReference, paymentTerms: source.paymentTerms, ...totals,
      }, lines, metadata);
    });
  }
  async fromProforma(firmId: number, actorId: number, sourceId: number, idempotencyKey: string, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, 'INVOICE', 'create');
      await this.authorize(tx, firmId, actorId, 'PROFORMA', 'view');
      const hash = requestHash({ operation: 'proforma', sourceId });
      const replay = await this.replay(tx, firmId, idempotencyKey, hash);
      if (replay) return replay;
      const source = await this.find(tx, firmId, sourceId, 'PROFORMA');
      if (source.status !== 'ISSUED') throw new AppError('Only an issued proforma can convert to an invoice', 409);
      if (await tx.invoice.findUnique({ where: { firmId_sourceProformaId: { firmId, sourceProformaId: sourceId } } })) throw new AppError('This proforma already has an invoice', 409);
      return this.derivedDraft(tx, firmId, actorId, idempotencyKey, hash, {
        kind: 'INVOICE', companyId: source.companyId, invoiceDate: new Date(indiaToday()), currency: source.currency,
        buyerSnapshot: jsonObject(source.buyerSnapshot), financialPolicySnapshot: jsonObject(source.financialPolicySnapshot), supplySnapshot: jsonObject(source.supplySnapshot),
        presentationSnapshot: jsonObject(source.presentationSnapshot), customFieldSchema: source.customFieldSchema!, customFieldValues: source.customFieldValues!,
        sourceProformaId: sourceId, sourceSnapshot: { proformaId: sourceId, proformaNumber: source.documentNumber, extraCharges: this.sourceExtraCharges(source) },
        customerReference: source.customerReference, paymentTerms: source.paymentTerms,
        subtotal: source.subtotal, discountAmount: source.discountAmount, taxableAmount: source.taxableAmount, taxAmount: source.taxAmount, roundOffAmount: source.roundOffAmount, grandTotal: source.grandTotal,
      }, source.lines.map((line) => lineSnapshotSchema.parse(line.snapshot)), metadata);
    });
  }
  async createAdjustment(firmId: number, actorId: number, input: AdjustmentInput, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, 'ADJUSTMENT', 'create');
      await this.authorize(tx, firmId, actorId, 'INVOICE', 'view');
      const hash = requestHash({ operation: 'adjustment', input });
      const replay = await this.replay(tx, firmId, input.idempotencyKey, hash);
      if (replay) return replay;
      const source = await this.find(tx, firmId, input.sourceInvoiceId, 'INVOICE');
      if (source.status !== 'ISSUED') throw new AppError('Adjustments require an issued invoice', 409);
      if (new Set(input.lines.map((line) => line.sourceLineNumber)).size !== input.lines.length) throw new AppError('Adjustment source lines must be unique', 400);
      const originals = source.lines.map((line) => lineSnapshotSchema.parse(line.snapshot));
      const policy = invoiceFinancialPolicySchema.parse(source.financialPolicySnapshot);
      const linesInput = input.lines.map((change) => {
        const line = originals.find((candidate) => candidate.lineNumber === change.sourceLineNumber);
        if (!line) throw new AppError('Adjustment line does not belong to its source invoice', 404);
        return { itemId: line.itemId, itemName: line.itemName, description: line.description, hsnCode: line.hsnCode, supplyType: line.supplyType, measurementUnit: line.measurementUnit, taxRate: line.taxRate, quantity: change.quantity, unitRate: change.unitRate, discountType: 'NONE' as const, discountValue: '0', sourceLineNumber: change.sourceLineNumber };
      });
      const { lines, ...totals } = calculateInvoiceLines(linesInput, policy, new Map(originals.flatMap((line) => line.itemId && line.itemCode ? [[line.itemId, line.itemCode] as const] : [])));
      if (input.kind === 'CREDIT_NOTE') await this.assertCreditCapacity(tx, firmId, source, lines);
      const { config } = await readInvoiceSettings(tx, firmId);
      const customFieldValues = validateCustomFieldValues(config.customFields, input.customFieldValues, false);
      return this.derivedDraft(tx, firmId, actorId, input.idempotencyKey, hash, {
        kind: input.kind, companyId: source.companyId, invoiceDate: new Date(indiaToday()), currency: source.currency,
        buyerSnapshot: jsonObject(source.buyerSnapshot), financialPolicySnapshot: jsonObject(policy), supplySnapshot: jsonObject(source.supplySnapshot), presentationSnapshot: jsonObject(config),
        customFieldSchema: config.customFields, customFieldValues, sourceInvoiceId: source.id, adjustmentReason: input.reason,
        sourceSnapshot: { invoiceId: source.id, invoiceNumber: source.documentNumber, invoiceDate: dateOnly(source.invoiceDate), eligibility: { gstReductionEligible: input.gstReductionEligible, annualReturnFiledAt: input.annualReturnFiledAt, recipientItcReversalConfirmed: input.recipientItcReversalConfirmed } }, ...totals,
      }, lines, metadata);
    });
  }
}
export const invoicesRepository = new InvoicesRepository(prisma);
export const invoiceSettingsRepository = new InvoiceSettingsRepository(prisma);
