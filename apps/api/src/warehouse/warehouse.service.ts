import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { FLAVOURS, UNITS_PER_CARTON, type CartonsByFlavour, type Flavour } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { customers, documents, orderLines, orders, stockCounts, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { FilesService } from '../core/files.service';
import { NotifyService } from '../core/notify.service';
import { SettingsService } from '../core/settings.service';
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
  /** Part of it was delivered already; what is left here is the rest. */
  partDelivered: boolean;
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
    private readonly files: FilesService,
    private readonly settings: SettingsService,
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
        partDelivered: lines.some((x) => x.orderId === r.id && (x.delivered ?? 0) > 0),
        lines: own,
        totalCartons,
        totalUnits: totalCartons * UNITS_PER_CARTON,
      };
    });
  }

  toShip(auth: AuthContext) {
    return this.cards(auth, ['at_warehouse']);
  }

  /**
   * Every delivery with its signed note, newest first (FR-WH-5). One row per signed note, so a part
   * delivery and the delivery of the rest are two rows.
   */
  async delivered(auth: AuthContext, period?: string) {
    const from = period === 'this_month' ? monthStart() : period === 'last_month' ? new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1) : undefined;
    const to = period === 'last_month' ? monthStart() : undefined;
    const notes = await this.db
      .select({
        id: documents.id,
        orderId: orders.id,
        number: orders.number,
        status: orders.status,
        at: documents.createdAt,
        data: documents.data,
        mime: documents.mimeType,
        customerName: customers.companyName,
        city: customers.city,
      })
      .from(documents)
      .innerJoin(orders, eq(orders.id, documents.orderId))
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(documents.type, 'delivery_note'), orderScope(auth)))
      .orderBy(asc(documents.createdAt));
    if (!notes.length) return [];
    const ids = [...new Set(notes.map((n) => n.orderId))];
    const sums = await this.db
      .select({ orderId: orderLines.orderId, delivered: sql<number>`coalesce(sum(coalesce(${orderLines.deliveredCartons}, 0)), 0)::int` })
      .from(orderLines)
      .where(inArray(orderLines.orderId, ids))
      .groupBy(orderLines.orderId);
    // A part note records its own cartons; the note that finishes an order covers what is left.
    const counted = new Map<string, number>();
    const rows = notes.map((n) => {
      const d = (n.data ?? {}) as { part?: boolean; cartons?: number; returnedCartons?: number };
      let cartons: number;
      if (typeof d.cartons === 'number') cartons = d.cartons;
      else {
        const total = Number(sums.find((x) => x.orderId === n.orderId)?.delivered ?? 0);
        const before = notes.filter((m) => m.orderId === n.orderId && m.id !== n.id && typeof (m.data as { cartons?: number })?.cartons === 'number').reduce((s, m) => s + Number((m.data as { cartons: number }).cartons), 0);
        cartons = Math.max(0, total - before);
      }
      counted.set(n.orderId, (counted.get(n.orderId) ?? 0) + cartons);
      return {
        id: n.id,
        orderId: n.orderId,
        number: n.number,
        status: n.status,
        deliveredAt: n.at.toISOString(),
        customerName: n.customerName,
        city: n.city,
        deliveredCartons: cartons,
        part: !!d.part || (d.returnedCartons ?? 0) > 0,
        signedNoteId: n.id,
        mimeType: n.mime,
      };
    });
    return rows
      .filter((r) => (!from || new Date(r.deliveredAt) >= from) && (!to || new Date(r.deliveredAt) < to))
      .reverse()
      .slice(0, 300);
  }

  /** Admin desktop overview (FR-WH-1): to ship, every signed note, the last count. */
  async overview(auth: AuthContext) {
    const [toShip, delivered, last, company] = await Promise.all([this.toShip(auth), this.delivered(auth), this.lastCount(auth), this.settings.get('company')]);
    const start = monthStart();
    return {
      site: company.city || null,
      tiles: {
        toShipOrders: toShip.length,
        toShipNumbers: toShip.map((o) => o.number),
        toShipCartons: toShip.reduce((s, o) => s + o.totalCartons, 0),
        deliveredThisMonth: delivered.filter((d) => new Date(d.deliveredAt) >= start).length,
        lastCount: last,
      },
      toShip,
      delivered: delivered.slice(0, 50),
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
    // The total counted is the warehouse's own input, so it may see it; never what was expected.
    const base = { id: row.id, at: row.at.toISOString(), byName: row.by ?? '', cartons: FLAVOURS.reduce((s, f) => s + (row.cartons[f] ?? 0), 0) };
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

  /**
   * Delivered in part (FR-WH-4): the warehouse delivered some cartons now; the rest stays in To ship
   * and goes out later on its own signed note. The order stays at the warehouse until the last carton
   * is delivered (its status changes only in OrdersService.deliver), so nothing moves in stock here.
   */
  async partDelivery(auth: AuthContext, id: string, body: { delivered: CartonsByFlavour }, file: UploadedFile | undefined) {
    const left = await this.remaining(auth, id);
    const fields: Record<string, string> = {};
    let now = 0;
    let rest = 0;
    for (const f of FLAVOURS) {
      const n = Math.floor(body.delivered[f] ?? 0);
      const max = left[f] ?? 0;
      if (n > max) fields[`delivered.${f}`] = `Only ${max} cartons are left to deliver`;
      now += Math.min(n, max);
      rest += Math.max(0, max - n);
    }
    if (Object.keys(fields).length) throw new BadRequestException({ message: 'You cannot deliver more than is left', fields });
    if (now === 0) throw new BadRequestException({ message: 'Enter the cartons you delivered now', fields: { delivered: 'Enter the cartons you delivered now' } });
    if (!file) throw new BadRequestException({ message: 'Take a photo of the signed note', fields: { file: 'Take a photo of the signed note' } });
    // Everything that was left went out: that is a full delivery.
    if (rest === 0) {
      const r = await this.orders.deliver(auth, id, file);
      return { status: r.status, deliveredCartons: now, stayCartons: 0 };
    }
    if (!this.files.isAllowed(file.mimetype)) throw new BadRequestException({ message: 'Upload a photo (JPG, PNG, HEIC) or a PDF', fields: { file: 'Upload a photo (JPG, PNG, HEIC) or a PDF' } });
    const saved = await this.files.save(file);
    return this.db.transaction(async (tx) => {
      const { order, lines } = await this.orders.load(auth, id, tx, true);
      if (order.status !== 'at_warehouse') throw new ConflictException({ message: 'This order is not at the warehouse' });
      const byFlavour: Partial<Record<Flavour, number>> = {};
      let done = 0;
      let stays = 0;
      for (const l of lines) {
        const open = l.cartons - (l.deliveredCartons ?? 0);
        const n = Math.min(open, Math.max(0, Math.floor(body.delivered[l.flavour] ?? 0)));
        stays += open - n;
        if (n <= 0) continue;
        byFlavour[l.flavour] = n;
        done += n;
        await tx.update(orderLines).set({ deliveredCartons: (l.deliveredCartons ?? 0) + n }).where(eq(orderLines.id, l.id));
      }
      if (done === 0 || stays === 0) throw new ConflictException({ message: 'This order changed meanwhile. Open it again.' });
      await tx.insert(documents).values({
        type: 'delivery_note',
        orderId: id,
        customerId: order.customerId,
        filePath: saved.path,
        fileName: saved.name,
        mimeType: saved.mime,
        label: 'Signed delivery note · part',
        data: { part: true, cartons: done, byFlavour, stays },
        createdById: auth.user.id,
      });
      await this.audit.log(auth, { category: 'orders', action: 'part_delivered', recordType: 'order', recordId: id, recordLabel: order.number, meta: { cartons: byFlavour, stays } }, tx);
      const title = `${order.number} part delivered · ${stays} cartons still to ship`;
      await this.notify.toRoles(['system_admin', 'admin'], { type: 'delivered', title, link: `/sales/${id}` }, tx);
      await this.notify.toUsers([order.agentId], { type: 'delivered', title, link: `/sales/${id}` }, tx);
      return { status: order.status, deliveredCartons: done, stayCartons: stays };
    });
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
