/**
 * Roles and permissions. The server checks these on every endpoint; the web
 * app only uses them to hide buttons a person cannot use.
 */
export const ROLE_KEYS = ['owner', 'manager', 'billing_staff', 'accountant'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  owner: 'Owner',
  manager: 'Manager',
  billing_staff: 'Billing staff',
  accountant: 'Accountant',
};

export const PERMISSIONS = [
  'business.view',
  'business.update',
  'members.view',
  'members.manage',
  'billing.manage',
  'audit.view',
  'masters.view',
  'masters.manage',
  'sales.view',
  'sales.create',
  'sales.cancel',
  'purchases.view',
  'purchases.manage',
  'money.view',
  'money.manage',
  'reports.view',
  'settings.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  owner: ALL,
  manager: ALL.filter((p) => p !== 'billing.manage' && p !== 'business.update'),
  billing_staff: ['business.view', 'masters.view', 'sales.view', 'sales.create', 'money.view'],
  accountant: [
    'business.view', 'members.view', 'audit.view', 'masters.view', 'sales.view', 'purchases.view',
    'purchases.manage', 'money.view', 'money.manage', 'reports.view',
  ],
};

export const can = (granted: readonly string[] | undefined, p: Permission): boolean => !!granted?.includes(p);
