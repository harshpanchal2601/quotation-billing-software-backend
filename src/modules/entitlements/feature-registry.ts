// Keys are a public contract. New features must opt into plans explicitly.
export const FEATURE_REGISTRY = Object.freeze({
  'firm.core': { description: 'Firm settings, identity administration and access diagnostics', module: 'System', dependencies: [], required: true, legacy: true },
  dashboard: { description: 'Business dashboard', module: 'Dashboard', dependencies: [], required: false, legacy: true },
  companies: { description: 'Customers, contacts and addresses', module: 'Companies', dependencies: [], required: false, legacy: true },
  catalog: { description: 'Categories and measurement units', module: 'Catalog', dependencies: [], required: false, legacy: true },
  items: { description: 'Item catalog and images', module: 'Items', dependencies: ['catalog'], required: false, legacy: true },
  quotations: { description: 'Quotation creation, revisions and lifecycle', module: 'Quotations', dependencies: ['companies'], required: false, legacy: true },
  'quotations.documents': { description: 'Quotation PDF generation and history', module: 'Quotations', dependencies: ['quotations'], required: false, legacy: true },
  'quotations.email': { description: 'Quotation email delivery', module: 'Quotations', dependencies: ['quotations.documents'], required: false, legacy: true },
  'quotations.attachments': { description: 'Quotation attachment storage and access', module: 'Quotations', dependencies: ['quotations'], required: false, legacy: true },
  audit: { description: 'Firm business audit history', module: 'Audit', dependencies: [], required: false, legacy: true },
  'billing.invoices': { description: 'Invoice drafts, issuance and document history', module: 'Billing', dependencies: ['companies'], required: false, legacy: false },
  'billing.proforma': { description: 'Non-posting proforma documents', module: 'Billing', dependencies: ['billing.invoices'], required: false, legacy: false },
  'billing.adjustments': { description: 'Traceable credit and debit notes', module: 'Billing', dependencies: ['billing.invoices'], required: false, legacy: false },
  'payments.record': { description: 'Customer receipts, allocation and receivables', module: 'Payments', dependencies: ['billing.invoices'], required: false, legacy: false },
  'payments.manage': { description: 'Receipt reversals and confirmed refund tracking', module: 'Payments', dependencies: ['payments.record'], required: false, legacy: false },
  'billing.recurring': { description: 'Approved recurring invoice draft schedules', module: 'Billing', dependencies: ['billing.invoices'], required: false, legacy: false },
  crm: { description: 'Leads, opportunities, activities and follow-ups', module: 'Sales', dependencies: ['companies'], required: false, legacy: false },
  'sales.orders': { description: 'Accepted quotation orders and independent fulfillment', module: 'Sales', dependencies: ['quotations'], required: false, legacy: false },
  'customer.portal': { description: 'Explicit contact invitations and document grants', module: 'Sales', dependencies: ['companies'], required: false, legacy: false },
  inventory: { description: 'Warehouse stock, reservations and valuation', module: 'Inventory', dependencies: ['items'], required: false, legacy: false },
  purchasing: { description: 'Supplier purchase orders and receipts', module: 'Purchasing', dependencies: ['companies', 'items'], required: false, legacy: false },
  'purchasing.bills': { description: 'Separate supplier payable documents', module: 'Purchasing', dependencies: ['purchasing'], required: false, legacy: false },
  expenses: { description: 'Classified operating expenses', module: 'Expenses', dependencies: [], required: false, legacy: false },
  'ai.credits': { description: 'Reserved entitlement for future AI operations', module: 'AI', dependencies: [], required: false, legacy: false },
} as const);

for (const definition of Object.values(FEATURE_REGISTRY)) {
  Object.freeze(definition.dependencies);
  Object.freeze(definition);
}

export type FeatureKey = keyof typeof FEATURE_REGISTRY;
export const FEATURE_KEYS = Object.keys(FEATURE_REGISTRY) as FeatureKey[];
export const QUOTA_KEYS = ['users', 'documents', 'storageBytes', 'aiCredits'] as const;
export type QuotaKey = (typeof QUOTA_KEYS)[number];

export const PERMISSION_FEATURES: Readonly<Record<string, FeatureKey>> = Object.freeze({
  'dashboard.view': 'dashboard',
  'companies.view': 'companies', 'companies.manage': 'companies',
  'catalog.view': 'catalog', 'catalog.manage': 'catalog',
  'items.view': 'items', 'items.manage': 'items',
  'quotations.view': 'quotations', 'quotations.create': 'quotations',
  'quotations.edit': 'quotations', 'quotations.status': 'quotations', 'quotations.delete': 'quotations',
  'quotations.documents': 'quotations.documents', 'quotations.email': 'quotations.email',
  'quotations.attachments': 'quotations.attachments', 'audit.view': 'audit',
  'invoices.view': 'billing.invoices', 'invoices.create': 'billing.invoices', 'invoices.edit': 'billing.invoices',
  'invoices.issue': 'billing.invoices', 'invoices.void': 'billing.invoices', 'invoices.documents': 'billing.invoices',
  'proformas.view': 'billing.proforma', 'proformas.manage': 'billing.proforma',
  'billing-adjustments.view': 'billing.adjustments', 'billing-adjustments.manage': 'billing.adjustments',
  'firm.invoice-fields.manage': 'billing.invoices', 'firm.billing-settings.manage': 'billing.invoices',
  'payments.view': 'payments.record', 'payments.record': 'payments.record', 'payments.manage': 'payments.manage',
  'billing.recurring': 'billing.recurring',
  'crm.view': 'crm', 'crm.manage': 'crm', 'crm.view-all': 'crm',
  'sales-orders.view': 'sales.orders', 'sales-orders.manage': 'sales.orders', 'fulfillments.manage': 'sales.orders',
  'portal.manage': 'customer.portal',
  'inventory.view': 'inventory', 'inventory.manage': 'inventory', 'inventory.adjust': 'inventory',
  'purchasing.view': 'purchasing', 'purchasing.manage': 'purchasing', 'purchasing.approve': 'purchasing',
  'supplier-bills.view': 'purchasing.bills', 'supplier-bills.manage': 'purchasing.bills',
  'expenses.view': 'expenses', 'expenses.manage': 'expenses',
  'firm.profile.manage': 'firm.core', 'firm.quotation-settings.manage': 'firm.core',
  'firm.bank-details.manage': 'firm.core', 'firm.users.manage': 'firm.core', 'firm.roles.manage': 'firm.core',
});

export function isFeatureKey(key: string): key is FeatureKey {
  return Object.hasOwn(FEATURE_REGISTRY, key);
}

export function validateFeatureSelection(keys: readonly string[], registry: Readonly<Record<string, { dependencies: readonly string[]; required: boolean }>> = FEATURE_REGISTRY) {
  const selected = new Set(keys);
  if (selected.size !== keys.length) throw new Error('Feature keys must be unique');
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (key: string) => {
    const definition = registry[key];
    if (definition === undefined) throw new Error(`Unknown feature: ${key}`);
    if (visiting.has(key)) throw new Error(`Cyclic feature dependency: ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of definition.dependencies) {
      if (!selected.has(dependency)) throw new Error(`${key} requires ${dependency}`);
      visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of selected) visit(key);
  for (const [key, definition] of Object.entries(registry)) {
    if (definition.required && !selected.has(key)) throw new Error(`${key} is system required`);
  }
}
