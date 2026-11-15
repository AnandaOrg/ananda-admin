import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { FLAVOURS, PRICE_TIERS, UNITS_PER_CARTON, addMonths, calculateOrder, isoDate, tierFor, type CartonsByFlavour, type Flavour } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { approvalRequests, customers, orderLines, orders, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { NotifyService } from '../core/notify.service';
import { MailService } from '../core/mail.service';
import { SettingsService } from '../core/settings.service';
import { StockService } from '../core/stock.service';
import { OrdersService } from '../orders/orders.service';
import { CustomersService, vatRegime } from '../customers/customers.service';
import type { AuthContext } from '../common/context';

type Req = typeof approvalRequests.$inferSelect;

/** How long an Admin can take a decision back from Overview (the row shows Undo meanwhile). */
export const UNDO_MINUTES = 30;

/** Reasons offered when declining, per kind of request; stored as the key, sent to the broker in words. */
export const DECLINE_REASONS: Record<Req['type'], Record<string, string>> = {
  new_customer: { already_customer: 'Already a customer', wrong_details: 'VAT or details wrong', not_a_fit: 'Not a fit for ANANDA' },
  special_price: { discount_too_big: 'Discount too big', smaller_discount: 'Offer a smaller discount', not_for_customer: 'Not for this customer' },
  correction: { stock_picked: 'Stock already picked', customer_confirm: 'Customer must confirm first', wrong_quantities: 'Wrong quantities' },
};

const reasonText = (type: Req['type'], key: string) => DECLINE_REASONS[type]?.[key] ?? key;

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

  private listQuery() {
    return this.db
      .select({
        r: approvalRequests,
        brokerName: users.name,
        customerName: customers.companyName,
        customerVatValid: customers.vatValid,
        customerVatNumber: customers.vatNumber,
        orderNumber: orders.number,
        orderTotalCents: orders.totalCents,
        orderCartons: orders.totalCartons,
        orderUnits: orders.totalUnits,
      })
      .from(approvalRequests)
      .innerJoin(users, eq(users.id, approvalRequests.requestedById))
      .leftJoin(customers, eq(customers.id, approvalRequests.customerId))
      .leftJoin(orders, eq(orders.id, approvalRequests.orderId));
  }

  private shape(rows: Awaited<ReturnType<ApprovalsService['listQuery']>>) {
    return rows.map(({ r, ...x }) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      reason: r.reason,
      payload: r.payload,
      customerId: r.customerId,
      orderId: r.orderId,
      ...x,
      summary: summaryOf(r, x),
    }));
  }

  async pending() {
    return this.shape(await this.listQuery().where(eq(approvalRequests.status, 'pending')).orderBy(desc(approvalRequests.createdAt)));
  }

  /** Decided in the last few minutes, so Overview can show Approved/Declined with Undo. */
  async recentlyDecided() {
    const since = new Date(Date.now() - UNDO_MINUTES * 60_000);
    return this.shape(await this.listQuery().where(and(inArray(approvalRequests.status, ['approved', 'declined']), gte(approvalRequests.decidedAt, since))).orderBy(desc(approvalRequests.decidedAt)));
  }

  /** The broker's own requests with decision and decline reason (FR-AGT-5). */
  async mine(auth: AuthContext) {
    const rows = await this.db
      .select({ r: approvalRequests, customerName: customers.companyName, orderNumber: orders.number })
      .from(approvalRequests)
      .leftJoin(customers, eq(customers.id, approvalRequests.customerId))
      .leftJoin(orders, eq(orders.id, approvalRequests.orderId))
      .where(eq(approvalRequests.requestedById, auth.user.id))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(100);
    return rows.map(({ r, ...x }) => ({ ...r, ...x, declineReasonText: r.declineReason ? reasonText(r.type, r.declineReason) : null }));
  }

  private async get(id: string) {
    const [r] = await this.db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    if (!r) throw new NotFoundException({ message: 'Request not found' });
    return r;
  }

  /** The facts needed to decide, and the consequence in one line (FR-HOME-4). */
  async review(id: string) {
    const r = await this.get(id);
    const [broker] = await this.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, r.requestedById));
    const rules = await this.settings.rules();
    const base = {
      id: r.id,
      type: r.type,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      broker,
      declineReason: r.declineReason,
      declineReasons: Object.keys(DECLINE_REASONS[r.type]),
      canUndo: r.status !== 'pending' && !!r.decidedAt && Date.now() - r.decidedAt.getTime() < UNDO_MINUTES * 60_000,
      ownershipMonths: rules.ownership.months,
    };
    if (r.type === 'new_customer') {
      const [c] = await this.db.select().from(customers).where(eq(customers.id, r.customerId!));
      const duplicates = await this.customers.duplicates(c.vatNumber, c.companyName, c.id);
      return { ...base, customer: c, duplicates, vatRegime: vatRegime(c.country, c.vatValid) };
    }
    const [order] = await this.db.select().from(orders).where(eq(orders.id, r.orderId!));
    const lines = await this.db.select().from(orderLines).where(eq(orderLines.orderId, order.id));
    const [customer] = order.customerId ? await this.db.select({ id: customers.id, companyName: customers.companyName }).from(customers).where(eq(customers.id, order.customerId)) : [null];
    const orderInfo = { id: order.id, number: order.number, status: order.status, totalCartons: order.totalCartons, totalUnits: order.totalUnits, paidCents: order.paidCents };
    if (r.type === 'special_price') {
      const p = r.payload as { unitPriceCents: number; tierUnitPriceCents: number; units: number };
      const cartons = Object.fromEntries(lines.map((l) => [l.flavour, l.cartons])) as CartonsByFlavour;
      const before = calculateOrder(cartons);
      const after = calculateOrder(cartons, p.unitPriceCents);
      const tier = tierFor(before.totalCartons) ?? PRICE_TIERS[0];
      // The tier whose list price is the price asked for, if any ("That price is normally for 417–833 cartons").
      const normally = PRICE_TIERS.find((t) => t.unitPriceCents === p.unitPriceCents) ?? PRICE_TIERS.find((t) => t.unitPriceCents <= p.unitPriceCents) ?? null;
      const units = before.totalUnits;
      const perUnitDiscount = Math.max(0, tier.unitPriceCents - p.unitPriceCents);
      const discountCents = perUnitDiscount * units;
      const commissionCut = before.commissionCents - after.commissionCents;
      // Landed cost a unit, weighted by the flavours on the order (one definition: StockService).
      const cost = await this.stock.avgLandedCost();
      const landedCents = units ? lines.reduce((s, l) => s + Number(cost[l.flavour as Flavour] ?? 0) * l.units, 0) / units : 0;
      const commissionPerUnitAfter = units ? after.commissionCents / units : 0;
      return {
        ...base,
        order: orderInfo,
        customer,
        tier: { minCartons: tier.minCartons, maxCartons: tier.maxCartons, unitPriceCents: tier.unitPriceCents },
        asked: { unitPriceCents: p.unitPriceCents, normally: normally && normally.unitPriceCents === p.unitPriceCents ? { minCartons: normally.minCartons, maxCartons: normally.maxCartons } : null },
        discount: { perUnitCents: perUnitDiscount, units, totalCents: discountCents },
        commission: { perUnitFromCents: units ? before.commissionCents / units : 0, perUnitToCents: commissionPerUnitAfter, fromCents: before.commissionCents, toCents: after.commissionCents },
        paidByAnandaCents: Math.max(0, discountCents - commissionCut),
        landedUnitCents: landedCents,
        marginUnitCents: p.unitPriceCents - landedCents - commissionPerUnitAfter,
        totals: { fromCents: before.totalCents, toCents: after.totalCents },
      };
    }
    const p = r.payload as { from: CartonsByFlavour; to: CartonsByFlavour };
    const after = calculateOrder(p.to, order.specialUnitPriceCents);
    const perFlavour = FLAVOURS.filter((f) => (p.from[f] ?? 0) > 0 || (p.to[f] ?? 0) > 0).map((f) => ({ flavour: f, from: p.from[f] ?? 0, to: p.to[f] ?? 0 }));
    const fromCartons = perFlavour.reduce((s, x) => s + x.from, 0);
    const delta = perFlavour.reduce((s, x) => s + (x.from - x.to) * UNITS_PER_CARTON, 0);
    return {
      ...base,
      order: orderInfo,
      customer,
      perFlavour,
      cartons: { from: fromCartons, to: after.totalCartons, minimum: rules.minOrderCartons, tierChanges: (tierFor(fromCartons)?.unitPriceCents ?? 0) !== (tierFor(after.totalCartons)?.unitPriceCents ?? 0) },
      totals: { fromCents: order.totalCents, toCents: after.totalCents },
      commission: { fromCents: order.commissionCents, toCents: after.commissionCents },
      stockReleasedUnits: Math.max(0, delta),
      stockNeededUnits: Math.max(0, -delta),
    };
  }

  /** 409 that says who decided and how, so the page can say "Oren already approved this". */
  private async alreadyDecided(id: string) {
    const [x] = await this.db.select({ status: approvalRequests.status, by: users.name }).from(approvalRequests).leftJoin(users, eq(users.id, approvalRequests.decidedById)).where(eq(approvalRequests.id, id));
    return new ConflictException({ message: 'This request was already decided', code: 'conflict', by: x?.by?.split(' ')[0] ?? null, outcome: x?.status ?? null });
  }

  async approve(auth: AuthContext, id: string) {
    const r = await this.get(id);
    if (r.status !== 'pending') throw await this.alreadyDecided(r.id);
    let corrected: Awaited<ReturnType<OrdersService['applyCorrection']>> | null = null;
    let label = '';
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).for('update');
      if (locked.status !== 'pending') throw await this.alreadyDecided(r.id);
      if (r.type === 'new_customer') {
        const [c] = await tx.select().from(customers).where(eq(customers.id, r.customerId!));
        const rules = await this.settings.rules(tx);
        // The broker keeps the customer for N months from approval, then from each order.
        const ownedUntil = c.ownedUntil ?? (c.brokerId ? isoDate(addMonths(new Date(), rules.ownership.months)) : null);
        await tx.update(customers).set({ status: 'active', approvedAt: new Date(), approvedById: auth.user.id, ownedUntil }).where(eq(customers.id, c.id));
        label = c.companyName;
        await this.audit.log(auth, { category: 'customers', action: 'customer_approved', recordType: 'customer', recordId: c.id, recordLabel: c.companyName, changes: { status: { from: c.status, to: 'active' } } }, tx);
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
    await this.mailBroker(r, `Approved: ${label}`, approvedLine(r));
    return { ok: true, label };
  }

  async decline(auth: AuthContext, id: string, reason: string, message?: string) {
    const r = await this.get(id);
    if (r.status !== 'pending') throw await this.alreadyDecided(r.id);
    let label = '';
    const why = reasonText(r.type, reason);
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).for('update');
      if (locked.status !== 'pending') throw await this.alreadyDecided(r.id);
      await tx.update(approvalRequests).set({ status: 'declined', decidedById: auth.user.id, decidedAt: new Date(), declineReason: reason, declineMessage: message }).where(eq(approvalRequests.id, id));
      if (r.type === 'new_customer') {
        const [c] = await tx.select().from(customers).where(eq(customers.id, r.customerId!));
        label = c.companyName;
        // Declined requests return to the broker with the reason (§6.5).
        await tx.update(customers).set({ status: 'declined' }).where(eq(customers.id, c.id));
        await this.audit.log(auth, { category: 'customers', action: 'customer_declined', recordType: 'customer', recordId: c.id, recordLabel: c.companyName, meta: { reason, message } }, tx);
      } else {
        const [o] = await tx.select().from(orders).where(eq(orders.id, r.orderId!));
        label = o.number;
        await this.audit.log(auth, { category: 'orders', action: `${r.type}_declined`, recordType: 'order', recordId: o.id, recordLabel: o.number, meta: { reason, message } }, tx);
      }
      await this.notify.toUsers([r.requestedById], { type: 'declined', title: `Declined: ${label}`, body: [why, message].filter(Boolean).join(' · '), link: r.orderId ? `/sales/${r.orderId}` : `/customers/${r.customerId}` }, tx);
    });
    await this.mailBroker(r, `Declined: ${label}`, [`Reason: ${why}`, message].filter(Boolean).join('\n\n'));
    return { ok: true, label };
  }

  /**
   * Takes a decision back within UNDO_MINUTES while nothing has happened since: the request waits
   * again and the broker is told. An approved correction is reversed with another corrected proforma.
   */
  async undo(auth: AuthContext, id: string) {
    const r = await this.get(id);
    if (r.status === 'pending') throw new ConflictException({ message: 'This request is waiting again already' });
    if (r.status !== 'approved' && r.status !== 'declined') throw new ConflictException({ message: 'This request can no longer be undone' });
    if (!r.decidedAt || Date.now() - r.decidedAt.getTime() > UNDO_MINUTES * 60_000) throw new ConflictException({ message: `Decisions can be undone for ${UNDO_MINUTES} minutes. Ask the broker to send it again.` });
    let reversed: Awaited<ReturnType<OrdersService['applyCorrection']>> | null = null;
    let label = '';
    await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).for('update');
      if (locked.status !== r.status) throw new ConflictException({ message: 'This request changed meanwhile. Reload and try again.' });
      if (r.type === 'new_customer') {
        const [c] = await tx.select().from(customers).where(eq(customers.id, r.customerId!)).for('update');
        label = c.companyName;
        if (r.status === 'approved') {
          const [sold] = await tx.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.customerId, c.id), ne(orders.status, 'draft')));
          if (sold.n > 0) throw new ConflictException({ message: `A payment request already went to ${c.companyName}, so the approval stays.` });
        }
        await tx.update(customers).set({ status: 'needs_approval', approvedAt: null, approvedById: null }).where(eq(customers.id, c.id));
        await this.audit.log(auth, { category: 'customers', action: r.status === 'approved' ? 'customer_approval_undone' : 'customer_decline_undone', recordType: 'customer', recordId: c.id, recordLabel: c.companyName, changes: { status: { from: c.status, to: 'needs_approval' } } }, tx);
      } else {
        const [o] = await tx.select().from(orders).where(eq(orders.id, r.orderId!)).for('update');
        label = o.number;
        if (r.status === 'approved' && r.type === 'special_price') {
          if (o.status !== 'draft') throw new ConflictException({ message: `${o.number}'s payment request already went out with this price, so the approval stays.` });
          const p = r.payload as { unitPriceCents: number; tierUnitPriceCents: number };
          // Back to the list price: with the price equal to the tier, totals and commission are the list ones.
          await this.orders.applySpecialPrice(tx, o.id, p.tierUnitPriceCents);
          await tx.update(orders).set({ specialUnitPriceCents: null }).where(eq(orders.id, o.id));
          await this.audit.log(auth, { category: 'orders', action: 'special_price_undone', recordType: 'order', recordId: o.id, recordLabel: o.number, money: true, changes: { unitPriceCents: { from: p.unitPriceCents, to: p.tierUnitPriceCents } } }, tx);
        } else if (r.status === 'approved' && r.type === 'correction') {
          const p = r.payload as { from: CartonsByFlavour };
          reversed = await this.orders.applyCorrection(tx, auth, o.id, p.from);
          await this.audit.log(auth, { category: 'orders', action: 'correction_undone', recordType: 'order', recordId: o.id, recordLabel: o.number }, tx);
        } else {
          await this.audit.log(auth, { category: 'orders', action: `${r.type}_decline_undone`, recordType: 'order', recordId: o.id, recordLabel: o.number }, tx);
        }
      }
      await tx.update(approvalRequests).set({ status: 'pending', decidedById: null, decidedAt: null, declineReason: null, declineMessage: null }).where(eq(approvalRequests.id, id));
      await this.notify.toUsers([r.requestedById], { type: 'approval', title: `Waiting again: ${label}`, body: 'The Admin took the decision back. You will hear again soon.', link: r.orderId ? `/sales/${r.orderId}` : `/customers/${r.customerId}` }, tx);
    });
    if (reversed) {
      const c = reversed as Awaited<ReturnType<OrdersService['applyCorrection']>>;
      await this.orders.sendCorrectedProforma(c.order, c.data, c.number);
    }
    return { ok: true, label };
  }

  async countPending() {
    const rows = await this.db.select({ id: approvalRequests.id }).from(approvalRequests).where(inArray(approvalRequests.status, ['pending']));
    return rows.length;
  }

  private async mailBroker(r: Req, subject: string, body: string) {
    const [u] = await this.db.select({ email: users.email }).from(users).where(and(eq(users.id, r.requestedById)));
    if (u) await this.mail.send({ kind: 'approval_decision', to: [u.email], subject, body, recordType: 'approval', recordId: r.id });
  }
}

/** The facts for the row on Overview: VAT state, the price asked, or which flavours change. */
function summaryOf(r: Req, x: { customerVatValid: boolean | null; customerVatNumber: string | null; orderCartons: number | null; orderUnits: number | null }) {
  if (r.type === 'new_customer') return { vat: !x.customerVatNumber ? 'none' : x.customerVatValid === true ? 'valid' : x.customerVatValid === false ? 'invalid' : 'unchecked' };
  if (r.type === 'special_price') {
    const p = r.payload as { unitPriceCents: number; tierUnitPriceCents: number };
    return { unitPriceCents: p.unitPriceCents, tierUnitPriceCents: p.tierUnitPriceCents, cartons: x.orderCartons, units: x.orderUnits };
  }
  const p = r.payload as { from: CartonsByFlavour; to: CartonsByFlavour };
  const fewer = FLAVOURS.filter((f) => (p.to[f] ?? 0) < (p.from[f] ?? 0));
  const more = FLAVOURS.filter((f) => (p.to[f] ?? 0) > (p.from[f] ?? 0));
  return { fewer, more };
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
