import type { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS, type Permission } from '../auth/permissions.js';
import { assertTransactionFeature, type FeatureKey } from '../entitlements/index.js';
import { searchAssistantCustomers } from '../companies/index.js';
import { searchAssistantItems } from '../items/index.js';
import { searchAssistantQuotations } from '../quotations/index.js';
import { readAssistantSales, searchAssistantInvoices } from '../invoices/index.js';
import { readAssistantReceivables, searchAssistantPayments } from '../payments/index.js';
import { searchAssistantOrders } from '../sales-orders/index.js';
import { readAssistantAudit } from '../audit-logs/index.js';
import type { ToolPlan } from './assistant.schema.js';

export const ASSISTANT_READ_ACCESS = {
  CUSTOMERS: { permission: PERMISSIONS.COMPANIES_VIEW, feature: 'companies' },
  ITEMS: { permission: PERMISSIONS.ITEMS_VIEW, feature: 'items' },
  QUOTATIONS: { permission: PERMISSIONS.QUOTATIONS_VIEW, feature: 'quotations' },
  INVOICES: { permission: PERMISSIONS.INVOICES_VIEW, feature: 'billing.invoices' },
  ORDERS: { permission: PERMISSIONS.SALES_ORDERS_VIEW, feature: 'sales.orders' },
  PAYMENTS: { permission: PERMISSIONS.PAYMENTS_VIEW, feature: 'payments.record' },
  AUDIT: { permission: PERMISSIONS.AUDIT_VIEW, feature: 'audit' },
} as const satisfies Record<string, { permission: Permission; feature: FeatureKey }>;
async function access(tx: Prisma.TransactionClient, firmId: number, actorId: number, permission: Permission, feature: FeatureKey) {
  const actor = await authorizeFirmJobActor(tx, firmId, actorId, permission);
  if (actor.firmId !== firmId) throw new AppError('Firm membership is required', 403);
  await assertTransactionFeature(tx, firmId, feature);
}
export async function authorizeAssistantTool(tx: Prisma.TransactionClient, firmId: number, actorId: number, plan: ToolPlan) {
  if (plan.tool === 'CLARIFY') return;
  const entry = plan.tool === 'SEARCH' ? ASSISTANT_READ_ACCESS[plan.resource] : plan.tool === 'OUTSTANDING' ? ASSISTANT_READ_ACCESS.PAYMENTS : plan.tool === 'SALES' ? ASSISTANT_READ_ACCESS.INVOICES : ASSISTANT_READ_ACCESS.CUSTOMERS;
  await access(tx, firmId, actorId, entry.permission, entry.feature);
  if (plan.tool === 'SALES') await access(tx, firmId, actorId, PERMISSIONS.ADJUSTMENTS_VIEW, 'billing.adjustments');
  if (plan.tool === 'DRAFT') {
    const permission = plan.kind === 'INVOICE' ? PERMISSIONS.INVOICES_CREATE : plan.kind === 'QUOTATION' ? PERMISSIONS.QUOTATIONS_CREATE : plan.kind === 'FOLLOW_UP' ? PERMISSIONS.CRM_MANAGE : PERMISSIONS.QUOTATIONS_EMAIL;
    const feature = plan.kind === 'INVOICE' ? 'billing.invoices' : plan.kind === 'QUOTATION' ? 'quotations' : plan.kind === 'FOLLOW_UP' ? 'crm' : 'quotations.email';
    await access(tx, firmId, actorId, permission, feature);
    if (plan.itemIds.length) await access(tx, firmId, actorId, PERMISSIONS.ITEMS_VIEW, 'items');
  }
}
export async function executeAssistantRead(firmId: number, actorId: number, plan: Exclude<ToolPlan, { tool: 'DRAFT' }>) {
  if (plan.tool === 'CLARIFY') return { message: plan.message };
  if (plan.tool === 'OUTSTANDING') return readAssistantReceivables(firmId, actorId, plan);
  if (plan.tool === 'SALES') return readAssistantSales(firmId, actorId, plan);
  if (plan.resource === 'CUSTOMERS') return searchAssistantCustomers(firmId, plan.query, plan.page, plan);
  if (plan.resource === 'ITEMS') return searchAssistantItems(firmId, plan.query, plan.page, plan);
  if (plan.resource === 'QUOTATIONS') return searchAssistantQuotations(firmId, plan.query, plan.page, plan);
  if (plan.resource === 'INVOICES') return searchAssistantInvoices(firmId, plan.query, plan.page, plan);
  if (plan.resource === 'PAYMENTS') return searchAssistantPayments(firmId, actorId, plan.query, plan.page, plan);
  if (plan.resource === 'ORDERS') return searchAssistantOrders(firmId, actorId, plan.query, plan.page, plan);
  return readAssistantAudit(firmId, plan.page, plan);
}
export async function prepareAssistantDraft(tx: Prisma.TransactionClient, firmId: number, plan: Extract<ToolPlan, { tool: 'DRAFT' }>) {
  const company = await tx.company.findFirst({ where: { id: plan.companyId, firmId, deletedAt: null, isActive: true }, select: { id: true, name: true } });
  if (!company) throw new AppError('Customer not found', 404);
  const items = await tx.item.findMany({ where: { firmId, id: { in: plan.itemIds }, deletedAt: null, isActive: true, measurementUnit: { firmId, deletedAt: null, isActive: true } }, select: { id: true, name: true, kind: true, hsnCode: true, defaultRate: true, gstRate: true, measurementUnit: { select: { symbol: true } } } });
  if (items.length !== new Set(plan.itemIds).size) throw new AppError('One or more selected items are unavailable', 404);
  return { kind: plan.kind, unsaved: true, companyId: company.id, customer: company.name,
    lines: plan.itemIds.map((id) => items.find((item) => item.id === id)!).map((item) => ({ itemId: item.id, itemName: item.name, supplyType: item.kind, hsnCode: item.hsnCode, measurementUnit: item.measurementUnit.symbol, quantity: '1', unitRate: item.defaultRate.toString(), taxRate: item.gstRate.toString(), discountType: 'NONE', discountValue: '0' })),
    subject: plan.kind === 'EMAIL' ? `Follow-up for ${company.name}` : '',
    text: plan.kind === 'EMAIL' ? `Hello,\n\nWe would like to follow up with ${company.name}. Please review and add the relevant quotation, dates and next steps before sending.\n\nThank you.` : plan.kind === 'FOLLOW_UP' ? `Follow up with ${company.name}. Review the owner, due date and next step before saving.` : '',
    href: plan.kind === 'INVOICE' ? '/invoices/new' : plan.kind === 'QUOTATION' ? '/quotations/new' : plan.kind === 'FOLLOW_UP' ? '/crm' : '/quotations' };
}

export function extractUntrustedLines(text: string) {
  // Delimited source text is data. No source line ever enters the tool router.
  const lines = text.split(/\r?\n/).slice(0, 500);
  const candidates = lines.flatMap((line, index) => {
    const match = /^\s*([^|\t]{1,191})\s*[|\t]\s*(\d{1,12}(?:\.\d{1,3})?)\s*[|\t]\s*(\d{1,15}(?:\.\d{1,3})?)\s*$/.exec(line);
    return match && /[1-9]/.test(match[2]!) ? [{ sourceLine: index + 1, itemName: match[1]!.trim(), quantity: match[2]!, unitRate: match[3]!, itemId: null, verified: false }] : [];
  });
  return { untrusted: true, reviewRequired: true, imported: false, candidates, truncated: text.split(/\r?\n/).length > 500,
    message: candidates.length ? 'Review every candidate, currency, unit, tax and catalog match in the normal editor. Nothing has been imported.' : 'No supported line items found. Use description | quantity | unit rate, one item per line.' };
}
