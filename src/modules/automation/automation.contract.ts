import { PERMISSIONS, type Permission } from '../auth/permissions.js';
import type { FeatureKey } from '../entitlements/index.js';

export const APPROVAL_ACTIONS = ['INVOICE_ISSUE', 'INVOICE_VOID', 'CREDIT_NOTE_ISSUE', 'ORDER_CONFIRM', 'STOCK_ADJUST', 'QUOTATION_SEND'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export const ACTION_ACCESS: Record<ApprovalAction, { permission: Permission; feature: FeatureKey }> = {
  INVOICE_ISSUE: { permission: PERMISSIONS.INVOICES_ISSUE, feature: 'billing.invoices' },
  INVOICE_VOID: { permission: PERMISSIONS.INVOICES_VOID, feature: 'billing.invoices' },
  CREDIT_NOTE_ISSUE: { permission: PERMISSIONS.ADJUSTMENTS_MANAGE, feature: 'billing.adjustments' },
  ORDER_CONFIRM: { permission: PERMISSIONS.SALES_ORDERS_MANAGE, feature: 'sales.orders' },
  STOCK_ADJUST: { permission: PERMISSIONS.STOCK_ADJUST, feature: 'inventory' },
  QUOTATION_SEND: { permission: PERMISSIONS.QUOTATIONS_STATUS, feature: 'quotations' },
};
export const ENTITY_ACCESS = {
  COMPANY: { view: PERMISSIONS.COMPANIES_VIEW, edit: PERMISSIONS.COMPANIES_MANAGE, feature: 'companies' },
  ITEM: { view: PERMISSIONS.ITEMS_VIEW, edit: PERMISSIONS.ITEMS_MANAGE, feature: 'items' },
  QUOTATION: { view: PERMISSIONS.QUOTATIONS_VIEW, edit: PERMISSIONS.QUOTATIONS_EDIT, feature: 'quotations' },
  INVOICE: { view: PERMISSIONS.INVOICES_VIEW, edit: PERMISSIONS.INVOICES_EDIT, feature: 'billing.invoices' },
  SALES_ORDER: { view: PERMISSIONS.SALES_ORDERS_VIEW, edit: PERMISSIONS.SALES_ORDERS_MANAGE, feature: 'sales.orders' },
  STOCK_OPERATION: { view: PERMISSIONS.INVENTORY_VIEW, edit: PERMISSIONS.STOCK_ADJUST, feature: 'inventory' },
} as const;
export const TRIGGERS = ['invoice.issued', 'invoice.voided', 'credit-note.issued', 'order.confirmed', 'stock.adjusted', 'quotation.sent'] as const;
export const TRIGGER_ENTITY = {
  'invoice.issued': 'INVOICE', 'invoice.voided': 'INVOICE', 'credit-note.issued': 'INVOICE',
  'order.confirmed': 'SALES_ORDER', 'stock.adjusted': 'STOCK_OPERATION', 'quotation.sent': 'QUOTATION',
} as const;
export const TRIGGER_READ_ACCESS = {
  'invoice.issued': { permission: PERMISSIONS.INVOICES_VIEW, feature: 'billing.invoices' },
  'invoice.voided': { permission: PERMISSIONS.INVOICES_VIEW, feature: 'billing.invoices' },
  'credit-note.issued': { permission: PERMISSIONS.ADJUSTMENTS_VIEW, feature: 'billing.adjustments' },
  'order.confirmed': { permission: PERMISSIONS.SALES_ORDERS_VIEW, feature: 'sales.orders' },
  'stock.adjusted': { permission: PERMISSIONS.INVENTORY_VIEW, feature: 'inventory' },
  'quotation.sent': { permission: PERMISSIONS.QUOTATIONS_VIEW, feature: 'quotations' },
} as const;
