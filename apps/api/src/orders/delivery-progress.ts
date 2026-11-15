import type { OrderStatus } from '@ananda/shared';

/**
 * How much of an order has gone out. `part` = some cartons were delivered, the rest has not been
 * (still at the warehouse, or came back) and will still ship. Not a status: the order status is unchanged.
 * An order closed with the credit-note outcome never ships the rest, so it is not "part" any more.
 * The one definition: the order page and the unpaid part-delivery alert both use this.
 */
export function deliveryProgress(status: OrderStatus, totalCartons: number, lines: { deliveredCartons: number | null }[], outcome?: 'credit_note' | 'redeliver' | null) {
  const deliveredCartons = lines.reduce((s, l) => s + (l.deliveredCartons ?? 0), 0);
  const part = (status === 'at_warehouse' || status === 'delivered_part') && outcome !== 'credit_note' && deliveredCartons > 0 && deliveredCartons < totalCartons;
  return { deliveredCartons, totalCartons, part };
}

/** Statuses an order can be in while still part delivered (to pre-filter queries; `deliveryProgress` decides). */
export const PART_DELIVERY_STATUSES: OrderStatus[] = ['at_warehouse', 'delivered_part'];
