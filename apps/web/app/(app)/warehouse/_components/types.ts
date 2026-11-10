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
  lines: { flavour: Flavour; cartons: number; units: number }[];
  totalCartons: number;
  totalUnits: number;
}

export interface DeliveredRow {
  id: string;
  number: string;
  status: OrderStatus;
  deliveredAt: string | null;
  customerName: string;
  city: string | null;
  deliveredCartons: number;
  signedNoteId: string | null;
}

export interface LastCount {
  id: string;
  at: string;
  byName: string;
  cartonsOff?: number;
  reconciled?: boolean;
}

export interface WarehouseOverview {
  tiles: { toShipOrders: number; toShipCartons: number; readyOrders: number; deliveredThisMonth: number; lastCount: LastCount | null };
  toShip: ShipCard[];
  ready: ShipCard[];
  delivered: DeliveredRow[];
}

export const noteUrl = (id: string) => `/api/documents/${id}/file`;

export function mapsUrl(o: Pick<ShipCard, 'address' | 'city'>) {
  const q = [o.address, o.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
