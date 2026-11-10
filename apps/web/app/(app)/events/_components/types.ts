import type { Flavour } from '@ananda/shared';

export type EventStatus = 'upcoming' | 'on' | 'past';
export type EventKind = 'event' | 'festival';

export interface EventItem {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  place: string;
  kind: EventKind;
  status: EventStatus;
  agents: { id: string; name: string }[];
  stockUnits: number;
  soldUnits: number;
  /** Only sent to users who can see Expenses. */
  expensesCents?: number;
}

export interface EventsList {
  tiles: { stockUnits: number; eventsWithStock: number; salesThisYearUnits: number; expensesThisYearCents?: number };
  items: EventItem[];
}

export interface EventDetail {
  event: { id: string; name: string; startsOn: string; endsOn: string; place: string; kind: EventKind; status: EventStatus; createdAt: string };
  agents: { id: string; name: string }[];
  stock: { flavour: Flavour; units: number; cartons: number; movedUnits: number; soldUnits: number }[];
  totals: { stockUnits: number; soldUnits: number; movedUnits: number };
  warehouseAvailableCartons: Record<Flavour, number> | null;
  sales: { agentId: string; name: string; units: number; cartons: number; byFlavour: Record<Flavour, number>; commissionCents: number }[];
  movements: { id: string; flavour: Flavour; units: number; kind: 'event_out' | 'event_in' | 'event_sale'; createdAt: string; byName: string | null }[];
  expenses?: { id: string; spentOn: string; category: string; description: string; netCents: number; totalCents: number; paid: boolean }[];
  expensesCents?: number;
  canEdit: boolean;
}

export const STATUS_TONE: Record<EventStatus, 'info' | 'good' | 'mute'> = { upcoming: 'info', on: 'good', past: 'mute' };
