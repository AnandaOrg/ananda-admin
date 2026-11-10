import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { FLAVOURS, UNITS_PER_CARTON, calculateOrder, type CartonsByFlavour } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { approvalRequests, customers, orderLines, orders, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { NotifyService } from '../core/notify.service';
import { MailService } from '../core/mail.service';
import { SettingsService } from '../core/settings.service';
import { StockService } from '../core/stock.service';
import { OrdersService } from '../orders/orders.service';
import { CustomersService } from '../customers/customers.service';
import type { AuthContext } from '../common/context';

type Req = typeof approvalRequests.$inferSelect;

/** "Needs your OK": new customers, special prices and corrections (PRD §6.3). */
@Injectable()
export class ApprovalsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly orders: OrdersService,
    private readonly customers: CustomersService,
  ) {}

  async pending() {
    const rows = await this.db
      .select({ r: approvalRequests, agentName: users.name, customerName: customers.companyName, orderNumber: orders.number, orderTotalCents: orders.totalCents, orderCartons: orders.totalCartons })
      .from(approvalRequests)
      .innerJoin(users, eq(users.id, approvalRequests.requestedById))
      .leftJoin(customers, eq(customers.id, approvalRequests.customerId))
      .leftJoin(orders, eq(orders.id, approvalRequests.orderId))
      .where(eq(approvalRequests.status, 'pending'))
      .orderBy(desc(approvalRequests.createdAt));
    return rows.map(({ r, ...x }) => ({ id: r.id, type: r.type, createdAt: r.createdAt, reason: r.reason, payload: r.payload, customerId: r.customerId, orderId: r.orderId, ...x }));
  }

  /** The agent's own requests with decision and decline reason (FR-AGT-5). */
  async mine(auth: AuthContext) {
    const rows = await this.db
      .select({ r: approvalRequests, customerName: customers.companyName, orderNumber: orders.number })
      .from(approvalRequests)
      .leftJoin(customers, eq(customers.id, approvalRequests.customerId))
      .leftJoin(orders, eq(orders.id, approvalRequests.orderId))
      .where(eq(approvalRequests.requestedById, auth.user.id))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(100);
    return rows.map(({ r, ...x }) => ({ ...r, ...x }));
  }

  private async get(id: string) {
    const [r] = await this.db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    if (!r) throw new NotFoundException({ message: 'Request not found' });
    return r;
  }

  /** The facts needed to decide, and the consequence in one line (FR-HOME-4). */
  async review(id: string) {
    const r = await this.get(id);
    const [agent] = await this.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, r.requestedById));
    const base = { id: r.id, type: r.type, status: r.status, reason: r.reason, createdAt: r.createdAt, agent, declineReason: r.declineReason };
    if (r.type === 'new_customer') {
      const [c] = await this.db.select().from(customers).where(eq(customers.id, r.customerId!));
      const duplicates = await this.customers.duplicates(c.vatNumber, c.companyName, c.id);
      return { ...base, customer: c, duplicates };
    }
    const [order] = await this.db.select().from(orders).where(eq(orders.id, r.orderId!));
    const lines = await this.db.select().from(orderLines).where(eq(orderLines.orderId, order.id));
    const [customer] = order.customerId ? await this.db.select({ id: customers.id, companyName: customers.companyName }).from(customers).where(eq(customers.id, order.customerId)) : [null];
    if (r.type === 'special_price') {
      const p = r.payload as { unitPriceCents: number; tierUnitPriceCents: number; units: number };
      const before = calculateOrder(Object.fromEntries(lines.map((l) => [l.flavour, l.cartons])));
      const after = calculateOrder(Object.fromEntries(lines.map((l) => [l.flavour, l.cartons])), p.unitPriceCents);
      return {
        ...base,
        order: { id: order.id, number: order.number, totalCartons: order.totalCartons, totalUnits: order.totalUnits },
        customer,
        price: { fromCents: p.tierUnitPriceCents, toCents: p.unitPriceCents },
        totals: { fromCents: before.totalCents, toCents: after.totalCents },
        commission: { fromCents: before.commissionCents, toCents: after.commissionCents },
      };
    }
    const p = r.payload as { from: CartonsByFlavour; to: CartonsByFlavour };
    const after = calculateOrder(p.to, order.specialUnitPriceCents);
    const rules = await this.settings.rules();
    const perFlavour = FLAVOURS.filter((f) => (p.from[f] ?? 0) > 0 || (p.to[f] ?? 0) > 0).map((f) => ({ flavour: f, from: p.from[f] ?? 0, to: p.to[f] ?? 0 }));
    const releasedUnits = perFlavour.reduce((s, x) => s + Math.max(0, x.from - x.to) * UNITS_PER_CARTON, 0);
    return {
      ...base,
      order: { id: order.id, number: order.number, status: order.status, paidCents: order.paidCents },
      customer,
      perFlavour,
      cartons: { from: order.totalCartons, to: after.totalCartons, minimum: rules.minOrderCartons },
      totals: { fromCents: order.totalCents, toCents: after.totalCents },
      commission: { fromCents: order.commissionCents, toCents: after.commissionCents },
      stockReleasedUnits: releasedUnits,
    };
  }

  async approve(auth: AuthContext, id: string) {
    const r = await this.get(id);
    if (r.status !== 'pending') throw new ConflictException({ message: 'This request was already decided' });
    let corrected: Awaited<ReturnType<OrdersService['applyCorrection']>> | null = null;
    let label = '';
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).for('update');
      if (locked.status !== 'pending') throw new ConflictException({ message: 'This request was already decided' });
      if (r.type === 'new_customer') {
        const [c] = await tx.select().from(customers).where(eq(customers.id, r.customerId!));
        await tx.update(customers).set({ status: 'active', approvedAt: new Date(), approvedById: auth.user.id }).where(eq(customers.id, c.id));
        label = c.companyName;
        await this.audit.log(auth, { category: 'customers', action: 'customer_approved', recordType: 'customer', recordId: c.id, recordLabel: c.companyName }, tx);
      } else if (r.type === 'special_price') {
        const p = r.payload as { unitPriceCents: number; tierUnitPriceCents: number };
        const order = await this.orders.applySpecialPrice(tx, r.orderId!, p.unitPriceCents);
        label = order.number;
        await this.audit.log(auth, { category: 'orders', action: 'special_price_approved', recordType: 'order', recordId: order.id, recordLabel: order.number, money: true, changes: { unitPriceCents: { from: p.tierUnitPriceCents, to: p.unitPriceCents } } }, tx);
      } else {
        const p = r.payload as { to: CartonsByFlavour };
        corrected = await this.orders.applyCorrection(tx, auth, r.orderId!, p.to);
        label = corrected.order.number;
      }
      await tx.update(approvalRequests).set({ status: 'approved', decidedById: auth.user.id, decidedAt: new Date() }).where(eq(approvalRequests.id, id));
      await this.notify.toUsers([r.requestedById], { type: 'approved', title: `Approved: ${label}`, body: approvedLine(r), link: r.orderId ? `/sales/${r.orderId}` : `/customers/${r.customerId}` }, tx);
    });
    if (corrected) {
      const c = corrected as Awaited<ReturnType<OrdersService['applyCorrection']>>;
      await this.orders.sendCorrectedProforma(c.order, c.data, c.number);
    }
    await this.mailAgent(r, `Approved: ${label}`, approvedLine(r));
    return { ok: true };
  }

  async decline(auth: AuthContext, id: string, reason: string, message?: string) {
    const r = await this.get(id);
    if (r.status !== 'pending') throw new ConflictException({ message: 'This request was already decided' });
    let label = '';
    await this.db.transaction(async (tx) => {
      await tx.update(approvalRequests).set({ status: 'declined', decidedById: auth.user.id, decidedAt: new Date(), declineReason: reason, declineMessage: message }).where(eq(approvalRequests.id, id));
      if (r.type === 'new_customer') {
        const [c] = await tx.select().from(customers).where(eq(customers.id, r.customerId!));
        label = c.companyName;
        // Declined requests return to the agent with the reason (§6.5).
        await tx.update(customers).set({ status: 'declined' }).where(eq(customers.id, c.id));
        await this.audit.log(auth, { category: 'customers', action: 'customer_declined', recordType: 'customer', recordId: c.id, recordLabel: c.companyName, meta: { reason, message } }, tx);
      } else {
        const [o] = await tx.select().from(orders).where(eq(orders.id, r.orderId!));
        label = o.number;
        await this.audit.log(auth, { category: 'orders', action: `${r.type}_declined`, recordType: 'order', recordId: o.id, recordLabel: o.number, meta: { reason, message } }, tx);
      }
      await this.notify.toUsers([r.requestedById], { type: 'declined', title: `Declined: ${label}`, body: [reason, message].filter(Boolean).join(' · '), link: r.orderId ? `/sales/${r.orderId}` : `/customers/${r.customerId}` }, tx);
    });
    await this.mailAgent(r, `Declined: ${label}`, [`Reason: ${reason}`, message].filter(Boolean).join('\n\n'));
    return { ok: true };
  }

  async countPending() {
    const rows = await this.db.select({ id: approvalRequests.id }).from(approvalRequests).where(inArray(approvalRequests.status, ['pending']));
    return rows.length;
  }

  private async mailAgent(r: Req, subject: string, body: string) {
    const [u] = await this.db.select({ email: users.email }).from(users).where(and(eq(users.id, r.requestedById)));
    if (u) await this.mail.send({ kind: 'approval_decision', to: [u.email], subject, body, recordType: 'approval', recordId: r.id });
  }
}

function approvedLine(r: Req) {
  switch (r.type) {
    case 'new_customer':
      return 'You can start a sale.';
    case 'special_price':
      return 'The proforma will use the approved price.';
    default:
      return 'The customer received the corrected proforma.';
  }
}
