import type { Flavour, RunwayCalc } from '@ananda/shared';

export interface FlavourStock {
  flavour: Flavour;
  inStock: number;
  reserved: number;
  available: number;
  onTheWay: number;
  nextArrivalOn: string | null;
  avgLandedCostCents: number;
  stockValueCents: number;
  soldLast60: number;
  leadTimeDays: number;
  runway: RunwayCalc;
}

export interface InventoryOverview {
  totals: { available: number; reserved: number; onTheWay: number; inStock: number; stockValueCents: number; avgLandedCostCents: number };
  flavours: FlavourStock[];
  nextPurchase: { id: string; number: string; expectedOn: string; daysLate: number } | null;
  waiting: { orders: number; unitsNeeded: Record<Flavour, number>; canAllocate: boolean };
  openCounts: number;
  lastCount: { id: string; createdAt: string; reconciled: boolean; units: Record<Flavour, number> } | null;
}

/** Reasons offered in Stock adjustment (stored as keys, shown with inventory.adjust.reasons.*). */
export const ADJUST_REASONS = ['breakage', 'count_difference', 'samples', 'expired'] as const;

export interface AllocationData {
  available: Record<Flavour, number>;
  unitsNeeded: Record<Flavour, number>;
  fromPurchase: string | null;
  stockHoldDays: number;
  orders: { id: string; number: string; paidAt: string | null; since: string | null; customerName: string | null; brokerName: string | null; units: number; lines: { flavour: Flavour; cartons: number; units: number }[] }[];
}
