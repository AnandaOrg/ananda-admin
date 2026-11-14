import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { FLAVOURS, STOCK_MOVEMENT_KINDS, UNITS_PER_CARTON, isoDate, type Flavour } from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { customers, events, orders, purchases, stockCounts, stockMovements, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { StockService } from '../core/stock.service';
import { SettingsService } from '../core/settings.service';
import { OrdersService } from '../orders/orders.service';
import type { AuthContext } from '../common/context';

type ByFlavour = Record<Flavour, number>;

/** Stock changes are serialised so two adjustments never read the same "in stock". */
async function lockStock(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ananda:stock'))`);
}

/** Inventory (PRD §5.6). Every figure comes from StockService; orders move only through OrdersService. */
@Injectable()
export class InventoryService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly settings: SettingsService,
  ) {}

  /** The open purchase that arrives first (late ones first), for "On the way" and "waiting for P-…". */
  private async nextPurchase() {
    const [p] = await this.db
      .select({ id: purchases.id, number: purchases.number, expectedOn: purchases.expectedOn })
      .from(purchases)
      .where(inArray(purchases.status, ['ordered', 'on_the_way']))
      .orderBy(asc(purchases.expectedOn), asc(purchases.number))
      .limit(1);
    if (!p) return null;
    const today = isoDate();
    const daysLate = p.expectedOn < today ? Math.floor((Date.parse(today) - Date.parse(p.expectedOn)) / 86_400_000) : 0;
    return { ...p, daysLate };
  }

  /** The warehouse's latest blind count this month, shown on each flavour card. */
  private async lastCountThisMonth() {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const [c] = await this.db.select().from(stockCounts).where(gte(stockCounts.createdAt, start)).orderBy(desc(stockCounts.createdAt)).limit(1);
    if (!c) return null;
    return { id: c.id, createdAt: c.createdAt, reconciled: !!c.reconciledAt, units: Object.fromEntries(FLAVOURS.map((f) => [f, Number(c.cartons[f] ?? 0) * UNITS_PER_CARTON])) as ByFlavour };
  }

  /** FR-INV-1, FR-INV-2. */
  async overview() {
    const [flavours, waiting, [counts], next, lastCount] = await Promise.all([
      this.stock.overview(),
      this.orders.waitingForStock(),
      this.db.select({ n: sql<number>`count(*)::int` }).from(stockCounts).where(isNull(stockCounts.reconciledAt)),
      this.nextPurchase(),
      this.lastCountThisMonth(),
    ]);
    const sum = (k: 'available' | 'reserved' | 'onTheWay' | 'inStock' | 'stockValueCents') => flavours.reduce((s, f) => s + f[k], 0);
    const available = Object.fromEntries(flavours.map((f) => [f.flavour, f.available])) as ByFlavour;
    const needed = this.unitsNeeded(waiting);
    // Allocate is offered when stock is there for at least the oldest waiting order.
    const canAllocate = waiting.some((o) => o.lines.every((l) => available[l.flavour] >= l.units));
    const inStock = sum('inStock');
    const stockValueCents = sum('stockValueCents');
    return {
      totals: { available: sum('available'), reserved: sum('reserved'), onTheWay: sum('onTheWay'), inStock, stockValueCents, avgLandedCostCents: inStock > 0 ? stockValueCents / inStock : 0 },
      flavours,
      nextPurchase: next,
      waiting: { orders: waiting.length, unitsNeeded: needed, canAllocate },
      openCounts: Number(counts.n),
      lastCount,
    };
  }

  private unitsNeeded(waiting: Awaited<ReturnType<OrdersService['waitingForStock']>>): ByFlavour {
    const out: ByFlavour = { aloha: 0, gaia: 0, santorini: 0, kyoto: 0 };
    for (const o of waiting) for (const l of o.lines) out[l.flavour] += l.units;
    return out;
  }

  /** FR-INV-3: what is available and which orders wait, oldest first. */
  async allocation() {
    const [available, waiting, rules, [received]] = await Promise.all([
      this.stock.available(),
      this.orders.waitingForStock(),
      this.settings.rules(),
      this.db.select({ number: purchases.number, arrivedOn: purchases.arrivedOn }).from(purchases).where(eq(purchases.status, 'received')).orderBy(desc(purchases.arrivedOn), desc(purchases.number)).limit(1),
    ]);
    const agentIds = [...new Set(waiting.map((o) => o.agentId))];
    const agents = agentIds.length ? await this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, agentIds)) : [];
    const ids = waiting.map((o) => o.id);
    const times = ids.length ? await this.db.select({ id: orders.id, requestSentAt: orders.requestSentAt, createdAt: orders.createdAt }).from(orders).where(inArray(orders.id, ids)) : [];
    const since = (o: (typeof waiting)[number]) => {
      const t = times.find((x) => x.id === o.id);
      return o.paidAt ?? t?.requestSentAt ?? t?.createdAt ?? null;
    };
    // The purchase that brought the stock: the latest one received after the oldest order started waiting.
    const oldest = waiting.map(since).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    const fromPurchase = received?.arrivedOn && oldest && received.arrivedOn >= isoDate(oldest) ? received.number : null;
    return {
      available,
      unitsNeeded: this.unitsNeeded(waiting),
      fromPurchase,
      stockHoldDays: rules.stockHoldDays,
      orders: waiting.map((o) => ({
        id: o.id,
        number: o.number,
        paidAt: o.paidAt,
        since: since(o),
        customerName: o.customerName,
        agentName: agents.find((a) => a.id === o.agentId)?.name ?? null,
        lines: FLAVOURS.flatMap((f) => o.lines.filter((l) => l.flavour === f)),
        units: o.lines.reduce((s, l) => s + l.units, 0),
      })),
    };
  }

  allocate(auth: AuthContext, orderIds: string[]) {
    return this.orders.allocate(auth, orderIds);
  }

  /** FR-INV-4: written to stock movements and the audit log in one transaction. */
  async adjust(auth: AuthContext, input: { flavour: Flavour; cartons: number; reason: string; note?: string }) {
    return this.db.transaction(async (tx) => {
      await lockStock(tx);
      const inStock = await this.stock.inStock(tx);
      const units = input.cartons * UNITS_PER_CARTON;
      const after = inStock[input.flavour] + units;
      if (after < 0) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { cartons: `There are only ${Math.floor(inStock[input.flavour] / UNITS_PER_CARTON)} cartons in stock` } });
      await this.stock.move(tx, { flavour: input.flavour, units, kind: 'adjustment', reason: input.reason, note: input.note || undefined, byId: auth.user.id });
      await this.audit.log(
        auth,
        {
          category: 'stock',
          action: 'stock_adjusted',
          recordType: 'stock',
          recordId: input.flavour,
          recordLabel: input.flavour.toUpperCase(),
          changes: { inStock: { from: inStock[input.flavour], to: after } },
          meta: { units, cartons: input.cartons, reason: input.reason, note: input.note ?? null },
        },
        tx,
      );
      return { flavour: input.flavour, units, inStock: after };
    });
  }

  /**
   * FR-INV-5: the warehouse ledger (the same rows that make "In stock"), newest first. One row per change:
   * the flavours written together (same second, reason and record) are grouped.
   */
  async movements(q: { flavour?: string; kind?: string; before?: string; limit?: string }) {
    const cond: SQL[] = [isNull(stockMovements.eventId)];
    if (q.flavour && (FLAVOURS as readonly string[]).includes(q.flavour)) cond.push(eq(stockMovements.flavour, q.flavour as Flavour));
    if (q.kind && (STOCK_MOVEMENT_KINDS as readonly string[]).includes(q.kind)) cond.push(eq(stockMovements.kind, q.kind as 'adjustment'));
    if (q.before) {
      const d = new Date(q.before);
      if (!Number.isNaN(d.getTime())) cond.push(lt(stockMovements.createdAt, d));
    }
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    const raw = limit * FLAVOURS.length;
    const rows = await this.db
      .select({
        m: stockMovements,
        by: users.name,
        orderNumber: orders.number,
        customerName: customers.companyName,
        purchaseNumber: purchases.number,
        eventName: events.name,
      })
      .from(stockMovements)
      .leftJoin(users, eq(users.id, stockMovements.byId))
      .leftJoin(orders, eq(orders.id, stockMovements.orderId))
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(purchases, eq(purchases.id, stockMovements.purchaseId))
      .leftJoin(events, eq(events.id, stockMovements.eventId))
      .where(and(...cond))
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(raw + 1);
    const overflow = rows.length > raw;
    type Row = (typeof rows)[number];
    const key = (r: Row) => [Math.floor(r.m.createdAt.getTime() / 1000), r.m.kind, r.m.orderId, r.m.purchaseId, r.m.eventId, r.m.byId, r.m.reason, r.m.note].join('|');
    const groups: Row[][] = [];
    for (const r of rows.slice(0, raw)) {
      const last = groups.at(-1);
      if (last && key(last[0]) === key(r)) last.push(r);
      else groups.push([r]);
    }
    // The last group may be cut by the fetch limit; leave it for the next page.
    if (overflow && groups.length > 1) groups.pop();
    const more = overflow || groups.length > limit;
    const kept = groups.slice(0, limit);
    // Stock moved to or from an event is written twice (warehouse and event); name the event from its twin row.
    const evRows = kept.flatMap((g) => g).filter((r) => r.m.kind === 'event_out' || r.m.kind === 'event_in');
    const twins = evRows.length
      ? await this.db
          .select({ kind: stockMovements.kind, flavour: stockMovements.flavour, units: stockMovements.units, at: stockMovements.createdAt, name: events.name })
          .from(stockMovements)
          .innerJoin(events, eq(events.id, stockMovements.eventId))
          .where(inArray(stockMovements.kind, ['event_out', 'event_in']))
      : [];
    const eventOf = (g: Row[]) =>
      g[0].eventName ??
      twins.find((t) => g.some((r) => t.kind === r.m.kind && t.flavour === r.m.flavour && t.units === -r.m.units && Math.abs(t.at.getTime() - r.m.createdAt.getTime()) < 5000))?.name ??
      null;
    const items = kept.map((g) => {
      const r = g[0];
      const lines = FLAVOURS.flatMap((f) => g.filter((x) => x.m.flavour === f).map((x) => ({ flavour: f, units: x.m.units })));
      return {
        id: r.m.id,
        at: r.m.createdAt,
        flavours: lines.map((l) => l.flavour),
        lines,
        units: lines.reduce((s, l) => s + l.units, 0),
        kind: r.m.kind,
        reason: r.m.reason,
        note: r.m.note,
        atEvent: !!r.m.eventId,
        by: r.by,
        orderId: r.m.orderId,
        orderNumber: r.orderNumber,
        customerName: r.customerName,
        purchaseId: r.m.purchaseId,
        purchaseNumber: r.purchaseNumber,
        eventName: eventOf(g),
      };
    });
    return { items, next: more && kept.length ? kept.at(-1)!.at(-1)!.m.createdAt : null };
  }

  /** FR-INV-6: blind counts from the warehouse, open ones first. */
  async counts() {
    const counter = alias(users, 'counter');
    const reconciler = alias(users, 'reconciler');
    const rows = await this.db
      .select({ c: stockCounts, countedBy: counter.name, reconciledBy: reconciler.name })
      .from(stockCounts)
      .leftJoin(counter, eq(counter.id, stockCounts.countedById))
      .leftJoin(reconciler, eq(reconciler.id, stockCounts.reconciledById))
      .orderBy(sql`${stockCounts.reconciledAt} is not null`, desc(stockCounts.createdAt))
      .limit(100);
    return {
      items: rows.map((r) => ({
        id: r.c.id,
        createdAt: r.c.createdAt,
        countedBy: r.countedBy,
        reconciledAt: r.c.reconciledAt,
        reconciledBy: r.reconciledBy,
        lines: FLAVOURS.map((f) => {
          const counted = Number(r.c.cartons[f] ?? 0);
          const expected = Number(r.c.expectedCartons[f] ?? 0);
          return { flavour: f, counted, expected, difference: counted - expected };
        }),
      })),
    };
  }

  /** "Correct with adjustment": one adjustment per flavour for the difference, then reconciled. */
  async reconcile(auth: AuthContext, id: string, note?: string) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.select().from(stockCounts).where(eq(stockCounts.id, id)).for('update');
      if (!c) throw new NotFoundException({ message: 'Stock count not found' });
      if (c.reconciledAt) throw new ConflictException({ message: 'This count has already been reconciled' });
      await lockStock(tx);
      const before = await this.stock.inStock(tx);
      const label = `Stock count ${c.createdAt.toISOString().slice(0, 10)}`;
      const adjusted: Record<string, number> = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const f of FLAVOURS) {
        const diffCartons = Number(c.cartons[f] ?? 0) - Number(c.expectedCartons[f] ?? 0);
        if (!diffCartons) continue;
        const units = diffCartons * UNITS_PER_CARTON;
        await this.stock.move(tx, { flavour: f, units, kind: 'adjustment', reason: 'count_difference', note: note ? `${label} · ${note}` : label, byId: auth.user.id });
        adjusted[f] = diffCartons;
        changes[`inStock.${f}`] = { from: before[f], to: before[f] + units };
      }
      await tx.update(stockCounts).set({ reconciledAt: new Date(), reconciledById: auth.user.id }).where(eq(stockCounts.id, id));
      await this.audit.log(auth, { category: 'stock', action: 'stock_count_reconciled', recordType: 'stock_count', recordId: id, recordLabel: label, changes, meta: { adjustedCartons: adjusted, note: note ?? null } }, tx);
      return { adjusted };
    });
  }
}
