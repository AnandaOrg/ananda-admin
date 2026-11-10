import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { FLAVOURS, SALES_AVERAGE_WINDOW_DAYS, addDays, runway, type Flavour, type RunwayCalc } from '@ananda/shared';
import { InjectDb, type Db, type DbOrTx } from '../db/db.module';
import { orderLines, orders, purchaseLines, purchases, stockMovements, suppliers } from '../db/schema';

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

type ByFlavour = Record<Flavour, number>;
const zero = (): ByFlavour => ({ aloha: 0, gaia: 0, santorini: 0, kyoto: 0 });

/**
 * One definition for every stock figure (PRD §7.2):
 * in stock = Σ movements at the warehouse; reserved = units on allocated orders not yet sent;
 * available = in stock − reserved.
 */
@Injectable()
export class StockService {
  constructor(@InjectDb() private readonly db: Db) {}

  async inStock(tx: DbOrTx = this.db, eventId: string | null = null): Promise<ByFlavour> {
    const rows = await tx
      .select({ flavour: stockMovements.flavour, units: sql<number>`coalesce(sum(${stockMovements.units}), 0)::int` })
      .from(stockMovements)
      .where(eventId ? eq(stockMovements.eventId, eventId) : isNull(stockMovements.eventId))
      .groupBy(stockMovements.flavour);
    const out = zero();
    for (const r of rows) out[r.flavour] = Number(r.units);
    return out;
  }

  async reserved(tx: DbOrTx = this.db, excludeOrderId?: string): Promise<ByFlavour> {
    const rows = await tx
      .select({ flavour: orderLines.flavour, units: sql<number>`coalesce(sum(${orderLines.units}), 0)::int` })
      .from(orderLines)
      .innerJoin(orders, eq(orders.id, orderLines.orderId))
      .where(
        and(
          eq(orders.allocated, true),
          inArray(orders.status, ['payment_to_confirm', 'ready_to_send']),
          excludeOrderId ? sql`${orders.id} <> ${excludeOrderId}` : undefined,
        ),
      )
      .groupBy(orderLines.flavour);
    const out = zero();
    for (const r of rows) out[r.flavour] = Number(r.units);
    return out;
  }

  async available(tx: DbOrTx = this.db, excludeOrderId?: string): Promise<ByFlavour> {
    const [s, r] = await Promise.all([this.inStock(tx), this.reserved(tx, excludeOrderId)]);
    const out = zero();
    for (const f of FLAVOURS) out[f] = s[f] - r[f];
    return out;
  }

  /** Weighted average landed unit cost per flavour across received purchases. */
  async avgLandedCost(tx: DbOrTx = this.db): Promise<ByFlavour> {
    const rows = await tx
      .select({
        flavour: purchaseLines.flavour,
        cost: sql<number>`coalesce(sum(${purchases.landedUnitCostCents} * coalesce(${purchaseLines.unitsReceived}, ${purchaseLines.units})) / nullif(sum(coalesce(${purchaseLines.unitsReceived}, ${purchaseLines.units})), 0), 0)::float`,
      })
      .from(purchaseLines)
      .innerJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
      .where(and(eq(purchases.status, 'received'), sql`${purchases.landedUnitCostCents} is not null`))
      .groupBy(purchaseLines.flavour);
    const out = zero();
    for (const r of rows) out[r.flavour] = Number(r.cost);
    return out;
  }

  async overview(tx: DbOrTx = this.db): Promise<FlavourStock[]> {
    const since = addDays(new Date(), -SALES_AVERAGE_WINDOW_DAYS);
    const [inStock, reserved, cost, transit, sold, leadTimes] = await Promise.all([
      this.inStock(tx),
      this.reserved(tx),
      this.avgLandedCost(tx),
      tx
        .select({
          flavour: purchaseLines.flavour,
          units: sql<number>`sum(${purchaseLines.units})::int`,
          next: sql<string | null>`min(${purchases.expectedOn})::text`,
        })
        .from(purchaseLines)
        .innerJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
        .where(inArray(purchases.status, ['ordered', 'on_the_way']))
        .groupBy(purchaseLines.flavour),
      tx
        .select({ flavour: stockMovements.flavour, units: sql<number>`coalesce(-sum(${stockMovements.units}), 0)::int` })
        .from(stockMovements)
        .where(and(inArray(stockMovements.kind, ['dispatch', 'return', 'event_sale']), gte(stockMovements.createdAt, since)))
        .groupBy(stockMovements.flavour),
      this.defaultLeadTimes(tx),
    ]);
    return FLAVOURS.map((flavour) => {
      const t = transit.find((x) => x.flavour === flavour);
      const soldLast60 = Math.max(0, Number(sold.find((x) => x.flavour === flavour)?.units ?? 0));
      const available = inStock[flavour] - reserved[flavour];
      return {
        flavour,
        inStock: inStock[flavour],
        reserved: reserved[flavour],
        available,
        onTheWay: Number(t?.units ?? 0),
        nextArrivalOn: t?.next ?? null,
        avgLandedCostCents: cost[flavour],
        stockValueCents: Math.round(inStock[flavour] * cost[flavour]),
        soldLast60,
        leadTimeDays: leadTimes[flavour],
        runway: runway(available, soldLast60, leadTimes[flavour]),
      };
    });
  }

  async defaultLeadTimes(tx: DbOrTx = this.db): Promise<ByFlavour> {
    const rows = await tx.select({ lead: suppliers.leadTimeDays, defaults: suppliers.defaultFlavours }).from(suppliers).where(eq(suppliers.status, 'approved'));
    const out: ByFlavour = { aloha: 30, gaia: 30, santorini: 30, kyoto: 30 };
    for (const r of rows) for (const f of r.defaults as Flavour[]) out[f] = r.lead;
    return out;
  }

  async move(
    tx: DbOrTx,
    m: { flavour: Flavour; units: number; kind: (typeof stockMovements.$inferInsert)['kind']; reason?: string; note?: string; orderId?: string; purchaseId?: string; eventId?: string | null; byId?: string | null },
  ) {
    if (m.units === 0) return;
    await tx.insert(stockMovements).values({ ...m, eventId: m.eventId ?? null, byId: m.byId ?? null });
  }
}
