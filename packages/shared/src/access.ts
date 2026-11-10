// Roles, areas and sensitive actions (PRD §3).

export const AREAS = [
  'home',
  'sales',
  'customers',
  'collections',
  'purchasing',
  'inventory',
  'warehouse',
  'agents',
  'events',
  'deal_profit',
  'pnl',
  'expenses',
  'users',
  'settings',
  'audit',
] as const;
export type Area = (typeof AREAS)[number];

export type AccessLevel = 'hidden' | 'view' | 'edit';
export type AreaMatrix = Record<Area, AccessLevel>;

export const SYSTEM_ROLES = ['system_admin', 'admin', 'agent', 'warehouse', 'finance'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** own = own customers and orders (agents); shipping = orders to ship only (warehouse). */
export type RecordScope = 'all' | 'own' | 'shipping';

export const SENSITIVE_ACTIONS = [
  'see_prices',
  'approve',
  'confirm_payment',
  'issue_invoices',
  'pay_commission',
  'record_supplier_payment',
  'change_rules',
] as const;
export type SensitiveAction = (typeof SENSITIVE_ACTIONS)[number];

/** Sensitive actions that need a fresh two-step code on every use. */
export const STEP_UP_ACTIONS: SensitiveAction[] = ['confirm_payment', 'pay_commission', 'record_supplier_payment', 'change_rules'];

const H: AccessLevel = 'hidden';
const V: AccessLevel = 'view';
const E: AccessLevel = 'edit';

function matrix(levels: AccessLevel[]): AreaMatrix {
  return Object.fromEntries(AREAS.map((a, i) => [a, levels[i]])) as AreaMatrix;
}

export interface RoleDefinition {
  key: SystemRole;
  scope: RecordScope;
  twoStepRequired: boolean;
  areas: AreaMatrix;
  sensitive: SensitiveAction[];
}

// Order of columns: home, sales, customers, collections, purchasing, inventory, warehouse,
// agents, events, deal_profit, pnl, expenses, users, settings, audit (PRD §3.1).
export const ROLE_DEFAULTS: Record<SystemRole, RoleDefinition> = {
  system_admin: {
    key: 'system_admin',
    scope: 'all',
    twoStepRequired: true,
    areas: matrix([E, E, E, E, E, E, E, E, E, E, E, E, E, E, E]),
    sensitive: [...SENSITIVE_ACTIONS],
  },
  admin: {
    key: 'admin',
    scope: 'all',
    twoStepRequired: true,
    areas: matrix([E, E, E, E, E, E, E, E, E, E, E, E, V, V, V]),
    sensitive: ['see_prices', 'approve', 'confirm_payment', 'issue_invoices', 'pay_commission', 'record_supplier_payment'],
  },
  agent: {
    key: 'agent',
    scope: 'own',
    twoStepRequired: false,
    areas: matrix([V, E, E, V, H, H, H, V, V, H, H, H, H, H, H]),
    sensitive: ['see_prices'],
  },
  warehouse: {
    key: 'warehouse',
    scope: 'shipping',
    twoStepRequired: false,
    areas: matrix([V, H, H, H, H, H, E, H, H, H, H, H, H, H, H]),
    sensitive: [],
  },
  finance: {
    key: 'finance',
    scope: 'all',
    twoStepRequired: true,
    areas: matrix([V, V, V, E, E, V, H, V, V, V, V, E, H, H, V]),
    sensitive: ['see_prices', 'confirm_payment', 'issue_invoices', 'pay_commission', 'record_supplier_payment'],
  },
};

export function canView(areas: AreaMatrix, area: Area): boolean {
  return areas[area] === 'view' || areas[area] === 'edit';
}

export function canEdit(areas: AreaMatrix, area: Area): boolean {
  return areas[area] === 'edit';
}

/** What the signed-in user (or the previewed role) may do; sent to the client to shape the UI. */
export interface Permissions {
  roleKey: string;
  roleName: string;
  baseRole: SystemRole;
  scope: RecordScope;
  areas: AreaMatrix;
  sensitive: SensitiveAction[];
  previewing: boolean;
}
