import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import type { Area } from '@ananda/shared';
import {
  Briefcase,
  CalendarBlank,
  CalendarDots,
  ChartLine,
  ClockCounterClockwise,
  List,
  Money,
  Package,
  Receipt,
  ShieldCheck,
  ShoppingCartSimple,
  SlidersHorizontal,
  SquaresFour,
  Truck,
  Users,
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
  { key: null, items: [{ key: 'home', href: '/home', area: 'home', icon: SquaresFour }] },
  {
    key: 'sales',
    items: [
      { key: 'sales', href: '/sales', area: 'sales', icon: List },
      { key: 'customers', href: '/customers', area: 'customers', icon: Users },
      { key: 'collections', href: '/collections', area: 'collections', icon: Money },
    ],
  },
  {
    key: 'stock',
    items: [
      { key: 'purchasing', href: '/purchasing', area: 'purchasing', icon: ShoppingCartSimple },
      { key: 'inventory', href: '/inventory', area: 'inventory', icon: Package },
      { key: 'warehouse', href: '/warehouse', area: 'warehouse', icon: Truck },
    ],
  },
  {
    key: 'people',
    items: [
      { key: 'brokers', href: '/brokers', area: 'brokers', icon: Briefcase },
      { key: 'events', href: '/events', area: 'events', icon: CalendarBlank },
    ],
  },
  {
    key: 'money',
    items: [
      { key: 'deal_profit', href: '/money/deal-profit', area: 'deal_profit', icon: ChartLine },
      { key: 'pnl', href: '/money/pnl', area: 'pnl', icon: CalendarDots },
      { key: 'expenses', href: '/money/expenses', area: 'expenses', icon: Receipt },
    ],
  },
  {
    key: 'admin',
    items: [
      { key: 'users', href: '/users', area: 'users', icon: ShieldCheck },
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

/** The nav item a path belongs to (longest match), for the breadcrumb, the phone title and access checks. */
export function navItemFor(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const g of NAV) for (const i of g.items) if (isActive(pathname, i.href) && (!best || i.href.length > best.href.length)) best = i;
  return best;
}
