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
  totals: { available: number; reserved: number; onTheWay: number; inStock: number; stockValueCents: number };
  flavours: FlavourStock[];
  waiting: { orders: number; unitsNeeded: Record<Flavour, number>; canAllocate: boolean };
  openCounts: number;
}

export interface AllocationData {
  available: Record<Flavour, number>;
  unitsNeeded: Record<Flavour, number>;
  orders: { id: string; number: string; paidAt: string | null; customerName: string | null; agentName: string | null; units: number; lines: { flavour: Flavour; cartons: number; units: number }[] }[];
}
