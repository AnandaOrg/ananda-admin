export interface AgentRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: 'invited' | 'active' | 'deactivated';
  language: string;
  customers: number;
  ordersThisMonth: number;
  lastOrderAt: string | null;
  readyCents: number;
  comingCents: number;
  sentCents: number;
  paidThisYearCents: number;
  lastNudgedAt: string | null;
  nudgedToday: boolean;
}

export interface AgentsOverview {
  tiles: { readyCents: number; readyAgents: number; comingCents: number; sentCents: number; didntSell: number; activeAgents: number; newCustomersThisMonth: number };
  didntSellIds: string[];
  agents: AgentRow[];
  terms: { commissionPerUnitCents: number; vatRate: number; inviteValidityDays: number };
  accountingEmail: string | null;
}

export type CommissionStatus = 'coming' | 'ready' | 'sent' | 'paid';

export interface CommissionEntry {
  id: string;
  /** Null for event sales (A13), which carry the event instead. */
  orderId: string | null;
  orderNumber: string | null;
  customerName: string | null;
  eventId: string | null;
  eventName: string | null;
  units: number;
  amountCents: number;
  status: CommissionStatus;
  note: string | null;
  createdAt: string;
  readyAt: string | null;
  sentAt: string | null;
  paidAt: string | null;
}

export interface Earnings {
  agent: { id: string; name: string };
  totals: { readyCents: number; comingCents: number; sentCents: number; paidThisYearCents: number };
  entries: CommissionEntry[];
}

export const COMMISSION_TONE: Record<CommissionStatus, 'mute' | 'good' | 'info'> = { coming: 'mute', ready: 'good', sent: 'info', paid: 'good' };

/**
 * The pay actions possible right now (FR-AGT-3, A4): Send to pay when something is ready, Mark as
 * paid once a statement was sent. `all` (agent panel) also allows marking Ready entries paid directly.
 */
export function payActions(a: Pick<AgentRow, 'readyCents' | 'sentCents'>, all = false): ('send' | 'paid')[] {
  const out: ('send' | 'paid')[] = [];
  if (a.readyCents > 0) out.push('send');
  if (a.sentCents > 0 || (all && a.readyCents > 0)) out.push('paid');
  return out;
}

/** What a commission entry is for: the order, or the event it was sold at. */
export const entryHref = (e: Pick<CommissionEntry, 'orderId' | 'eventId'>) => (e.orderId ? `/sales/${e.orderId}` : e.eventId ? `/events/${e.eventId}` : undefined);
