import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { FLAVOURS, STOCK_MOVEMENT_KINDS, UNITS_PER_CARTON, type Flavour } from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { events, orders, purchases, stockCounts, stockMovements, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { StockService } from '../core/stock.service';
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
  ) {}

  /** FR-INV-1, FR-INV-2. */
  async overview() {
    const [flavours, waiting, [counts]] = await Promise.all([
      this.stock.overview(),
      this.orders.waitingForStock(),
      this.db.select({ n: sql<number>`count(*)::int` }).from(stockCounts).where(isNull(stockCounts.reconciledAt)),
    ]);
    const sum = (k: 'available' | 'reserved' | 'onTheWay' | 'inStock' | 'stockValueCents') => flavours.reduce((s, f) => s + f[k], 0);
    const available = Object.fromEntries(flavours.map((f) => [f.flavour, f.available])) as ByFlavour;
    const needed = this.unitsNeeded(waiting);
    // Allocate is offered when stock is there for at least the oldest waiting order.
    const canAllocate = waiting.some((o) => o.lines.every((l) => available[l.flavour] >= l.units));
    return {
      totals: { available: sum('available'), reserved: sum('reserved'), onTheWay: sum('onTheWay'), inStock: sum('inStock'), stockValueCents: sum('stockValueCents') },
      flavours,
      waiting: { orders: waiting.length, unitsNeeded: needed, canAllocate },
      openCounts: Number(counts.n),
    };
  }

  private unitsNeeded(waiting: Awaited<ReturnType<OrdersService['waitingForStock']>>): ByFlavour {
    const out: ByFlavour = { aloha: 0, gaia: 0, santorini: 0, kyoto: 0 };
    for (const o of waiting) for (const l of o.lines) out[l.flavour] += l.units;
    return out;
  }

  /** FR-INV-3: what is available and which orders wait, oldest first. */
  async allocation() {
    const [available, waiting] = await Promise.all([this.stock.available(), this.orders.waitingForStock()]);
    const agentIds = [...new Set(waiting.map((o) => o.agentId))];
    const agents = agentIds.length ? await this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, agentIds)) : [];
    return {
      available,
      unitsNeeded: this.unitsNeeded(waiting),
      orders: waiting.map((o) => ({
        id: o.id,
        number: o.number,
        paidAt: o.paidAt,
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

  /** FR-INV-5: ledger newest first. */
  async movements(q: { flavour?: string; kind?: string; before?: string; limit?: string }) {
    const cond: SQL[] = [];
    if (q.flavour && (FLAVOURS as readonly string[]).includes(q.flavour)) cond.push(eq(stockMovements.flavour, q.flavour as Flavour));
    if (q.kind && (STOCK_MOVEMENT_KINDS as readonly string[]).includes(q.kind)) cond.push(eq(stockMovements.kind, q.kind as 'adjustment'));
    if (q.before) {
      const d = new Date(q.before);
      if (!Number.isNaN(d.getTime())) cond.push(lt(stockMovements.createdAt, d));
    }
    const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
    const rows = await this.db
      .select({
        m: stockMovements,
        by: users.name,
        orderNumber: orders.number,
        purchaseNumber: purchases.number,
        eventName: events.name,
      })
      .from(stockMovements)
      .leftJoin(users, eq(users.id, stockMovements.byId))
      .leftJoin(orders, eq(orders.id, stockMovements.orderId))
      .leftJoin(purchases, eq(purchases.id, stockMovements.purchaseId))
      .leftJoin(events, eq(events.id, stockMovements.eventId))
      .where(and(...cond))
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(limit + 1);
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({
      id: r.m.id,
      at: r.m.createdAt,
      flavour: r.m.flavour,
      units: r.m.units,
      kind: r.m.kind,
      reason: r.m.reason,
      note: r.m.note,
      atEvent: !!r.m.eventId,
      by: r.by,
      orderId: r.m.orderId,
      orderNumber: r.orderNumber,
      purchaseId: r.m.purchaseId,
      purchaseNumber: r.purchaseNumber,
      eventName: r.eventName,
    }));
    return { items, next: more ? items.at(-1)!.at : null };
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
