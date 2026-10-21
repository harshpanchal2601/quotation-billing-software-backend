export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  COMPANIES_VIEW: 'companies.view',
  COMPANIES_MANAGE: 'companies.manage',
  ITEMS_VIEW: 'items.view',
  ITEMS_MANAGE: 'items.manage',
  CATALOG_VIEW: 'catalog.view',
  CATALOG_MANAGE: 'catalog.manage',
  QUOTATIONS_VIEW: 'quotations.view',
  QUOTATIONS_CREATE: 'quotations.create',
  QUOTATIONS_EDIT: 'quotations.edit',
  QUOTATIONS_STATUS: 'quotations.status',
  QUOTATIONS_DELETE: 'quotations.delete',
  QUOTATIONS_DOCUMENTS: 'quotations.documents',
  QUOTATIONS_EMAIL: 'quotations.email',
  QUOTATIONS_ATTACHMENTS: 'quotations.attachments',
  AUDIT_VIEW: 'audit.view',
  FIRM_PROFILE_MANAGE: 'firm.profile.manage',
  QUOTATION_SETTINGS_MANAGE: 'firm.quotation-settings.manage',
  BANK_DETAILS_MANAGE: 'firm.bank-details.manage',
  USERS_MANAGE: 'firm.users.manage',
  ROLES_MANAGE: 'firm.roles.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export const ASSIGNABLE_PERMISSIONS: Permission[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.COMPANIES_VIEW,
  PERMISSIONS.COMPANIES_MANAGE,
  PERMISSIONS.ITEMS_VIEW,
  PERMISSIONS.ITEMS_MANAGE,
  PERMISSIONS.CATALOG_VIEW,
  PERMISSIONS.CATALOG_MANAGE,
  PERMISSIONS.QUOTATIONS_VIEW,
  PERMISSIONS.QUOTATIONS_CREATE,
  PERMISSIONS.QUOTATIONS_EDIT,
  PERMISSIONS.QUOTATIONS_STATUS,
  PERMISSIONS.QUOTATIONS_DELETE,
  PERMISSIONS.QUOTATIONS_DOCUMENTS,
  PERMISSIONS.QUOTATIONS_EMAIL,
  PERMISSIONS.QUOTATIONS_ATTACHMENTS,
  PERMISSIONS.AUDIT_VIEW,
];

const permissionSet = new Set<string>(ALL_PERMISSIONS);
const assignablePermissionSet = new Set<string>(ASSIGNABLE_PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && permissionSet.has(value);
}

export function isAssignablePermission(value: unknown): value is Permission {
  return typeof value === 'string' && assignablePermissionSet.has(value);
}

const impliedPermissions: Partial<Record<Permission, Permission[]>> = {
  [PERMISSIONS.COMPANIES_MANAGE]: [PERMISSIONS.COMPANIES_VIEW],
  [PERMISSIONS.ITEMS_MANAGE]: [PERMISSIONS.ITEMS_VIEW],
  [PERMISSIONS.CATALOG_MANAGE]: [PERMISSIONS.CATALOG_VIEW],
  [PERMISSIONS.QUOTATIONS_CREATE]: [PERMISSIONS.QUOTATIONS_VIEW],
  [PERMISSIONS.QUOTATIONS_EDIT]: [PERMISSIONS.QUOTATIONS_VIEW],
  [PERMISSIONS.QUOTATIONS_STATUS]: [PERMISSIONS.QUOTATIONS_VIEW],
  [PERMISSIONS.QUOTATIONS_DELETE]: [PERMISSIONS.QUOTATIONS_VIEW],
  [PERMISSIONS.QUOTATIONS_DOCUMENTS]: [PERMISSIONS.QUOTATIONS_VIEW],
  [PERMISSIONS.QUOTATIONS_EMAIL]: [PERMISSIONS.QUOTATIONS_VIEW],
  [PERMISSIONS.QUOTATIONS_ATTACHMENTS]: [PERMISSIONS.QUOTATIONS_VIEW],
};

export function expandAssignablePermissions(values: unknown): Permission[] {
  if (!Array.isArray(values)) return [];
  const permissions = new Set(values.filter(isAssignablePermission));
  for (const permission of permissions) {
    for (const implied of impliedPermissions[permission] ?? []) permissions.add(implied);
  }
  return [...permissions];
}
