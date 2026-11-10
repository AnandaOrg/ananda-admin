import { and, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { isoDate } from '@ananda/shared';
import { customers, orders } from '../db/schema';
import type { AuthContext } from '../common/context';

/**
 * Record scope, applied on the server to every list, detail, search, export and notification
 * (FR-AUTH-2). Agents see their own records; Warehouse sees orders to ship only.
 */
export function orderScope(auth: AuthContext): SQL | undefined {
  switch (auth.perms.scope) {
    case 'own':
      return eq(orders.agentId, auth.user.id);
    case 'shipping':
      return inArray(orders.status, ['at_warehouse', 'delivered', 'delivered_part', 'invoiced']);
    default:
      return undefined;
  }
}

/** Agents also see customers that are free to claim, so they can claim them. */
export function customerScope(auth: AuthContext): SQL | undefined {
  switch (auth.perms.scope) {
    case 'own':
      return or(eq(customers.agentId, auth.user.id), and(eq(customers.status, 'active'), lt(customers.ownedUntil, isoDate())));
    case 'shipping':
      return sql`false`;
    default:
      return undefined;
  }
}

export function agentFilter(auth: AuthContext): string | null {
  return auth.perms.scope === 'own' ? auth.user.id : null;
}
