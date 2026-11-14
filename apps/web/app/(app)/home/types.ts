import type { Flavour } from '@ananda/shared';

export interface Attention {
  kind: string;
  count: number;
  cents?: number;
  oldestDays?: number;
  detail?: string | null;
  link: string;
  items?: unknown[];
  paidCount?: number;
  canIssue?: boolean;
  canAllocate?: boolean;
  canRecord?: boolean;
  tone?: 'bad' | 'warn';
  purchase?: { id: string; number: string; status: string } | null;
  numbers?: string[];
  oldest?: { customerName: string | null; createdAt: string };
  daysOld?: number | null;
}

export interface OkRow {
  kind: 'new_customer' | 'special_price' | 'correction' | 'payment';
  id: string;
  status: 'pending' | 'approved' | 'declined';
  decidedAt?: string | null;
  customerId?: string | null;
  customerName: string | null;
  agentName: string;
  orderId?: string | null;
  orderNumber?: string | null;
  reason?: string | null;
  totalCents?: number | null;
  summary?: { vat?: 'valid' | 'invalid' | 'unchecked' | 'none'; unitPriceCents?: number; tierUnitPriceCents?: number; fewer?: Flavour[]; more?: Flavour[] };
}

export interface Step {
  kind: 'approve_customer' | 'draft' | 'send_draft' | 'reorder';
  cents: number;
  id: string;
  label: string;
  number?: string;
  agentId?: string | null;
  agentName?: string | null;
  agentEmail?: string | null;
  since?: string | null;
  link: string;
}

export interface HomeData {
  today: string;
  tiles: {
    salesMonth: { cents: number; couldCloseCents: number; couldCloseCount: number; requestsCents: number; draftsCents: number; lastYearCents: number };
    owed: { cents: number; lateCents: number; lateCount: number; oldestLateDays: number };
    salesYear: { cents: number; units: number; deals: number; lastYearCents: number; changePct: number | null };
    dealProfitYear: { cents: number; deals: number; awaitingPayment: number } | null;
    commission: { readyCents: number; comingCents: number } | null;
  };
  whatToDo: { lastSaleAt: string | null; steps: Step[] };
  needsYourOk: OkRow[];
  attention: Attention[];
  stock: { flavour: Flavour; available: number; reserved: number; onTheWay: number; nextArrivalOn: string | null; status: 'ok' | 'reorder_soon' | 'reorder_now'; runsOutOn: string | null; monthsLeft: number | null }[] | null;
  onboarding: { key: string; done: boolean; link: string; unlocked: boolean }[] | null;
}
