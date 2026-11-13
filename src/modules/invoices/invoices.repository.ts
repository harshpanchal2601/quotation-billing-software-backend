import { createHash } from 'node:crypto';
import { AuditAction, Prisma, type BillingDocumentKind, type PrismaClient } from '@prisma/client';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { currencyCode, decimal, money } from '../../core/money/index.js';
import { reserveDocumentSequence } from '../../core/sequences/index.js';
import { jsonObject } from '../../core/serialization/json.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS, type Permission } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction, type FeatureKey } from '../entitlements/index.js';
import { resolveBusinessPolicy } from '../settings/index.js';
import { readAcceptedQuotationForBilling, customerQuotationSnapshot } from '../quotations/index.js';
import { readOrderForInvoicing } from '../sales-orders/index.js';
import { partialQuotationLine, quotationBillingLines } from './quotation-billing-lines.js';
import type { orderInvoiceSchema } from './invoices.schema.js';
import { calculateInvoiceLines, invoiceFinancialPolicySchema, lineSnapshotSchema, sumInvoiceLines, type InvoiceFinancialPolicy, type InvoiceLineSnapshot } from './invoice-calculations.js';
import { validateCustomFieldValues } from './invoice-fields.js';
import { readInvoiceSettings, InvoiceSettingsRepository } from './invoice-settings.repository.js';
import { assertCreditReductionEligibility, assertStateCode, domesticGstMode, financialYear, formatBillingNumber, indiaToday, isValidGstin, INDIA_STATES } from './india-gst.js';
import { customFieldDefinitionsSchema, type AdjustmentInput, type InvoiceDraftInput, type InvoiceUpdateInput, type InvoiceLineInput, type InvoiceListInput, type SupplyInput, type conversionSchema } from './invoices.schema.js';
import type { z } from 'zod';
import { readInvoiceSettlement } from './invoice-settlement.repository.js';
import { recordInvoiceFieldHistory } from './invoice-field-configuration.js';
import { discountPercentage, emitAutomationEvent, enforceApproval, resolveDocumentPresentation } from '../automation/runtime.js';

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
export { jsonObject } from '../../core/serialization/json.js';
function requestHash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function dateOnly(value: Date | null) { return value?.toISOString().slice(0, 10) ?? null; }
export function serialiseInvoice(record: InvoiceRecord) {
  const scale = money('0', currencyCode(record.currency)).amount.split('.')[1]?.length ?? 0;
  const supply = record.supplySnapshot;
  const stateCode = supply && typeof supply === 'object' && !Array.isArray(supply) ? supply.placeOfSupplyStateCode : undefined;
  return {
    id: record.id, firmId: record.firmId, kind: record.kind, status: record.status, version: record.version,
    documentNumber: record.documentNumber, invoiceDate: dateOnly(record.invoiceDate), dueDate: dateOnly(record.dueDate),
    companyId: record.companyId, customerReference: record.customerReference, paymentTerms: record.paymentTerms, notes: record.notes,
    currency: record.currency, buyerSnapshot: record.buyerSnapshot, sellerSnapshot: record.sellerSnapshot, bankSnapshot: record.bankSnapshot,
    financialPolicySnapshot: record.financialPolicySnapshot, supplySnapshot: record.supplySnapshot,
    placeOfSupplyStateName: typeof stateCode === 'string' ? INDIA_STATES[stateCode] ?? null : null,
    customFieldSchema: record.customFieldSchema, customFieldValues: record.customFieldValues, presentationSnapshot: record.presentationSnapshot,
    sourceSnapshot: record.sourceSnapshot, sourceQuotationId: record.sourceQuotationId, sourceProformaId: record.sourceProformaId, sourceInvoiceId: record.sourceInvoiceId, sourceSalesOrderId: record.sourceSalesOrderId,
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
      this.db.invoice.findMany({ where, orderBy: query.sortBy === 'id' ? [{ id: query.sortOrder }] : [{ [query.sortBy]: query.sortOrder }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit, include: invoiceInclude }),
      this.db.invoice.count({ where }),
    ]);
    return { documents: documents.map(serialiseInvoice), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }
  async options(firmId: number, type: 'customers' | 'items', search: string, limit: number, selectedId?: number) {
    await assertTransactionFeature(this.db, firmId, 'billing.invoices');
    if (type === 'customers') return this.db.company.findMany({ where: { firmId, deletedAt: null, isActive: true, ...(selectedId !== undefined ? { id: selectedId } : { name: { contains: search } }) }, select: { id: true, name: true, gstin: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: selectedId !== undefined ? 1 : limit });
    await assertTransactionFeature(this.db, firmId, 'items');
    const items = await this.db.item.findMany({ where: { firmId, deletedAt: null, isActive: true, name: { contains: search }, measurementUnit: { firmId, deletedAt: null, isActive: true } }, include: { measurementUnit: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: limit });
    return items.map((item) => ({ id: item.id, name: item.name, itemCode: item.itemCode, supplyType: item.kind, unitRate: item.defaultRate.toFixed(2), taxRate: item.gstRate.toFixed(2), hsnCode: item.hsnCode, measurementUnit: item.measurementUnit.symbol }));
  }
  async customerAddresses(firmId: number, companyId: number) {
    await assertTransactionFeature(this.db, firmId, 'billing.invoices');
    const company = await this.db.company.findFirst({ where: { id: companyId, firmId, isActive: true, deletedAt: null }, select: { id: true, addresses: { where: { deletedAt: null }, orderBy: { id: 'asc' } } } });
    if (!company) throw new AppError('Customer unavailable', 404);
    return company.addresses;
  }
  async policy(tx: Prisma.TransactionClient, firmId: number, supply: SupplyInput) {
    const settings = await readInvoiceSettings(tx, firmId, true);
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
    await recordInvoiceFieldHistory(tx, firmId, actorId, id, version);
  }
  async fieldHistory(firmId: number, actorId: number, id: number, scope: DocumentScope, page: number, sort: { sortBy: 'version' | 'createdAt'; sortOrder: 'asc' | 'desc' } = { sortBy: 'version', sortOrder: 'desc' }) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, scope, 'view');
      await assertTransactionFeature(tx, firmId, 'automation');
      await this.find(tx, firmId, id, scope);
      const records = await tx.customFieldValueVersion.findMany({ where: { firmId, entity: 'INVOICE', entityId: id }, orderBy: [{ [sort.sortBy]: sort.sortOrder }, { id: sort.sortOrder }], take: 51, skip: (page - 1) * 50 });
      return { history: records.slice(0, 50), pagination: { page, limit: 50, hasMore: records.length > 50 } };
    });
  }
  async preview(firmId: number, actorId: number, input: InvoiceDraftInput, scope: DocumentScope) {
    return withFirmEntitlementTransaction(this.db, firmId, (tx) => this.previewInTransaction(tx, firmId, actorId, input, scope));
  }
  async previewInTransaction(tx: Prisma.TransactionClient, firmId: number, actorId: number, input: InvoiceDraftInput, scope: DocumentScope) {
      await this.authorize(tx, firmId, actorId, scope, 'create');
      await this.buyer(tx, firmId, input);
      const { policy } = await this.policy(tx, firmId, input.supply);
      const enriched = await this.enrichLines(tx, firmId, input.lines);
      return { currency: policy.currency, financialPolicy: policy, ...calculateInvoiceLines(enriched.lines, policy, enriched.codes) };
  }
  async create(firmId: number, actorId: number, input: InvoiceDraftInput, scope: 'INVOICE' | 'PROFORMA', metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, (tx) => this.createInTransaction(tx, firmId, actorId, input, scope, metadata));
  }
  // The caller owns the existing firm lock. This keeps outbox completion, draft
  // history and schedule advancement in the same database transaction.
  async createInTransaction(tx: Prisma.TransactionClient, firmId: number, actorId: number, input: InvoiceDraftInput, scope: 'INVOICE' | 'PROFORMA', metadata: RequestMetadata) {
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
  }
  async update(firmId: number, actorId: number, id: number, input: InvoiceUpdateInput, scope: DocumentScope, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, scope, 'edit');
      const old = await this.find(tx, firmId, id, scope);
      if (old.status !== 'DRAFT' || old.version !== input.expectedVersion) throw new AppError('Only the current draft version can be edited; reload', 409);
      if (old.sourceQuotationId || old.sourceProformaId || old.sourceInvoiceId || old.sourceSalesOrderId) throw new AppError('Source-derived document values are locked; create a new manual draft for changes', 409);
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
    return withFirmEntitlementTransaction(this.db, firmId, (tx) => this.issueInTransaction(tx, firmId, actorId, id, expectedVersion, confirmedTotal, scope, metadata));
  }
  async issueInTransaction(tx: Prisma.TransactionClient, firmId: number, actorId: number, id: number, expectedVersion: number, confirmedTotal: string, scope: DocumentScope, metadata: RequestMetadata) {
    await this.authorize(tx, firmId, actorId, scope, 'issue');
    const old = await this.find(tx, firmId, id, scope);
    if (old.status === 'ISSUED' && old.version === expectedVersion + 1 && old.grandTotal.eq(confirmedTotal)) return serialiseInvoice(old);
    if (old.status !== 'DRAFT' || old.version !== expectedVersion) throw new AppError('Only the current draft can be issued; reload', 409);
    if (!old.grandTotal.eq(confirmedTotal)) throw new AppError('Displayed total changed; reload before issuing', 409);
    if (old.kind === 'INVOICE' || old.kind === 'CREDIT_NOTE') await enforceApproval(tx, firmId, actorId, { action: old.kind === 'INVOICE' ? 'INVOICE_ISSUE' : 'CREDIT_NOTE_ISSUE', entityId: id, expectedVersion, confirmedTotal });
    if (old.sourceQuotationId) await readAcceptedQuotationForBilling(tx, firmId, old.sourceQuotationId);
    if (old.sourceSalesOrderId) {
      await assertTransactionFeature(tx, firmId, 'sales.orders');
      await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.SALES_ORDERS_VIEW);
      await readOrderForInvoicing(tx, firmId, old.sourceSalesOrderId);
    }
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
        const settlement = await readInvoiceSettlement(tx, firmId, source.id);
        if (decimal(settlement.adjustedTotal).sub(old.grandTotal).lt(settlement.allocated)) throw new AppError('Credit note would exceed the unallocated invoice balance; correct receipt allocations first', 409);
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
    const automationPresentation = await resolveDocumentPresentation(tx, firmId, 'INVOICE', id);
    const business = await resolveBusinessPolicy(tx, firmId);
    const localization = business.policy.presentation ? { localizationSnapshot: { ...business.policy.presentation, policyVersion: business.version } } : {};
    const snapshot = jsonObject({ ...serialiseInvoice(old), status: 'ISSUED', documentNumber, invoiceDate: today, version: old.version + 1, sellerSnapshot: seller, bankSnapshot, automationPresentation, ...localization });
    const updated = await tx.invoice.updateMany({ where: { id, firmId, version: expectedVersion, status: 'DRAFT' }, data: { status: 'ISSUED', version: { increment: 1 }, documentNumber, period: financialYear(today).period, invoiceDate: new Date(today), sellerSnapshot: seller, bankSnapshot: bankSnapshot ?? Prisma.JsonNull, issueSnapshot: snapshot, issuedAt: new Date(), updatedById: actorId } });
    if (updated.count !== 1) throw new AppError('Draft changed during issuance', 409);
    await this.history(tx, firmId, id, old.version + 1, actorId, 'DRAFT', 'ISSUED');
    const record = await this.find(tx, firmId, id, scope);
    await this.audit(tx, firmId, actorId, record, AuditAction.STATUS_CHANGE, metadata, old);
    if (old.kind === 'INVOICE' || old.kind === 'CREDIT_NOTE') await emitAutomationEvent(tx, firmId, actorId, `billing:${id}:${record.version}`, { trigger: old.kind === 'INVOICE' ? 'invoice.issued' : 'credit-note.issued', entity: 'INVOICE', entityId: id, documentNumber, status: record.status, currency: record.currency, total: record.grandTotal.toString(), discountPercent: discountPercentage(record.subtotal, record.discountAmount) });
    return serialiseInvoice(record);
  }
  async updateCustomValues(firmId: number, actorId: number, id: number, scope: DocumentScope, expectedVersion: number, input: Record<string, string | boolean | null>, refresh: boolean, metadata: RequestMetadata, expectedSettingsVersion?: number) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, scope, 'edit');
      const old = await this.find(tx, firmId, id, scope);
      if (old.status !== 'DRAFT' || old.version !== expectedVersion) throw new AppError('Only the current draft custom values can be edited', 409);
      const settings = refresh ? await readInvoiceSettings(tx, firmId, true) : null;
      if (settings && expectedSettingsVersion !== undefined && settings.version !== expectedSettingsVersion) throw new AppError('Additional field settings changed. Return to the document and review the latest fields before applying.', 409);
      const fields = settings ? settings.config.customFields : customFieldDefinitionsSchema.parse(old.customFieldSchema);
      // Entitlement changes can alter the effective fields without changing the
      // saved settings version. Reviewed submissions contain every visible key.
      if (settings && expectedSettingsVersion !== undefined && (Object.keys(input).length !== fields.length || fields.some((field) => !Object.prototype.hasOwnProperty.call(input, field.key)))) throw new AppError('The available additional fields changed. Return to the document and review them again before applying.', 409);
      const values = validateCustomFieldValues(fields, input, false);
      const updated = await tx.invoice.updateMany({ where: { id, firmId, status: 'DRAFT', version: expectedVersion }, data: { customFieldSchema: fields, customFieldValues: values, version: { increment: 1 }, updatedById: actorId } });
      if (updated.count !== 1) throw new AppError('This draft changed. Return to the document before saving again.', 409);
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
  async cancelOrderDraft(firmId: number, actorId: number, id: number, expectedVersion: number, reason: string, metadata: RequestMetadata) {
    return this.cancelDraft(firmId, actorId, id, expectedVersion, reason, 'INVOICE', metadata, true);
  }
  async cancelDraft(firmId: number, actorId: number, id: number, expectedVersion: number, reason: string, scope: DocumentScope, metadata: RequestMetadata, requireOrder = false) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, scope, 'void');
      const old = await this.find(tx, firmId, id, scope);
      if (requireOrder && !old.sourceSalesOrderId) throw new AppError('This action requires an order-derived draft', 409);
      if (old.status === 'VOID' && old.issuedAt === null && old.version === expectedVersion + 1 && old.voidReason === reason) return serialiseInvoice(old);
      if (old.status !== 'DRAFT' || old.version !== expectedVersion) throw new AppError('Only the current unissued draft can be cancelled', 409);
      const updated = await tx.invoice.updateMany({ where: { id, firmId, status: 'DRAFT', version: expectedVersion }, data: { status: 'VOID', version: { increment: 1 }, voidedAt: new Date(), voidReason: reason, updatedById: actorId } });
      if (updated.count !== 1) throw new AppError('This draft changed. Refresh the document before cancelling it.', 409);
      await this.history(tx, firmId, id, old.version + 1, actorId, 'DRAFT', 'VOID');
      const row = await this.find(tx, firmId, id, scope);
      await this.audit(tx, firmId, actorId, row, AuditAction.STATUS_CHANGE, metadata, old);
      return serialiseInvoice(row);
    });
  }
  async void(firmId: number, actorId: number, id: number, expectedVersion: number, reason: string, scope: DocumentScope, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, (tx) => this.voidInTransaction(tx, firmId, actorId, id, expectedVersion, reason, scope, metadata));
  }
  async voidInTransaction(tx: Prisma.TransactionClient, firmId: number, actorId: number, id: number, expectedVersion: number, reason: string, scope: DocumentScope, metadata: RequestMetadata) {
    await this.authorize(tx, firmId, actorId, scope, 'void');
    const old = await this.find(tx, firmId, id, scope);
    if (old.status !== 'ISSUED' || old.version !== expectedVersion) throw new AppError('Only the latest issued document can be cancelled', 409);
    if (scope === 'ADJUSTMENT') throw new AppError('Issued adjustment notes require a compensating document; originals are preserved', 409);
    if (indiaToday(old.issuedAt!) !== indiaToday()) throw new AppError('Cancellation is allowed only on the issue date and before GST reporting. Use a credit or debit note for later corrections.', 409);
    const dependants = await tx.invoice.count({ where: { firmId, OR: [{ sourceInvoiceId: id }, { sourceProformaId: id }] } });
    if (dependants > 0) throw new AppError('This document has a credit/debit note or linked invoice and cannot be cancelled', 409);
    if (scope === 'INVOICE' && decimal((await readInvoiceSettlement(tx, firmId, id)).allocated).gt(0)) throw new AppError('Cancel the receipt entries applied to this invoice before cancelling it', 409);
    if (scope === 'INVOICE') await enforceApproval(tx, firmId, actorId, { action: 'INVOICE_VOID', entityId: id, expectedVersion, reason, notReportedAndSupplyCancelled: true });
    await tx.invoice.updateMany({ where: { id, firmId, status: 'ISSUED', version: expectedVersion }, data: { status: 'VOID', version: { increment: 1 }, voidedAt: new Date(), voidReason: reason, updatedById: actorId } });
    await this.history(tx, firmId, id, old.version + 1, actorId, 'ISSUED', 'VOID');
    const record = await this.find(tx, firmId, id, scope);
    await this.audit(tx, firmId, actorId, record, AuditAction.STATUS_CHANGE, metadata, old);
    if (scope === 'INVOICE') await emitAutomationEvent(tx, firmId, actorId, `billing:${id}:${record.version}`, { trigger: 'invoice.voided', entity: 'INVOICE', entityId: id, documentNumber: record.documentNumber ?? '', status: record.status, currency: record.currency, total: record.grandTotal.toString(), discountPercent: discountPercentage(record.subtotal, record.discountAmount) });
    return serialiseInvoice(record);
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
      if (await tx.salesOrder.findFirst({ where: { firmId, sourceQuotationId: source.id, status: { not: 'CANCELLED' } } })) throw new AppError('This revision has an active order; invoice its completed quantities', 409);
      if (await tx.invoice.findUnique({ where: { firmId_sourceQuotationId: { firmId, sourceQuotationId: source.id } } })) throw new AppError('This accepted revision already has an invoice', 409);
      const { policy, settings } = await this.policy(tx, firmId, input.supply);
      if (policy.taxMode !== source.taxMode || (policy.registration === 'REGULAR' && source.currency !== 'INR')) throw new AppError('Accepted quotation tax mode is incompatible with the invoice registration/place of supply; review a new quotation revision', 409);
      if (!source.billingAddressSnapshot) throw new AppError('Accepted quotation has no billing address; review a new quotation revision', 409);
      currencyCode(source.currency);
      const lines = quotationBillingLines(customerQuotationSnapshot(source), input.lineMetadata);
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
  async fromSalesOrder(firmId: number, actorId: number, input: z.infer<typeof orderInvoiceSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.authorize(tx, firmId, actorId, 'INVOICE', 'create');
      await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.SALES_ORDERS_VIEW);
      await assertTransactionFeature(tx, firmId, 'sales.orders');
      const hash = requestHash({ operation: 'sales-order', input });
      const replay = await this.replay(tx, firmId, input.idempotencyKey, hash);
      if (replay) return replay;
      const order = await readOrderForInvoicing(tx, firmId, input.salesOrderId);
      const source = order.snapshot as unknown as ReturnType<typeof customerQuotationSnapshot>;
      const { settings, policy } = await this.policy(tx, firmId, input.supply);
      const zeroTax = source.items.every((line) => decimal(line.taxAmount).isZero());
      if ((policy.taxMode !== source.taxMode && !(policy.taxMode === 'NONE' && zeroTax)) || (policy.registration === 'REGULAR' && order.currency !== 'INR')) throw new AppError('Order tax policy is incompatible with the invoice supply', 409);
      if (!source.billingAddress) throw new AppError('Order has no accepted billing address', 409);
      const currency = currencyCode(order.currency);
      const amount = (value: Prisma.Decimal) => money(value, currency, 'HALF_UP').amount;
      for (const requested of input.lines) {
        const line = order.lines.find((entry) => entry.id === requested.salesOrderLineId);
        if (!line) throw new AppError('Order line unavailable', 404);
        if (decimal(requested.quantity).gt(line.available)) throw new AppError('Invoice exceeds unreserved completed quantity', 409);
      }
      const fullLines = quotationBillingLines(source, order.lines.map((line) => {
        const requested = input.lines.find((entry) => entry.salesOrderLineId === line.id);
        return { lineNumber: line.lineNumber, hsnCode: requested?.hsnCode ?? null, supplyType: requested?.supplyType ?? 'GOODS' };
      }));
      const fullPolicy: InvoiceFinancialPolicy = { ...policy, currency, rounding: 'HALF_UP', grandTotal: 'WHOLE_UNIT' };
      const acceptedExtras = decimal(source.freightAmount).add(source.otherCharges);
      if (!decimal(sumInvoiceLines(fullLines, fullPolicy, acceptedExtras.toString()).grandTotal).eq(source.grandTotal)) throw new AppError('Accepted source totals are inconsistent; review a new quotation', 409);
      const financialPolicy: InvoiceFinancialPolicy = { ...fullPolicy, grandTotal: 'MINOR_UNIT' };
      const active = await tx.invoice.aggregate({ where: { firmId, sourceSalesOrderId: order.id, status: { not: 'VOID' } }, _sum: { taxableAmount: true, taxAmount: true, grandTotal: true } });
      const components = await tx.$queryRaw<Array<{ lineNumber: number; baseAmount: Prisma.Decimal; discountAmount: Prisma.Decimal; cgstAmount: Prisma.Decimal; sgstAmount: Prisma.Decimal; igstAmount: Prisma.Decimal }>>`
        SELECT l.line_number AS lineNumber,
          SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(l.snapshot, '$.baseAmount')) AS DECIMAL(24,3))) AS baseAmount,
          SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(l.snapshot, '$.discountAmount')) AS DECIMAL(24,3))) AS discountAmount,
          SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(l.snapshot, '$.cgstAmount')) AS DECIMAL(24,3))) AS cgstAmount,
          SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(l.snapshot, '$.sgstAmount')) AS DECIMAL(24,3))) AS sgstAmount,
          SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(l.snapshot, '$.igstAmount')) AS DECIMAL(24,3))) AS igstAmount
        FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id AND i.firm_id = l.firm_id
        WHERE i.firm_id = ${firmId} AND i.source_sales_order_id = ${order.id} AND i.status <> 'VOID'
        GROUP BY l.line_number`;
      const lines = input.lines.map((requested) => {
        const orderLine = order.lines.find((line) => line.id === requested.salesOrderLineId)!;
        const full = fullLines.find((line) => line.lineNumber === orderLine.lineNumber)!;
        const previous = components.find((line) => line.lineNumber === full.lineNumber);
        const consumed = Object.fromEntries((['baseAmount', 'discountAmount', 'cgstAmount', 'sgstAmount', 'igstAmount'] as const).map((field) => [field, amount(previous?.[field] ?? decimal('0'))]));
        return partialQuotationLine(full, orderLine.reserved.toFixed(3), requested.quantity, currency, consumed);
      });
      const fullRaw = fullLines.reduce((total, line) => total.add(line.lineTotal), decimal('0'));
      const raw = lines.reduce((total, line) => total.add(line.lineTotal), decimal('0'));
      const priorRaw = decimal(active._sum.taxableAmount ?? '0').add(active._sum.taxAmount ?? '0');
      const priorExtra = decimal(active._sum.grandTotal ?? '0').sub(priorRaw);
      const totalExtra = decimal(source.grandTotal).sub(fullRaw);
      // Cumulative allocation includes source freight/charges and its rounding.
      // This preserves the exact accepted total across partial invoices/retries.
      const remainingWeight = fullRaw.isZero() ? order.lines.reduce((sum, line) => sum.add(line.quantity).sub(line.reserved), decimal('0')) : fullRaw.sub(priorRaw);
      const newWeight = fullRaw.isZero() ? input.lines.reduce((sum, line) => sum.add(line.quantity), decimal('0')) : raw;
      const extraCharges = remainingWeight.isZero() ? '0' : amount(totalExtra.sub(priorExtra).mul(newWeight).div(remainingWeight));
      const totals = sumInvoiceLines(lines, financialPolicy, extraCharges);
      if (decimal(totals.grandTotal).lt(0)) throw new AppError('Consolidate remaining quantities to preserve accepted rounding', 409);
      const values = validateCustomFieldValues(settings.config.customFields, input.customFieldValues, false);
      const document = await this.derivedDraft(tx, firmId, actorId, input.idempotencyKey, hash, {
        kind: 'INVOICE', companyId: order.companyId, sourceSalesOrderId: order.id, invoiceDate: new Date(indiaToday()), currency,
        buyerSnapshot: jsonObject({ name: source.companyName, legalName: source.companyName, gstin: source.gstin, pan: source.pan, billingAddress: source.billingAddress, shippingAddress: source.shippingAddress }),
        financialPolicySnapshot: jsonObject(financialPolicy), supplySnapshot: jsonObject(input.supply), presentationSnapshot: jsonObject(settings.config),
        customFieldSchema: settings.config.customFields, customFieldValues: values,
        sourceSnapshot: { salesOrderId: order.id, orderNumber: order.orderNumber, sourceQuotationId: order.sourceQuotationId, revisionNumber: source.revisionNumber, snapshotHash: order.snapshotHash, extraCharges, invoicingPolicy: 'FULFILLED_QUANTITIES', termsAndConditions: source.termsAndConditions },
        customerReference: source.customerReference, paymentTerms: source.paymentTerms, ...totals,
      }, lines, metadata);
      await tx.salesOrderInvoiceLine.createMany({ data: input.lines.map((line) => ({ firmId, salesOrderId: order.id, salesOrderLineId: line.salesOrderLineId, invoiceId: document.id, quantity: decimal(line.quantity) })) });
      return document;
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
      const { config } = await readInvoiceSettings(tx, firmId, true);
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
export const issueBillingDocumentInTransaction = invoicesRepository.issueInTransaction.bind(invoicesRepository);
export const voidBillingDocumentInTransaction = invoicesRepository.voidInTransaction.bind(invoicesRepository);
export const invoiceSettingsRepository = new InvoiceSettingsRepository(prisma);
