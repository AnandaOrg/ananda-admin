// Core vocabulary of the business: flavours, cartons, prices, VAT, commission, excise.
// Every derived figure in the app is computed here so it has one definition (PRD §1.2, §7).

export const FLAVOURS = ['aloha', 'gaia', 'santorini', 'kyoto'] as const;
export type Flavour = (typeof FLAVOURS)[number];

export const UNITS_PER_CARTON = 24;
export const MIN_ORDER_CARTONS = 42;
export const VAT_RATE = 0.2;
export const COMMISSION_PER_UNIT_CENTS = 50;
export const STOCK_HOLD_DAYS = 7;
export const PROFORMA_VALIDITY_DAYS = 7;
export const OWNERSHIP_MONTHS = 6;
export const OWNERSHIP_WARNING_DAYS = 30;
export const SALES_AVERAGE_WINDOW_DAYS = 60;

// Excise: €562.42 per hectolitre of pure alcohol; 0.25 L pouch at 13% ABV.
export const EXCISE_EUR_PER_HL_PURE = 562.42;
export const PACK_LITRES = 0.25;
export const ALCOHOL_BY_VOLUME = 0.13;
export const EXCISE_PER_UNIT_EUR = (PACK_LITRES * ALCOHOL_BY_VOLUME * EXCISE_EUR_PER_HL_PURE) / 100;

export interface PriceTier {
  minCartons: number;
  maxCartons: number;
  unitPriceCents: number;
  requiresAdvanceOrCommitment: boolean;
}

// PRD §7.1 — the tier is chosen by the order's total cartons across all flavours.
export const PRICE_TIERS: PriceTier[] = [
  { minCartons: 42, maxCartons: 209, unitPriceCents: 515, requiresAdvanceOrCommitment: false },
  { minCartons: 210, maxCartons: 416, unitPriceCents: 510, requiresAdvanceOrCommitment: false },
  { minCartons: 417, maxCartons: 833, unitPriceCents: 505, requiresAdvanceOrCommitment: false },
  { minCartons: 834, maxCartons: 1666, unitPriceCents: 502, requiresAdvanceOrCommitment: true },
  { minCartons: 1667, maxCartons: 2499, unitPriceCents: 497, requiresAdvanceOrCommitment: true },
  { minCartons: 2500, maxCartons: 3333, unitPriceCents: 493, requiresAdvanceOrCommitment: true },
  { minCartons: 3334, maxCartons: 4166, unitPriceCents: 488, requiresAdvanceOrCommitment: true },
];

export function tierFor(totalCartons: number): PriceTier | null {
  if (totalCartons < MIN_ORDER_CARTONS) return null;
  return (
    PRICE_TIERS.find((t) => totalCartons >= t.minCartons && totalCartons <= t.maxCartons) ??
    PRICE_TIERS[PRICE_TIERS.length - 1]
  );
}

/** Tier used for display while a draft is still below the minimum. */
export function displayTierFor(totalCartons: number): PriceTier {
  return tierFor(totalCartons) ?? PRICE_TIERS[0];
}

export type CartonsByFlavour = Partial<Record<Flavour, number>>;

export interface OrderLineCalc {
  flavour: Flavour;
  cartons: number;
  units: number;
  unitPriceCents: number;
  lineNetCents: number;
}

export interface OrderCalc {
  lines: OrderLineCalc[];
  totalCartons: number;
  totalUnits: number;
  tier: PriceTier;
  tierUnitPriceCents: number;
  unitPriceCents: number;
  netCents: number;
  vatCents: number;
  totalCents: number;
  commissionCents: number;
  cartonsShort: number;
  meetsMinimum: boolean;
}

export function cartonsTotal(cartons: CartonsByFlavour): number {
  return FLAVOURS.reduce((s, f) => s + Math.max(0, Math.floor(cartons[f] ?? 0)), 0);
}

