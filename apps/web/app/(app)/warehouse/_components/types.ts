import type { Flavour, OrderStatus } from '@ananda/shared';

/** What the warehouse sees of an order: quantities, names and addresses — never money. */
export interface ShipCard {
  id: string;
  number: string;
  status: OrderStatus;
  customerName: string;
  city: string | null;
  address: string;
  contactName: string;
  phone: string;
  sentAt: string | null;
  waitingDays: number;
  redelivery: boolean;
  partDelivered: boolean;
  lines: { flavour: Flavour; cartons: number; units: number }[];
  totalCartons: number;
  totalUnits: number;
}

/** One signed note: a full delivery, a part delivery or the delivery of the rest. */
export interface DeliveredRow {
  id: string;
  orderId: string;
  number: string;
  status: OrderStatus;
  deliveredAt: string | null;
  customerName: string;
  city: string | null;
  deliveredCartons: number;
  part: boolean;
  signedNoteId: string | null;
  mimeType: string | null;
}

export interface LastCount {
  id: string;
  at: string;
  byName: string;
  cartons: number;
  cartonsOff?: number;
  reconciled?: boolean;
}

export interface WarehouseOverview {
  site: string | null;
  tiles: { toShipOrders: number; toShipNumbers: string[]; toShipCartons: number; deliveredThisMonth: number; lastCount: LastCount | null };
  toShip: ShipCard[];
  delivered: DeliveredRow[];
}

/** Days between a date and today, in the viewer's calendar (0 = today). */
export function daysAgo(d: string | null): number | null {
  if (!d) return null;
  const a = new Date(d);
  const now = new Date();
  const x = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const y = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((y - x) / 86_400_000);
}

export const noteUrl = (id: string) => `/api/documents/${id}/file`;

export function mapsUrl(o: Pick<ShipCard, 'address' | 'city'>) {
  const q = [o.address, o.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
