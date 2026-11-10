import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import type { Area } from '@ananda/shared';
import {
  Briefcase,
  CalendarDots,
  ChartLineUp,
  ClockCounterClockwise,
  House,
  Money,
  Package,
  PiggyBank,
  Receipt,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  UserPlus,
  Users,
  SquaresFour,
} from '../ui/icon';

export interface NavItem {
  key: string;
  href: string;
  area: Area;
  icon: PhosphorIcon;
}

export interface NavGroup {
  key: string | null;
  items: NavItem[];
}

/** Sidebar grouped by job (PRD §4). Hidden areas are removed (FR-AUTH-1). */
export const NAV: NavGroup[] = [
  { key: null, items: [{ key: 'home', href: '/home', area: 'home', icon: House }] },
  {
    key: 'sales',
    items: [
      { key: 'sales', href: '/sales', area: 'sales', icon: ShoppingCart },
      { key: 'customers', href: '/customers', area: 'customers', icon: Users },
      { key: 'collections', href: '/collections', area: 'collections', icon: Money },
    ],
  },
  {
    key: 'stock',
    items: [
      { key: 'purchasing', href: '/purchasing', area: 'purchasing', icon: Truck },
      { key: 'inventory', href: '/inventory', area: 'inventory', icon: Package },
      { key: 'warehouse', href: '/warehouse', area: 'warehouse', icon: SquaresFour },
    ],
  },
  {
    key: 'people',
    items: [
      { key: 'agents', href: '/agents', area: 'agents', icon: Briefcase },
      { key: 'events', href: '/events', area: 'events', icon: CalendarDots },
    ],
  },
  {
    key: 'money',
    items: [
      { key: 'deal_profit', href: '/money/deal-profit', area: 'deal_profit', icon: ChartLineUp },
      { key: 'pnl', href: '/money/pnl', area: 'pnl', icon: Receipt },
      { key: 'expenses', href: '/money/expenses', area: 'expenses', icon: PiggyBank },
    ],
  },
  {
    key: 'admin',
    items: [
      { key: 'users', href: '/users', area: 'users', icon: UserPlus },
      { key: 'audit', href: '/audit', area: 'audit', icon: ClockCounterClockwise },
      { key: 'settings', href: '/settings', area: 'settings', icon: SlidersHorizontal },
    ],
  },
];

export function visibleNav(canView: (a: Area) => boolean): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => canView(i.area)) })).filter((g) => g.items.length > 0);
}

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + '/');
}