/** VAT is rounded once per document (default until the accountant confirms, PRD §7.2). */
export function vatOf(netCents: number): number {
  return Math.round(netCents * VAT_RATE);
}

/**
 * Commission = units × €0.50, minus any special-price reduction (special prices are paid
 * out of the agent's commission), never below zero.
 */
export function commissionFor(units: number, tierUnitPriceCents: number, unitPriceCents: number): number {
  const reduction = Math.max(0, tierUnitPriceCents - unitPriceCents) * units;
  return Math.max(0, units * COMMISSION_PER_UNIT_CENTS - reduction);
}

export function calculateOrder(cartons: CartonsByFlavour, specialUnitPriceCents?: number | null): OrderCalc {
  const totalCartons = cartonsTotal(cartons);
  const tier = displayTierFor(totalCartons);
  const unitPriceCents = specialUnitPriceCents ?? tier.unitPriceCents;
  const lines: OrderLineCalc[] = FLAVOURS.filter((f) => (cartons[f] ?? 0) > 0).map((flavour) => {
    const c = Math.floor(cartons[flavour] ?? 0);
    const units = c * UNITS_PER_CARTON;
    return { flavour, cartons: c, units, unitPriceCents, lineNetCents: units * unitPriceCents };
  });
  const totalUnits = totalCartons * UNITS_PER_CARTON;
  const netCents = lines.reduce((s, l) => s + l.lineNetCents, 0);
  const vatCents = vatOf(netCents);
  return {
    lines,
    totalCartons,
    totalUnits,
    tier,
    tierUnitPriceCents: tier.unitPriceCents,
    unitPriceCents,
    netCents,
    vatCents,
    totalCents: netCents + vatCents,
    commissionCents: commissionFor(totalUnits, tier.unitPriceCents, unitPriceCents),
    cartonsShort: Math.max(0, MIN_ORDER_CARTONS - totalCartons),
    meetsMinimum: totalCartons >= MIN_ORDER_CARTONS,
  };
}

export function exciseCentsForUnits(units: number): number {
  return Math.round(units * EXCISE_PER_UNIT_EUR * 100);
}

/** Landed unit cost in cents (may be fractional): (goods + freight + excise) ÷ units received. */
export function landedUnitCostCents(goodsCents: number, freightCents: number, exciseCents: number, unitsReceived: number): number {
  if (unitsReceived <= 0) return 0;
  return (goodsCents + freightCents + exciseCents) / unitsReceived;
}

/** Deal profit = net sales − units × landed unit cost − commission. */
export function dealProfitCents(netCents: number, purchaseCostCents: number, commissionCents: number): number {
  return netCents - purchaseCostCents - commissionCents;
}

export type ReorderStatus = 'ok' | 'reorder_soon' | 'reorder_now';

export interface RunwayCalc {
  soldPerDay: number;
  daysLeft: number | null;
  runsOutOn: string | null;
  status: ReorderStatus;
  monthsLeft: number | null;
}

/** Runs out = available ÷ average units sold per day (60 days); compared to supplier lead time. */
export function runway(available: number, unitsSoldInWindow: number, leadTimeDays: number, today = new Date()): RunwayCalc {
  const soldPerDay = unitsSoldInWindow / SALES_AVERAGE_WINDOW_DAYS;
  if (soldPerDay <= 0) return { soldPerDay: 0, daysLeft: null, runsOutOn: null, status: 'ok', monthsLeft: null };
  const daysLeft = Math.floor(available / soldPerDay);
  const runsOut = new Date(today);
  runsOut.setDate(runsOut.getDate() + daysLeft);
  const status: ReorderStatus = daysLeft <= leadTimeDays ? 'reorder_now' : daysLeft <= leadTimeDays + 30 ? 'reorder_soon' : 'ok';
  return {
    soldPerDay,
    daysLeft,
    runsOutOn: runsOut.toISOString().slice(0, 10),
    status,
    monthsLeft: Math.round((daysLeft / 30) * 10) / 10,
  };
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}
