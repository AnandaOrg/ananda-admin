import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { FLAVOURS, UNITS_PER_CARTON, canEdit, canView, isoDate, type CartonsByFlavour, type EventInput, type Flavour } from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { commissionEntries, events, expenses, roles, stockMovements, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { NotifyService } from '../core/notify.service';
import { SettingsService } from '../core/settings.service';
import { StockService } from '../core/stock.service';
import { agentFilter } from '../core/scope';
import type { AuthContext } from '../common/context';

type ByFlavour = Record<Flavour, number>;
type EventRow = typeof events.$inferSelect;

function statusOf(e: Pick<EventRow, 'startsOn' | 'endsOn'>, today = isoDate()): 'upcoming' | 'on' | 'past' {
  if (e.startsOn > today) return 'upcoming';
  if (e.endsOn < today) return 'past';
  return 'on';
}
const sumOf = (b: ByFlavour) => FLAVOURS.reduce((s, f) => s + b[f], 0);
const zero = (): ByFlavour => ({ aloha: 0, gaia: 0, santorini: 0, kyoto: 0 });

/**
 * Events & festivals (PRD §5.9). An event holds its own stock in the ledger (stock_movements with
 * event_id): moving cartons to an event writes −units at the warehouse and +units at the event.
 * Event sales are recorded as event_sale movements whose `by_id` is the agent who sold them.
 */
@Injectable()
export class EventsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly settings: SettingsService,
  ) {}

  /** Agents see the events they are invited to; everyone else with access sees all. */
  private scope(auth: AuthContext): SQL | undefined {
    const own = agentFilter(auth);
    return own ? sql`${events.agentIds} @> ${JSON.stringify([own])}::jsonb` : undefined;
  }

  private seesCosts(auth: AuthContext) {
    return canView(auth.perms.areas, 'expenses');
  }

  async list(auth: AuthContext) {
    const rows = await this.db.select().from(events).where(this.scope(auth)).orderBy(desc(events.startsOn));
    const ids = rows.map((r) => r.id);
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const costs = this.seesCosts(auth);
    const [ledger, sales, spend, names] = ids.length
      ? await Promise.all([
          this.db
            .select({ eventId: stockMovements.eventId, units: sql<number>`coalesce(sum(${stockMovements.units}), 0)::int`, sold: sql<number>`coalesce(-sum(${stockMovements.units}) filter (where ${stockMovements.kind} = 'event_sale'), 0)::int` })
            .from(stockMovements)
            .where(inArray(stockMovements.eventId, ids))
            .groupBy(stockMovements.eventId),
          this.db
            .select({ units: sql<number>`coalesce(-sum(${stockMovements.units}), 0)::int` })
            .from(stockMovements)
            .where(and(inArray(stockMovements.eventId, ids), eq(stockMovements.kind, 'event_sale'), gte(stockMovements.createdAt, yearStart))),
          costs
            ? this.db
                .select({ eventId: expenses.eventId, netCents: sql<number>`coalesce(sum(${expenses.netCents}), 0)::int`, yearCents: sql<number>`coalesce(sum(${expenses.netCents}) filter (where ${expenses.spentOn} >= ${isoDate(yearStart)}), 0)::int` })
                .from(expenses)
                .where(inArray(expenses.eventId, ids))
                .groupBy(expenses.eventId)
            : Promise.resolve([] as { eventId: string | null; netCents: number; yearCents: number }[]),
          this.agentNames(rows.flatMap((r) => r.agentIds)),
        ])
      : [[], [{ units: 0 }], [], new Map<string, string>()];
    const today = isoDate();
    const items = rows.map((r) => {
      const l = ledger.find((x) => x.eventId === r.id);
      const e = spend.find((x) => x.eventId === r.id);
      return {
        id: r.id,
        name: r.name,
        startsOn: r.startsOn,
        endsOn: r.endsOn,
        place: r.place,
        kind: r.kind,
        status: statusOf(r, today),
        agents: r.agentIds.map((id) => ({ id, name: names.get(id) ?? '' })),
        stockUnits: Number(l?.units ?? 0),
        soldUnits: Number(l?.sold ?? 0),
        ...(costs ? { expensesCents: Number(e?.netCents ?? 0) } : {}),
      };
    });
    return {
      tiles: {
        stockUnits: items.reduce((s, i) => s + i.stockUnits, 0),
        eventsWithStock: items.filter((i) => i.stockUnits > 0).length,
        salesThisYearUnits: Number(sales[0]?.units ?? 0),
        ...(costs ? { expensesThisYearCents: spend.reduce((s, x) => s + Number(x.yearCents), 0) } : {}),
      },
      items,
    };
  }

  private async agentNames(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async load(auth: AuthContext, id: string, tx: Db | Tx = this.db, lock = false) {
    const q = tx.select().from(events).where(and(eq(events.id, id), this.scope(auth)));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw new NotFoundException({ message: 'Event not found' });
    return row;
  }

  async detail(auth: AuthContext, id: string) {
    const e = await this.load(auth, id);
    const costs = this.seesCosts(auth);
    const edit = canEdit(auth.perms.areas, 'events') && !agentFilter(auth);
    const [atEvent, available, moves, names, spend, rules] = await Promise.all([
      this.stock.inStock(this.db, id),
      edit ? this.stock.available(this.db) : Promise.resolve(null),
      this.db
        .select({ id: stockMovements.id, flavour: stockMovements.flavour, units: stockMovements.units, kind: stockMovements.kind, createdAt: stockMovements.createdAt, byId: stockMovements.byId, byName: users.name })
        .from(stockMovements)
        .leftJoin(users, eq(users.id, stockMovements.byId))
        .where(eq(stockMovements.eventId, id))
        .orderBy(desc(stockMovements.createdAt)),
      this.agentNames(e.agentIds),
      costs
        ? this.db
            .select({ id: expenses.id, spentOn: expenses.spentOn, category: expenses.category, description: expenses.description, netCents: expenses.netCents, totalCents: expenses.totalCents, paid: expenses.paid })
            .from(expenses)
            .where(eq(expenses.eventId, id))
            .orderBy(desc(expenses.spentOn))
        : Promise.resolve(null),
      this.settings.rules(),
    ]);
    const moved = zero();
    const sold = zero();
    const bySeller = new Map<string, { agentId: string; name: string; units: ByFlavour }>();
    for (const m of moves) {
      if (m.kind === 'event_out' || m.kind === 'event_in') moved[m.flavour] += m.units;
      if (m.kind === 'event_sale') {
        sold[m.flavour] -= m.units;
        const key = m.byId ?? 'unknown';
        const s = bySeller.get(key) ?? { agentId: key, name: m.byName ?? '', units: zero() };
        s.units[m.flavour] -= m.units;
        bySeller.set(key, s);
      }
    }
    const own = agentFilter(auth);
    const sales = [...bySeller.values()]
      .filter((s) => !own || s.agentId === own)
      .map((s) => {
        const units = sumOf(s.units);
        // A13: event sales earn the normal commission; each sale also writes a Ready to pay entry.
        return { agentId: s.agentId, name: s.name, units, cartons: Math.floor(units / UNITS_PER_CARTON), byFlavour: s.units, commissionCents: units * rules.commissionPerUnitCents };
      });
    return {
      event: { id: e.id, name: e.name, startsOn: e.startsOn, endsOn: e.endsOn, place: e.place, kind: e.kind, status: statusOf(e), createdAt: e.createdAt },
      agents: e.agentIds.map((a) => ({ id: a, name: names.get(a) ?? '' })),
      stock: FLAVOURS.map((f) => ({ flavour: f, units: atEvent[f], cartons: Math.floor(atEvent[f] / UNITS_PER_CARTON), movedUnits: moved[f], soldUnits: sold[f] })),
      totals: { stockUnits: sumOf(atEvent), soldUnits: sumOf(sold), movedUnits: sumOf(moved) },
      warehouseAvailableCartons: available ? Object.fromEntries(FLAVOURS.map((f) => [f, Math.max(0, Math.floor(available[f] / UNITS_PER_CARTON))])) : null,
      sales,
      movements: moves
        .filter((m) => !own || m.kind !== 'event_sale' || m.byId === own)
        .map((m) => ({ id: m.id, flavour: m.flavour, units: m.units, kind: m.kind, createdAt: m.createdAt, byName: m.byName })),
      ...(spend ? { expenses: spend, expensesCents: spend.reduce((s, x) => s + x.netCents, 0) } : {}),
      canEdit: edit,
    };
  }

  private async assertAgents(ids: string[]) {
    if (!ids.length) return;
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(inArray(users.id, ids), eq(roles.baseRole, 'agent')));
    if (rows.length !== new Set(ids).size) throw new BadRequestException({ message: 'Choose agents from the list', fields: { agentIds: 'Choose agents from the list' } });
  }

  async create(auth: AuthContext, input: EventInput) {
    if (input.endsOn < input.startsOn) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { endsOn: 'The end date is before the start date' } });
    const agentIds = [...new Set(input.agentIds)];
    await this.assertAgents(agentIds);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(events).values({ name: input.name, startsOn: input.startsOn, endsOn: input.endsOn, place: input.place, kind: input.kind, agentIds, createdById: auth.user.id }).returning();
      await this.audit.log(auth, { category: 'events', action: 'event_created', recordType: 'event', recordId: row.id, recordLabel: row.name, meta: { startsOn: row.startsOn, endsOn: row.endsOn, place: row.place, kind: row.kind, agentIds } }, tx);
      await this.notify.toUsers(agentIds, { type: 'event', title: `You are invited to ${row.name}`, body: `${row.startsOn} – ${row.endsOn}, ${row.place}`, link: `/events/${row.id}` }, tx);
      return { id: row.id };
    });
  }

  private units(cartons: CartonsByFlavour): ByFlavour {
    return Object.fromEntries(FLAVOURS.map((f) => [f, Math.max(0, Math.floor(cartons[f] ?? 0)) * UNITS_PER_CARTON])) as ByFlavour;
  }

  /** Move cartons to the event or back to the warehouse: two ledger rows per flavour. */
  async moveStock(auth: AuthContext, id: string, direction: 'to_event' | 'back', cartons: CartonsByFlavour) {
    const units = this.units(cartons);
    if (sumOf(units) === 0) throw new BadRequestException({ message: 'Enter the cartons to move', fields: { cartons: 'Enter the cartons to move' } });
    return this.db.transaction(async (tx) => {
      const e = await this.load(auth, id, tx, true);
      const from = direction === 'to_event' ? await this.stock.available(tx) : await this.stock.inStock(tx, id);
      const fields: Record<string, string> = {};
      for (const f of FLAVOURS) {
        if (units[f] > from[f]) fields[`cartons.${f}`] = `Only ${Math.max(0, Math.floor(from[f] / UNITS_PER_CARTON))} cartons ${direction === 'to_event' ? 'available' : 'at the event'}`;
      }
      if (Object.keys(fields).length) throw new BadRequestException({ message: direction === 'to_event' ? 'Not enough stock at the warehouse' : 'Not that much stock at the event', fields });
      const kind = direction === 'to_event' ? 'event_out' : 'event_in';
      const sign = direction === 'to_event' ? 1 : -1;
      for (const f of FLAVOURS) {
        if (!units[f]) continue;
        await this.stock.move(tx, { flavour: f, units: -sign * units[f], kind, reason: direction, eventId: null, byId: auth.user.id });
        await this.stock.move(tx, { flavour: f, units: sign * units[f], kind, reason: direction, eventId: id, byId: auth.user.id });
      }
      const moved = Object.fromEntries(FLAVOURS.filter((f) => units[f]).map((f) => [f, units[f] / UNITS_PER_CARTON]));
      await this.audit.log(auth, { category: 'stock', action: direction === 'to_event' ? 'stock_to_event' : 'stock_back_from_event', recordType: 'event', recordId: id, recordLabel: e.name, meta: { cartons: moved } }, tx);
      return { ok: true, cartons: sumOf(units) / UNITS_PER_CARTON };
    });
  }

  /** Cartons sold at the event by an invited agent (FR-EVT-3). */
  async recordSale(auth: AuthContext, id: string, agentId: string, cartons: CartonsByFlavour) {
    const units = this.units(cartons);
    if (sumOf(units) === 0) throw new BadRequestException({ message: 'Enter the cartons sold', fields: { cartons: 'Enter the cartons sold' } });
    return this.db.transaction(async (tx) => {
      const e = await this.load(auth, id, tx, true);
      if (!e.agentIds.includes(agentId)) throw new BadRequestException({ message: 'Choose an agent invited to this event', fields: { agentId: 'Choose an agent invited to this event' } });
      const atEvent = await this.stock.inStock(tx, id);
      const fields: Record<string, string> = {};
      for (const f of FLAVOURS) if (units[f] > atEvent[f]) fields[`cartons.${f}`] = `Only ${Math.floor(atEvent[f] / UNITS_PER_CARTON)} cartons at the event`;
      if (Object.keys(fields).length) throw new BadRequestException({ message: 'Not that much stock at the event', fields });
      for (const f of FLAVOURS) {
        if (units[f]) await this.stock.move(tx, { flavour: f, units: -units[f], kind: 'event_sale', reason: 'event_sale', eventId: id, byId: agentId });
      }
      const [agent] = await tx.select({ name: users.name }).from(users).where(eq(users.id, agentId));
      const sold = Object.fromEntries(FLAVOURS.filter((f) => units[f]).map((f) => [f, units[f] / UNITS_PER_CARTON]));
      await this.audit.log(auth, { category: 'events', action: 'event_sale_recorded', recordType: 'event', recordId: id, recordLabel: e.name, meta: { agentId, agentName: agent?.name, cartons: sold } }, tx);
      // A13: agents sell at events with the normal commission, payable straight away (no customer payment to wait for).
      const rules = await this.settings.rules(tx);
      const total = sumOf(units);
      const amountCents = total * rules.commissionPerUnitCents;
      const [entry] = await tx
        .insert(commissionEntries)
        .values({ agentId, eventId: id, orderId: null, units: total, amountCents, status: 'ready', readyAt: new Date() })
        .returning({ id: commissionEntries.id });
      await this.audit.log(
        auth,
        {
          category: 'commission',
          action: 'event_commission_ready',
          recordType: 'user',
          recordId: agentId,
          recordLabel: agent?.name,
          money: true,
          changes: { amountCents: { from: null, to: amountCents } },
          meta: { entryId: entry.id, eventId: id, eventName: e.name, units: total, perUnitCents: rules.commissionPerUnitCents },
        },
        tx,
      );
      return { ok: true, cartons: total / UNITS_PER_CARTON, commissionCents: amountCents };
    });
  }
}

