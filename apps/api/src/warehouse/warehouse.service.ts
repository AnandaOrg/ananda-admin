import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { FLAVOURS, UNITS_PER_CARTON, type CartonsByFlavour, type Flavour } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { customers, documents, orderLines, orders, stockCounts, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { NotifyService } from '../core/notify.service';
import { StockService } from '../core/stock.service';
import { orderScope } from '../core/scope';
import type { AuthContext } from '../common/context';
import { OrdersService } from '../orders/orders.service';

type UploadedFile = { buffer: Buffer; originalname: string; mimetype: string };

/** One flavour of an order as the warehouse sees it: quantities only, never money. */
export interface ShipLine {
  flavour: Flavour;
  cartons: number;
  units: number;
}

/**
 * The warehouse never receives prices, values, totals or costs (FR-AUTH-3). Every response here
 * is built field by field from quantities, names and addresses; nothing is spread from a row.
 */
export interface ShipCard {
  id: string;
  number: string;
  status: string;
  customerName: string;
  city: string | null;
  address: string;
  contactName: string;
  phone: string;
  sentAt: string | null;
  waitingDays: number;
  redelivery: boolean;
  lines: ShipLine[];
  totalCartons: number;
  totalUnits: number;
}

const DAY = 86_400_000;

function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

@Injectable()
export class WarehouseService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly orders: OrdersService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  /** Orders in the given statuses, with remaining cartons per flavour (cartons − delivered). */
  private async cards(auth: AuthContext, statuses: ('at_warehouse' | 'ready_to_send')[]): Promise<ShipCard[]> {
    const rows = await this.db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        sentAt: orders.sentToWarehouseAt,
        paidAt: orders.paidAt,
        outcome: orders.partDeliveryOutcome,
        customerName: customers.companyName,
        city: customers.city,
        deliveryAddress: customers.deliveryAddress,
        registeredAddress: customers.registeredAddress,
        contactName: customers.contactName,
        phone: customers.phone,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(inArray(orders.status, statuses), orderScope(auth)))
      .orderBy(asc(orders.sentToWarehouseAt), asc(orders.paidAt), asc(orders.number));
    if (!rows.length) return [];
    const lines = await this.db
      .select({ orderId: orderLines.orderId, flavour: orderLines.flavour, cartons: orderLines.cartons, delivered: orderLines.deliveredCartons })
      .from(orderLines)
      .where(inArray(orderLines.orderId, rows.map((r) => r.id)));
    const now = Date.now();
    return rows.map((r) => {
      const own = FLAVOURS.flatMap((f) => {
        const l = lines.find((x) => x.orderId === r.id && x.flavour === f);
        if (!l) return [];
        const cartons = l.cartons - (l.delivered ?? 0);
        return cartons > 0 ? [{ flavour: f, cartons, units: cartons * UNITS_PER_CARTON }] : [];
      });
      const totalCartons = own.reduce((s, l) => s + l.cartons, 0);
      const since = r.sentAt ?? r.paidAt;
      return {
        id: r.id,
        number: r.number,
        status: r.status,
        customerName: r.customerName,
        city: r.city,
        address: r.deliveryAddress ?? r.registeredAddress,
        contactName: r.contactName,
        phone: r.phone,
        sentAt: r.sentAt?.toISOString() ?? null,
        waitingDays: since ? Math.max(0, Math.floor((now - since.getTime()) / DAY)) : 0,
        redelivery: r.outcome === 'redeliver',
        lines: own,
        totalCartons,
        totalUnits: totalCartons * UNITS_PER_CARTON,
      };
    });
  }

  toShip(auth: AuthContext) {
    return this.cards(auth, ['at_warehouse']);
  }

  /** Delivered orders with the date and the signed note (FR-WH-5). */
  async delivered(auth: AuthContext, period?: string) {
    const from = period === 'this_month' ? monthStart() : period === 'last_month' ? new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1) : undefined;
    const to = period === 'last_month' ? monthStart() : undefined;
    const rows = await this.db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        deliveredAt: orders.deliveredAt,
        customerName: customers.companyName,
        city: customers.city,
        cartons: sql<number>`coalesce((select sum(coalesce(${orderLines.deliveredCartons}, 0)) from ${orderLines} where ${orderLines.orderId} = ${orders.id}), 0)::int`,
        noteId: sql<string | null>`(select ${documents.id}::text from ${documents} where ${documents.orderId} = ${orders.id} and ${documents.type} = 'delivery_note' order by ${documents.createdAt} desc limit 1)`,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(
        and(
          inArray(orders.status, ['delivered', 'delivered_part', 'invoiced']),
          sql`${orders.deliveredAt} is not null`,
          from ? gte(orders.deliveredAt, from) : undefined,
          to ? lt(orders.deliveredAt, to) : undefined,
          orderScope(auth),
        ),
      )
      .orderBy(desc(orders.deliveredAt))
      .limit(300);
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      customerName: r.customerName,
      city: r.city,
      deliveredCartons: Number(r.cartons),
      signedNoteId: r.noteId,
    }));
  }

  /** Admin desktop overview (FR-WH-1); the Warehouse role gets the same data without "ready". */
  async overview(auth: AuthContext) {
    const isAdmin = auth.perms.scope === 'all';
    const [toShip, ready, recent, [month], last] = await Promise.all([
      this.toShip(auth),
      isAdmin ? this.cards(auth, ['ready_to_send']) : Promise.resolve([]),
      this.delivered(auth, 'this_month'),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(inArray(orders.status, ['delivered', 'delivered_part', 'invoiced']), gte(orders.deliveredAt, monthStart()), orderScope(auth))),
      this.lastCount(auth),
    ]);
    return {
      tiles: {
        toShipOrders: toShip.length,
        toShipCartons: toShip.reduce((s, o) => s + o.totalCartons, 0),
        readyOrders: ready.length,
        deliveredThisMonth: Number(month.n),
        lastCount: last,
      },
      toShip,
      ready,
      delivered: recent,
    };
  }

  /** When the last count was sent. Admins also see how far off it was; the warehouse never does. */
  async lastCount(auth: AuthContext) {
    const [row] = await this.db
      .select({ id: stockCounts.id, at: stockCounts.createdAt, by: users.name, cartons: stockCounts.cartons, expected: stockCounts.expectedCartons, reconciledAt: stockCounts.reconciledAt })
      .from(stockCounts)
      .leftJoin(users, eq(users.id, stockCounts.countedById))
      .orderBy(desc(stockCounts.createdAt))
      .limit(1);
    if (!row) return null;
    const base = { id: row.id, at: row.at.toISOString(), byName: row.by ?? '' };
    if (auth.perms.scope !== 'all') return base;
    const off = FLAVOURS.reduce((s, f) => s + Math.abs((row.cartons[f] ?? 0) - (row.expected[f] ?? 0)), 0);
    return { ...base, cartonsOff: off, reconciled: !!row.reconciledAt };
  }

  /** Remaining cartons per flavour of an order at the warehouse, or a clear error. */
  private async remaining(auth: AuthContext, id: string) {
    const { order, lines } = await this.orders.load(auth, id);
    if (order.status !== 'at_warehouse') throw new ConflictException({ message: 'This order is not at the warehouse' });
    const out: Partial<Record<Flavour, number>> = {};
    for (const l of lines) out[l.flavour] = l.cartons - (l.deliveredCartons ?? 0);
    return out;
  }

  /** Signed note for a full delivery (FR-WH-3). The order flow lives in OrdersService. */
  async signedNote(auth: AuthContext, id: string, file: UploadedFile | undefined) {
    if (!file) throw new BadRequestException({ message: 'Take a photo of the signed note', fields: { file: 'Take a photo of the signed note' } });
    await this.remaining(auth, id);
    const r = await this.orders.deliver(auth, id, file);
    return { status: r.status, returnedCartons: r.returnedCartons };
  }

  /** Part delivery (FR-WH-4): the warehouse records facts only; an Admin decides the outcome (A6). */
  async partDelivery(auth: AuthContext, id: string, body: { kept: CartonsByFlavour; reason: string; note?: string }, file: UploadedFile | undefined) {
    const sent = await this.remaining(auth, id);
    const fields: Record<string, string> = {};
    let back = 0;
    for (const f of FLAVOURS) {
      const kept = body.kept[f] ?? 0;
      const max = sent[f] ?? 0;
      if (kept > max) fields[`kept.${f}`] = `At most ${max} cartons were sent`;
      back += Math.max(0, max - kept);
    }
    if (Object.keys(fields).length) throw new BadRequestException({ message: 'The customer cannot keep more than was sent', fields });
    if (back === 0) throw new BadRequestException({ message: 'Nothing is coming back. Use Upload signed note for a full delivery.', fields: { kept: 'Lower the cartons the customer kept' } });
    if (!file) throw new BadRequestException({ message: 'Take a photo of the signed note', fields: { file: 'Take a photo of the signed note' } });
    const r = await this.orders.deliver(auth, id, file, { kept: body.kept, reason: body.reason, note: body.note });
    return { status: r.status, returnedCartons: r.returnedCartons };
  }

  /**
   * Blind stock count (FR-WH-6): the warehouse enters full cartons; the expected figures are
   * computed here from the stock ledger and never sent back to the warehouse.
   */
  async sendCount(auth: AuthContext, cartons: CartonsByFlavour) {
    const counted = Object.fromEntries(FLAVOURS.map((f) => [f, cartons[f] ?? 0])) as Record<Flavour, number>;
    const row = await this.db.transaction(async (tx) => {
      const inStock = await this.stock.inStock(tx);
      const expected = Object.fromEntries(FLAVOURS.map((f) => [f, Math.floor(inStock[f] / UNITS_PER_CARTON)])) as Record<Flavour, number>;
      const [count] = await tx.insert(stockCounts).values({ countedById: auth.user.id, cartons: counted, expectedCartons: expected }).returning({ id: stockCounts.id, createdAt: stockCounts.createdAt });
      await this.audit.log(auth, { category: 'stock', action: 'stock_count_sent', recordType: 'stock_count', recordId: count.id, meta: { cartons: counted } }, tx);
      const total = FLAVOURS.reduce((s, f) => s + counted[f], 0);
      await this.notify.toRoles(['system_admin', 'admin'], { type: 'stock_count', title: `Stock count from ${auth.user.name}`, body: `${total} full cartons counted`, link: '/inventory?tab=counts' }, tx);
      return count;
    });
    return { id: row.id, at: row.createdAt.toISOString() };
  }
}
