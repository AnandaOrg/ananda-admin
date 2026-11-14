import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm';
import {
  FLAVOURS,
  ORDER_PRE_SHIPPING,
  ORDER_UPLOAD_KINDS,
  ORDER_UPLOAD_MAX_BYTES,
  depositOf,
  type OrderUploadKind,
  UNITS_PER_CARTON,
  addDays,
  addMonths,
  calculateOrder,
  isoDate,
  tierFor,
  type CartonsByFlavour,
  type Flavour,
  type OrderStatus,
} from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import {
  approvalRequests,
  auditLog,
  commissionEntries,
  customers,
  documents,
  orderLines,
  orders,
  payments,
  purchaseLines,
  purchases,
  users,
} from '../db/schema';
import { AuditService, diff } from '../core/audit.service';
import { NumberingService } from '../core/numbering.service';
import { SettingsService } from '../core/settings.service';
import { StockService } from '../core/stock.service';
import { MailService } from '../core/mail.service';
import { NotifyService } from '../core/notify.service';
import { FilesService } from '../core/files.service';
import { outstandingSql } from '../core/figures.service';
import { orderScope } from '../core/scope';
import { can, type AuthContext } from '../common/context';
import { DocumentsService } from '../documents/documents.service';
import { CustomersService } from '../customers/customers.service';

type OrderRow = typeof orders.$inferSelect;
type LineRow = typeof orderLines.$inferSelect;

export interface OrderListQuery {
  filter?: string;
  q?: string;
  agentId?: string;
  from?: string;
  to?: string;
  flavour?: string;
}

const NEEDS_ACTION: OrderStatus[] = ['payment_to_confirm', 'waiting_for_stock', 'ready_to_send', 'delivered', 'delivered_part'];
const CLOSED: OrderStatus[] = ['invoiced', 'cancelled'];

function cartonsOf(lines: Pick<LineRow, 'flavour' | 'cartons'>[]): CartonsByFlavour {
  return Object.fromEntries(lines.map((l) => [l.flavour, l.cartons]));
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly stock: StockService,
    private readonly mail: MailService,
    private readonly notify: NotifyService,
    private readonly files: FilesService,
    private readonly docs: DocumentsService,
    private readonly customersVat: CustomersService,
  ) {}

  // ---------- Reading ----------

  private filterCond(filter: string | undefined): SQL | undefined {
    const today = isoDate();
    switch (filter) {
      case 'needs_action':
        return inArray(orders.status, NEEDS_ACTION);
      case 'late':
        return and(lt(orders.paymentDueOn, today), sql`${outstandingSql} > 0`, sql`${orders.status} not in ('draft','cancelled')`);
      case 'drafts':
        return eq(orders.status, 'draft');
      case 'closed':
        return inArray(orders.status, CLOSED);
      default:
        return undefined;
    }
  }

  async list(auth: AuthContext, q: OrderListQuery) {
    const base: SQL[] = [];
    const scope = orderScope(auth);
    if (scope) base.push(scope);
    if (q.agentId) base.push(eq(orders.agentId, q.agentId));
    if (q.from) base.push(gte(orders.createdAt, new Date(q.from)));
    if (q.to) base.push(lt(orders.createdAt, addDays(new Date(q.to), 1)));
    if (q.flavour && (FLAVOURS as readonly string[]).includes(q.flavour)) {
      base.push(sql`exists (select 1 from ${orderLines} where ${orderLines.orderId} = ${orders.id} and ${orderLines.flavour} = ${q.flavour})`);
    }
    if (q.q) {
      const like = `%${q.q.trim()}%`;
      base.push(or(ilike(orders.number, like), ilike(customers.companyName, like))!);
    }
    const rows = await this.db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        createdAt: orders.createdAt,
        totalCents: orders.totalCents,
        netCents: orders.netCents,
        paidCents: orders.paidCents,
        totalCartons: orders.totalCartons,
        totalUnits: orders.totalUnits,
        paymentDueOn: orders.paymentDueOn,
        outstandingCents: outstandingSql,
        customerId: customers.id,
        customerName: customers.companyName,
        city: customers.city,
        agentId: users.id,
        agentName: users.name,
        // House sale: the order is held by someone who is not an agent (house customer, no commission).
        houseSale: sql<boolean>`coalesce((select base_role from roles where roles.id = ${users.roleId}) <> 'agent', true)`,
        paymentTerms: orders.paymentTerms,
        pendingCorrection: sql<boolean>`exists (select 1 from ${approvalRequests} where ${approvalRequests.orderId} = ${orders.id} and ${approvalRequests.status} = 'pending')`,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.agentId))
      .where(and(...base, this.filterCond(q.filter)))
      .orderBy(desc(orders.createdAt))
      .limit(500);

    const counts = await this.db
      .select({
        all: sql<number>`count(*)::int`,
        needs_action: sql<number>`count(*) filter (where ${inArray(orders.status, NEEDS_ACTION)})::int`,
        late: sql<number>`count(*) filter (where ${this.filterCond('late')})::int`,
        drafts: sql<number>`count(*) filter (where ${orders.status} = 'draft')::int`,
        closed: sql<number>`count(*) filter (where ${inArray(orders.status, CLOSED)})::int`,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(...base));
    const today = isoDate();
    return {
      items: rows.map((r) => ({ ...r, outstandingCents: Number(r.outstandingCents), daysLate: lateDays(r.paymentDueOn, Number(r.outstandingCents), r.status, today) })),
      counts: counts[0],
    };
  }

  /** Loads an order the user may see, or fails as not found (scope is never revealed). */
  async load(auth: AuthContext, id: string, tx: Db | Tx = this.db, lock = false) {
    const q = tx.select().from(orders).where(and(eq(orders.id, id), orderScope(auth)));
    const [order] = lock ? await q.for('update') : await q;
    if (!order) throw new NotFoundException({ message: 'Order not found' });
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, id)).orderBy(asc(orderLines.flavour));
    return { order, lines };
  }

  async detail(auth: AuthContext, id: string) {
    const { order, lines } = await this.load(auth, id);
    const [customer] = order.customerId ? await this.db.select().from(customers).where(eq(customers.id, order.customerId)) : [null];
    const [agent] = await this.db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, order.agentId));
    const [pays, docs, approvals, timeline, commission] = await Promise.all([
      this.db
        .select({
          id: payments.id,
          receivedOn: payments.receivedOn,
          amountCents: payments.amountCents,
          method: payments.method,
          bankReference: payments.bankReference,
          createdAt: payments.createdAt,
          confirmedByName: users.name,
        })
        .from(payments)
        .leftJoin(users, eq(users.id, payments.confirmedById))
        .where(eq(payments.orderId, id))
        .orderBy(asc(payments.createdAt)),
      this.db
        .select({
          id: documents.id,
          type: documents.type,
          number: documents.number,
          createdAt: documents.createdAt,
          totalCents: documents.totalCents,
          language: documents.language,
          supersededById: documents.supersededById,
          fileName: documents.fileName,
          mimeType: documents.mimeType,
          label: documents.label,
          data: documents.data,
          createdById: documents.createdById,
          createdByName: users.name,
        })
        .from(documents)
        .leftJoin(users, eq(users.id, documents.createdById))
        .where(eq(documents.orderId, id))
        .orderBy(asc(documents.createdAt)),
      this.db.select().from(approvalRequests).where(eq(approvalRequests.orderId, id)).orderBy(desc(approvalRequests.createdAt)),
      this.db.select().from(auditLog).where(and(eq(auditLog.recordType, 'order'), eq(auditLog.recordId, id))).orderBy(desc(auditLog.at)).limit(100),
      this.db.select().from(commissionEntries).where(eq(commissionEntries.orderId, id)),
    ]);
    const waiting = order.status === 'waiting_for_stock' ? await this.shortages(lines) : [];
    const today = isoDate();
    const outstandingCents = Math.max(0, order.totalCents - order.paidCents - order.creditedCents);
    const shownDocs = docs.map(({ data, ...d }) => {
      const x = (data ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v : null);
      return {
        ...d,
        uploadKind: str(x.uploadKind) as OrderUploadKind | null,
        description: str(x.description),
        reason: str(x.reason),
        references: str(x.references),
        replaces: str(x.replaces),
        priceAdjustment: x.priceAdjustment === true,
        openedAt: str(x.openedAt),
      };
    });
    const visibleDocs = auth.perms.scope === 'shipping' ? shownDocs.filter((d) => d.type === 'delivery_note') : shownDocs;
    const [company, bank] = await Promise.all([this.settings.get('company'), this.settings.get('bank')]);
    const cancelledEntry = order.status === 'cancelled' ? timeline.find((t) => t.action === 'cancelled') : undefined;
    return {
      order: { ...order, outstandingCents, daysLate: lateDays(order.paymentDueOn, outstandingCents, order.status, today) },
      lines: lines.map((l) => ({ ...l, remainingCartons: l.cartons - (l.deliveredCartons ?? 0) })),
      tier: tierFor(order.totalCartons),
      customer: customer && {
        id: customer.id,
        companyName: customer.companyName,
        vatNumber: customer.vatNumber,
        vatValid: customer.vatValid,
        country: customer.country,
        contactName: customer.contactName,
        phone: customer.phone,
        invoiceEmail: customer.invoiceEmail,
        deliveryAddress: customer.deliveryAddress ?? customer.registeredAddress,
        city: customer.city,
        paymentTermsDays: customer.paymentTermsDays,
        paymentTerms: customer.paymentTerms,
        proformaLanguage: customer.proformaLanguage,
      },
      agent,
      houseSale: await this.isHouse(this.db, order.agentId),
      payments: pays,
      documents: visibleDocs,
      approvals,
      pendingApproval: approvals.find((a) => a.status === 'pending') ?? null,
      commission: commission.filter((c) => c.status !== 'void'),
      waitingFor: waiting,
      timeline: timeline.map((t) => ({ id: t.id, at: t.at, actorName: t.actorName, action: t.action, changes: t.changes, meta: t.meta })),
      cancelNote: ((cancelledEntry?.meta as { note?: string } | null)?.note as string | undefined) ?? null,
      // Company and bank for the payment and warehouse papers (same layout as the proforma).
      paper: { company: { name: company.legalName || company.name, vatNumber: company.vatNumber, address: [company.address, company.city].filter(Boolean).join(', ') }, bank: { bank: bank.bank, iban: bank.iban }, brand: (await this.docs.brand()).app, language: await this.docs.languageFor(customer?.proformaLanguage ?? 'en') },
      actions: this.actionsFor(auth, order, approvals.some((a) => a.status === 'pending')),
    };
  }

  /** Only the actions possible right now, for this user (FR-SALE-5). */
  actionsFor(auth: AuthContext, order: OrderRow, pending: boolean): string[] {
    const a: string[] = [];
    const isAdmin = auth.perms.scope === 'all' && auth.perms.areas.sales === 'edit';
    const canSell = auth.perms.areas.sales === 'edit';
    const s = order.status;
    if (s === 'draft' && canSell) a.push('edit', 'delete', 'send_payment_request', ...(pending ? [] : ['special_price']));
    const after = order.paymentTerms === 'after_delivery_30';
    const owed = order.totalCents - order.paidCents - order.creditedCents > 0;
    if ((s === 'payment_to_confirm' || (after && owed && s !== 'draft' && s !== 'cancelled')) && can(auth, 'confirm_payment')) a.push('confirm_payment');
    if (s === 'ready_to_send' && isAdmin) a.push('send_to_warehouse');
    if (s === 'waiting_for_stock' && isAdmin) a.push('allocate');
    if ((s === 'delivered' || s === 'delivered_part') && can(auth, 'issue_invoices') && (after || order.paidCents >= order.totalCents - order.creditedCents)) a.push('issue_invoice');
    if (s === 'delivered_part' && isAdmin && !order.partDeliveryOutcome) a.push('part_outcome');
    if (ORDER_PRE_SHIPPING.includes(s) && canSell && !pending) a.push('correction', 'cancel');
    if (s === 'invoiced' && can(auth, 'issue_invoices')) a.push('credit_note');
    // A cancelled order can be brought back by whoever could cancel it (agents only while unpaid).
    if (s === 'cancelled' && canSell && order.requestSentAt && (auth.perms.scope === 'all' || order.paidCents === 0)) a.push('uncancel');
    // Agents upload documents to their own orders (purchase order, signed order, proof of payment...).
    if (auth.perms.scope === 'own' && canSell && s !== 'cancelled') a.push('upload');
    return a;
  }

  private async shortages(lines: LineRow[]) {
    const available = await this.stock.available();
    const short = lines.filter((l) => available[l.flavour] < l.units);
    if (!short.length) return [];
    const incoming = await this.db
      .select({ flavour: purchaseLines.flavour, purchaseId: purchases.id, number: purchases.number, expectedOn: purchases.expectedOn, units: purchaseLines.units })
      .from(purchaseLines)
      .innerJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
      .where(and(inArray(purchases.status, ['ordered', 'on_the_way']), inArray(purchaseLines.flavour, short.map((l) => l.flavour))))
      .orderBy(asc(purchases.expectedOn));
    return short.map((l) => {
      const p = incoming.find((x) => x.flavour === l.flavour);
      return { flavour: l.flavour, neededUnits: l.units, availableUnits: Math.max(0, available[l.flavour]), purchase: p ? { id: p.purchaseId, number: p.number, expectedOn: p.expectedOn } : null };
    });
  }

  // ---------- Drafts ----------

  private async assertCustomerForSale(auth: AuthContext, customerId: string, tx: Db | Tx) {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
    if (!c) throw new BadRequestException({ message: 'Choose a customer', fields: { customerId: 'Choose a customer' } });
    if (auth.perms.scope === 'own' && c.agentId !== auth.user.id) throw new ForbiddenException({ message: 'This customer belongs to another agent' });
    return c;
  }

  private async writeLines(tx: Tx, orderId: string, cartons: CartonsByFlavour, special: number | null) {
    const calc = calculateOrder(cartons, special);
    await tx.delete(orderLines).where(eq(orderLines.orderId, orderId));
    if (calc.lines.length) {
      await tx.insert(orderLines).values(calc.lines.map((l) => ({ orderId, flavour: l.flavour, cartons: l.cartons, units: l.units, unitPriceCents: l.unitPriceCents, lineNetCents: l.lineNetCents })));
    }
    return calc;
  }

  private totalsFrom(calc: ReturnType<typeof calculateOrder>, house = false) {
    return {
      totalCartons: calc.totalCartons,
      totalUnits: calc.totalUnits,
      tierUnitPriceCents: calc.tierUnitPriceCents,
      unitPriceCents: calc.unitPriceCents,
      netCents: calc.netCents,
      vatCents: calc.vatCents,
      totalCents: calc.totalCents,
      commissionCents: house ? 0 : calc.commissionCents,
    };
  }

  /** A house sale: the order is held by someone who is not an agent, so there is no commission. */
  private async isHouse(tx: Db | Tx, userId: string) {
    const [u] = await tx.select({ base: sql<string>`(select base_role from roles where roles.id = ${users.roleId})` }).from(users).where(eq(users.id, userId));
    return u?.base !== 'agent';
  }

  /**
   * Who gets the order (and its commission). Agents always sell for themselves. An Admin keeps the
   * customer's agent unless they pick another agent or 'none' (house sale, no commission); the
   * agent who owns the customer is told when the commission goes to someone else.
   */
  private async agentFor(auth: AuthContext, tx: Db | Tx, customer: { agentId: string | null } | null, picked: string | undefined, fallback: string) {
    if (auth.perms.scope !== 'all') return fallback;
    if (picked === 'none') return auth.user.id;
    if (picked) {
      const [a] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, picked), sql`${users.roleId} in (select id from roles where base_role = 'agent')`));
      if (!a) throw new BadRequestException({ message: 'Choose an agent', fields: { agentId: 'Choose an agent' } });
      return a.id;
    }
    return customer?.agentId ?? fallback;
  }

  async createDraft(auth: AuthContext, input: { customerId?: string | null; cartons: CartonsByFlavour; note?: string; eventId?: string | null; agentId?: string }) {
    const r = await this.db.transaction(async (tx) => {
      let customer: typeof customers.$inferSelect | null = null;
      if (input.customerId) {
        customer = await this.assertCustomerForSale(auth, input.customerId, tx);
        if (customer.status !== 'active') throw new BadRequestException({ message: 'This customer is not approved yet', fields: { customerId: 'Waiting for approval' } });
      }
      const agentId = await this.agentFor(auth, tx, customer, input.agentId, auth.user.id);
      const number = await this.numbering.next(tx, 'order');
      const [order] = await tx
        .insert(orders)
        .values({ number, customerId: input.customerId ?? null, agentId, eventId: input.eventId ?? null, note: input.note, createdById: auth.user.id })
        .returning();
      const calc = await this.writeLines(tx, order.id, input.cartons, null);
      await tx.update(orders).set(this.totalsFrom(calc, await this.isHouse(tx, agentId))).where(eq(orders.id, order.id));
      await this.audit.log(auth, { category: 'orders', action: 'draft_created', recordType: 'order', recordId: order.id, recordLabel: number, meta: customer?.agentId && customer.agentId !== agentId ? { agentChangedFrom: customer.agentId } : undefined }, tx);
      return { id: order.id, number, customer, agentId };
    });
    await this.tellOwnerIfChanged(r.customer, r.agentId, r.number, r.id);
    return { id: r.id, number: r.number };
  }

  private async tellOwnerIfChanged(customer: { agentId: string | null; companyName: string } | null, agentId: string, number: string, id: string) {
    if (!customer?.agentId || customer.agentId === agentId) return;
    const [u] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, agentId));
    await this.notify.toUsers([customer.agentId], { type: 'agent_changed', title: `${number} for ${customer.companyName} went to ${u?.name ?? 'another agent'}`, body: 'The commission on this order goes to them.', link: `/sales/${id}` });
  }

  async updateDraft(auth: AuthContext, id: string, input: { customerId?: string | null; cartons: CartonsByFlavour; note?: string; agentId?: string }) {
    const r = await this.db.transaction(async (tx) => {
      const { order } = await this.load(auth, id, tx, true);
      if (order.status !== 'draft') throw new ConflictException({ message: 'Only drafts can be edited. Ask for a correction instead.' });
      let customer: typeof customers.$inferSelect | null = null;
      if (input.customerId) {
        customer = await this.assertCustomerForSale(auth, input.customerId, tx);
        if (customer.status !== 'active') throw new BadRequestException({ message: 'This customer is not approved yet', fields: { customerId: 'Waiting for approval' } });
      }
      const agentId = input.agentId || customer ? await this.agentFor(auth, tx, customer, input.agentId, order.agentId) : order.agentId;
      const calc = await this.writeLines(tx, id, input.cartons, order.specialUnitPriceCents);
      await tx
        .update(orders)
        .set({ ...this.totalsFrom(calc, await this.isHouse(tx, agentId)), customerId: input.customerId ?? null, agentId, note: input.note ?? order.note })
        .where(eq(orders.id, id));
      await this.audit.log(auth, { category: 'orders', action: 'draft_updated', recordType: 'order', recordId: id, recordLabel: order.number }, tx);
      return { customer, agentId, changed: agentId !== order.agentId, number: order.number };
    });
    if (r.changed) await this.tellOwnerIfChanged(r.customer, r.agentId, r.number, id);
    return { ok: true };
  }

  async deleteDraft(auth: AuthContext, id: string) {
    return this.db.transaction(async (tx) => {
      const { order } = await this.load(auth, id, tx, true);
      if (order.status !== 'draft') throw new ConflictException({ message: 'Only drafts can be deleted' });
      await tx.delete(approvalRequests).where(eq(approvalRequests.orderId, id));
      await tx.delete(orders).where(eq(orders.id, id));
      await this.audit.log(auth, { category: 'orders', action: 'draft_deleted', recordType: 'order', recordId: id, recordLabel: order.number }, tx);
      return { ok: true };
    });
  }

  // ---------- Payment request ----------

  /** True when every line can be reserved from available stock. */
  private async canReserve(tx: Tx, lines: { flavour: Flavour; units: number }[], excludeOrderId?: string) {
    const available = await this.stock.available(tx, excludeOrderId);
    return lines.every((l) => available[l.flavour] >= l.units);
  }

  async sendPaymentRequest(auth: AuthContext, id: string) {
    // A VAT number the EU register couldn't confirm when the customer was added is checked again before the first proforma (customers).
    const vat = await this.customersVat.recheckVatBeforeProforma(auth, id);
    if (vat?.checked && vat.valid === false) {
      throw new BadRequestException({ message: "The EU register says this customer's VAT number isn't valid. Fix it on the customer card, then send the payment request.", code: 'vat_invalid' });
    }
    const result = await this.db.transaction(async (tx) => {
      const { order, lines } = await this.load(auth, id, tx, true);
      if (order.status !== 'draft') throw new ConflictException({ message: 'This payment request was already sent' });
      if (!order.customerId) throw new BadRequestException({ message: 'Choose a customer', fields: { customerId: 'Choose a customer' } });
      const rules = await this.settings.rules(tx);
      if (order.totalCartons < rules.minOrderCartons) {
        throw new BadRequestException({ message: `Add ${rules.minOrderCartons - order.totalCartons} more cartons to reach the minimum of ${rules.minOrderCartons}` });
      }
      const [pending] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.orderId, id), eq(approvalRequests.status, 'pending')));
      if (pending) throw new ConflictException({ message: 'The special price is waiting for an admin. Send it once it is approved.' });
      const customer = await this.assertCustomerForSale(auth, order.customerId, tx);
      if (customer.status !== 'active') throw new BadRequestException({ message: 'This customer is not approved yet' });

      const now = new Date();
      const reserve = await this.canReserve(tx, lines);
      const number = await this.numbering.next(tx, 'proforma');
      const validUntil = isoDate(addDays(now, rules.proformaValidityDays));
      // Payment terms (customer card): 100% before shipping, 50% now and the rest before shipping, or
      // invoice due 30 days after delivery — then the order can go to the warehouse without a payment.
      const terms = customer.paymentTerms ?? 'before_shipping';
      const after = terms === 'after_delivery_30';
      const depositCents = terms === 'half_before_shipping' ? depositOf(order.totalCents) : null;
      const dueOn = after ? null : isoDate(addDays(now, customer.paymentTermsDays));
      const data = await this.docs.customerDocData(tx, id, number, lines, { dueOn, validUntil, paymentTerms: terms, depositCents });
      const [doc] = await tx
        .insert(documents)
        .values({ type: 'proforma', number, orderId: id, customerId: customer.id, language: data.language, data: data as never, totalCents: data.totalCents, createdById: auth.user.id })
        .returning();
      await tx
        .update(orders)
        .set({
          status: after ? (reserve ? 'ready_to_send' : 'waiting_for_stock') : 'payment_to_confirm',
          requestSentAt: now,
          allocated: reserve,
          reservedUntil: reserve && !after ? addDays(now, rules.stockHoldDays) : null,
          proformaExpiresAt: addDays(now, rules.proformaValidityDays),
          paymentDueOn: dueOn,
          paymentTerms: terms,
        })
        .where(eq(orders.id, id));
      // Ownership runs N months from each order, or from the first order only (FR-CUST-5, rule editor).
      const ownedUntil = isoDate(addMonths(now, rules.ownership.months));
      const extend = rules.ownership.countedFrom === 'each_order' || !customer.ownedUntil;
      if (extend && (!customer.ownedUntil || customer.ownedUntil < ownedUntil)) {
        await tx.update(customers).set({ ownedUntil, ownershipWarnedAt: null }).where(eq(customers.id, customer.id));
      }
      if (!(await this.isHouse(tx, order.agentId))) await tx.insert(commissionEntries).values({ agentId: order.agentId, orderId: id, units: order.totalUnits, amountCents: order.commissionCents, status: 'coming' });
      await this.audit.log(auth, { category: 'orders', action: 'payment_request_sent', recordType: 'order', recordId: id, recordLabel: order.number, money: true, meta: { proforma: number, totalCents: order.totalCents, reserved: reserve } }, tx);
      await this.audit.log(auth, { category: 'documents', action: 'proforma_issued', recordType: 'document', recordId: doc.id, recordLabel: number }, tx);
      return { order, customer, data, number };
    });
    const agentEmail = await this.emailOf(result.order.agentId);
    await this.mail.send({
      kind: 'payment_request',
      to: [result.customer.invoiceEmail],
      cc: [agentEmail],
      subject: result.data.language === 'bg' ? `Проформа ${result.number} · ${result.order.number}` : `Proforma ${result.number} · ${result.order.number}`,
      body: paymentRequestBody(result.data),
      recordType: 'order',
      recordId: id,
      attachments: [{ filename: `${result.number}.html`, content: this.docs.renderHtml('proforma', result.data), contentType: 'text/html' }],
    });
    return { ok: true, proforma: result.number };
  }

  // ---------- Special price ----------

  async requestSpecialPrice(auth: AuthContext, id: string, unitPriceCents: number, reason: string) {
    return this.db.transaction(async (tx) => {
      const { order } = await this.load(auth, id, tx, true);
      if (order.status !== 'draft') throw new ConflictException({ message: 'A special price can be asked for on a draft only' });
      const tier = tierFor(order.totalCartons);
      if (!tier) throw new BadRequestException({ message: 'Reach the minimum order first, then ask for a special price' });
      if (unitPriceCents >= tier.unitPriceCents) throw new BadRequestException({ message: 'Ask for a price below the list price', fields: { unitPriceCents: `Below ${tier.unitPriceCents / 100}` } });
      const [existing] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.orderId, id), eq(approvalRequests.status, 'pending')));
      if (existing) throw new ConflictException({ message: 'A request for this order is already waiting' });
      const [req] = await tx
        .insert(approvalRequests)
        .values({ type: 'special_price', orderId: id, customerId: order.customerId, requestedById: auth.user.id, reason, payload: { unitPriceCents, tierUnitPriceCents: tier.unitPriceCents, units: order.totalUnits } })
        .returning();
      await this.audit.log(auth, { category: 'orders', action: 'special_price_requested', recordType: 'order', recordId: id, recordLabel: order.number, money: true, changes: { unitPriceCents: { from: tier.unitPriceCents, to: unitPriceCents } } }, tx);
      await this.notify.toRoles(['system_admin', 'admin'], { type: 'approval', title: `Special price for ${order.number}`, body: reason, link: `/home?review=${req.id}` }, tx);
      return { id: req.id };
    });
  }

  /** Applied by Approvals when an Admin approves a special price. */
  async applySpecialPrice(tx: Tx, orderId: string, unitPriceCents: number) {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    const calc = await this.writeLines(tx, orderId, cartonsOf(lines), unitPriceCents);
    await tx.update(orders).set({ ...this.totalsFrom(calc, await this.isHouse(tx, order.agentId)), specialUnitPriceCents: unitPriceCents }).where(eq(orders.id, orderId));
    return order;
  }

  // ---------- Payment ----------

  async confirmPayment(auth: AuthContext, id: string, input: { receivedOn: string; amountCents: number; method: string; bankReference?: string }) {
    const result = await this.db.transaction(async (tx) => {
      const { order, lines } = await this.load(auth, id, tx, true);
      const after = order.paymentTerms === 'after_delivery_30';
      // 30 days after delivery: the payment can come at any point after the payment request.
      if (order.status !== 'payment_to_confirm' && !(after && order.status !== 'draft' && order.status !== 'cancelled')) throw new ConflictException({ message: 'This order is not waiting for a payment' });
      const outstanding = order.totalCents - order.paidCents - order.creditedCents;
      if (outstanding <= 0) throw new ConflictException({ message: 'This order is paid in full' });
      if (input.amountCents > outstanding) throw new BadRequestException({ message: 'The amount is more than what is owed', fields: { amountCents: `At most ${(outstanding / 100).toFixed(2)}` } });
      await tx.insert(payments).values({ orderId: id, receivedOn: input.receivedOn, amountCents: input.amountCents, method: input.method, bankReference: input.bankReference, confirmedById: auth.user.id });
      const paidCents = order.paidCents + input.amountCents;
      const full = paidCents >= order.totalCents - order.creditedCents;
      let status: OrderStatus = order.status;
      let allocated = order.allocated;
      const patch: Partial<OrderRow> = { paidCents };
      const deposit = depositOf(order.totalCents - order.creditedCents);
      if (order.status !== 'payment_to_confirm') {
        // 30 days after delivery: the order already moved on; only the money and the commission change.
        if (full) {
          Object.assign(patch, { paidAt: new Date() });
          await tx.update(commissionEntries).set({ status: 'ready', readyAt: new Date() }).where(and(eq(commissionEntries.orderId, id), eq(commissionEntries.status, 'coming')));
        }
      } else if (!full && order.paymentTerms === 'half_before_shipping' && paidCents >= deposit && order.paidCents < deposit) {
        // Deposit in: the order is confirmed and its stock is held until it ships; the rest is due before shipping (no date).
        if (!allocated) allocated = await this.canReserve(tx, lines, id);
        Object.assign(patch, { allocated, reservedUntil: null, paymentDueOn: null });
      } else if (full) {
        if (!allocated) allocated = await this.canReserve(tx, lines, id);
        status = allocated ? 'ready_to_send' : 'waiting_for_stock';
        const cost = await this.stock.avgLandedCost(tx);
        Object.assign(patch, {
          status,
          allocated,
          paidAt: new Date(),
          reservedUntil: null,
          purchaseCostCents: Math.round(lines.reduce((s, l) => s + l.units * cost[l.flavour], 0)),
        });
        await tx.update(commissionEntries).set({ status: 'ready', readyAt: new Date() }).where(and(eq(commissionEntries.orderId, id), eq(commissionEntries.status, 'coming')));
      }
      await tx.update(orders).set(patch).where(eq(orders.id, id));
      await this.audit.log(
        auth,
        {
          category: 'payments',
          action: full ? 'payment_confirmed' : 'part_payment_confirmed',
          recordType: 'order',
          recordId: id,
          recordLabel: order.number,
          money: true,
          changes: { paidCents: { from: order.paidCents, to: paidCents }, ...(full ? { status: { from: order.status, to: status } } : {}) },
          meta: { amountCents: input.amountCents, receivedOn: input.receivedOn, method: input.method, bankReference: input.bankReference },
        },
        tx,
      );
      if (full) {
        await this.notify.toUsers([order.agentId], { type: 'payment', title: `${order.number} is paid`, body: status === 'waiting_for_stock' ? 'Waiting for stock' : status === 'ready_to_send' ? 'Ready to send' : 'Paid in full', link: `/sales/${id}` }, tx);
      }
      return { status, full };
    });
    return result;
  }

  // ---------- Warehouse ----------

  async sendToWarehouse(auth: AuthContext, id: string) {
    const result = await this.db.transaction(async (tx) => {
      const { order, lines } = await this.load(auth, id, tx, true);
      if (order.status !== 'ready_to_send') throw new ConflictException({ message: 'Only paid orders with stock can be sent to the warehouse' });
      if (order.paymentTerms !== 'after_delivery_30' && order.paidCents < order.totalCents - order.creditedCents) throw new ConflictException({ message: 'The order must be paid in full before shipping' });
      if (order.purchaseCostCents == null) {
        const cost = await this.stock.avgLandedCost(tx);
        await tx.update(orders).set({ purchaseCostCents: Math.round(lines.reduce((s, l) => s + l.units * cost[l.flavour], 0)) }).where(eq(orders.id, id));
      }
      for (const l of lines) await this.stock.move(tx, { flavour: l.flavour, units: -l.units, kind: 'dispatch', orderId: id, byId: auth.user.id });
      await tx.update(orders).set({ status: 'at_warehouse', sentToWarehouseAt: new Date() }).where(eq(orders.id, id));
      await this.audit.log(auth, { category: 'orders', action: 'sent_to_warehouse', recordType: 'order', recordId: id, recordLabel: order.number, changes: { status: { from: order.status, to: 'at_warehouse' } } }, tx);
      await this.notify.toRoles(['warehouse'], { type: 'to_ship', title: `${order.number} to ship`, link: `/warehouse` }, tx);
      return { order, lines };
    });
    await this.emailWarehouse(result.order, result.lines.map((l) => ({ flavour: l.flavour, cartons: l.cartons })));
    return { ok: true };
  }

  private async emailWarehouse(order: OrderRow, lines: { flavour: Flavour; cartons: number }[]) {
    const [c] = await this.db.select().from(customers).where(eq(customers.id, order.customerId!));
    const email = await this.settings.get('email');
    const total = lines.reduce((s, l) => s + l.cartons, 0);
    await this.mail.send({
      kind: 'sent_to_warehouse',
      to: [email.warehouse, ...(await this.notify.emailsWithRoles(['warehouse']))],
      subject: `To ship: ${order.number} · ${c.companyName}`,
      // No prices or values (warehouse visibility rule).
      body: [
        `Order ${order.number}`,
        `Deliver to: ${c.companyName}`,
        `${c.deliveryAddress ?? c.registeredAddress}`,
        `Contact: ${c.contactName}, ${c.phone}`,
        '',
        ...lines.map((l) => `${l.flavour.toUpperCase()}: ${l.cartons} cartons (${l.cartons * UNITS_PER_CARTON} units)`),
        `Total: ${total} cartons (${total * UNITS_PER_CARTON} units)`,
      ].join('\n'),
      recordType: 'order',
      recordId: order.id,
    });
  }

  /**
   * Signed delivery note uploaded from the warehouse phone (FR-WH-3, FR-WH-4). For a part delivery
   * the warehouse records only the facts; cartons coming back return to stock and an Admin decides
   * between a credit note and re-delivery (A6).
   */
  async deliver(auth: AuthContext, id: string, file: { buffer: Buffer; originalname: string; mimetype: string }, part?: { kept: CartonsByFlavour; reason: string; note?: string }) {
    if (!this.files.isAllowed(file.mimetype)) throw new BadRequestException({ message: 'Upload a photo (JPG, PNG, HEIC) or a PDF' });
    const saved = await this.files.save(file);
    return this.db.transaction(async (tx) => {
      const { order, lines } = await this.load(auth, id, tx, true);
      if (order.status !== 'at_warehouse') throw new ConflictException({ message: 'This order is not at the warehouse' });
      let returned = 0;
      for (const l of lines) {
        const sent = l.cartons - (l.deliveredCartons ?? 0);
        const kept = part ? Math.min(sent, Math.max(0, Math.floor(part.kept[l.flavour] ?? 0))) : sent;
        const back = sent - kept;
        returned += back;
        await tx.update(orderLines).set({ deliveredCartons: (l.deliveredCartons ?? 0) + kept }).where(eq(orderLines.id, l.id));
        if (back > 0) await this.stock.move(tx, { flavour: l.flavour, units: back * UNITS_PER_CARTON, kind: 'return', reason: part?.reason, note: part?.note, orderId: id, byId: auth.user.id });
      }
      const status: OrderStatus = returned > 0 ? 'delivered_part' : 'delivered';
      await tx.insert(documents).values({ type: 'delivery_note', orderId: id, customerId: order.customerId, filePath: saved.path, fileName: saved.name, mimeType: saved.mime, label: 'Signed delivery note', data: part ? { reason: part.reason, note: part.note, returnedCartons: returned } : {}, createdById: auth.user.id });
      await tx.update(orders).set({ status, deliveredAt: new Date(), partDeliveryOutcome: null }).where(eq(orders.id, id));
      await this.audit.log(auth, { category: 'orders', action: status === 'delivered' ? 'delivered' : 'delivered_in_part', recordType: 'order', recordId: id, recordLabel: order.number, changes: { status: { from: order.status, to: status } }, meta: part ? { reason: part.reason, returnedCartons: returned } : undefined }, tx);
      const title = status === 'delivered' ? `${order.number} delivered` : `${order.number} delivered in part · ${returned} cartons back`;
      await this.notify.toRoles(['system_admin', 'admin'], { type: 'delivered', title, link: `/sales/${id}` }, tx);
      await this.notify.toUsers([order.agentId], { type: 'delivered', title, link: `/sales/${id}` }, tx);
      return { status, returnedCartons: returned };
    });
  }

  async partOutcome(auth: AuthContext, id: string, outcome: 'credit_note' | 'redeliver', note?: string) {
    return this.db.transaction(async (tx) => {
      const { order, lines } = await this.load(auth, id, tx, true);
      if (order.status !== 'delivered_part') throw new ConflictException({ message: 'This order was not delivered in part' });
      if (outcome === 'redeliver') {
        for (const l of lines) {
          const remaining = l.cartons - (l.deliveredCartons ?? 0);
          if (remaining > 0) await this.stock.move(tx, { flavour: l.flavour, units: -remaining * UNITS_PER_CARTON, kind: 'dispatch', reason: 'redelivery', orderId: id, byId: auth.user.id });
        }
        await tx.update(orders).set({ status: 'at_warehouse', partDeliveryOutcome: 'redeliver' }).where(eq(orders.id, id));
        await this.notify.toRoles(['warehouse'], { type: 'to_ship', title: `${order.number} to deliver again`, link: '/warehouse' }, tx);
      } else {
        await tx.update(orders).set({ partDeliveryOutcome: 'credit_note' }).where(eq(orders.id, id));
      }
      await this.audit.log(auth, { category: 'orders', action: `part_delivery_${outcome}`, recordType: 'order', recordId: id, recordLabel: order.number, meta: { note } }, tx);
      return { ok: true };
    });
  }

  // ---------- Invoice and credit note ----------

  async issueInvoice(auth: AuthContext, id: string) {
    const r = await this.db.transaction(async (tx) => {
      const { order, lines } = await this.load(auth, id, tx, true);
      if (order.status !== 'delivered' && order.status !== 'delivered_part') throw new ConflictException({ message: 'Invoices are issued once the order is delivered' });
      if (order.status === 'delivered_part' && !order.partDeliveryOutcome) throw new ConflictException({ message: 'Decide between a credit note and re-delivery first' });
      const after = order.paymentTerms === 'after_delivery_30';
      if (!after && order.paidCents < order.totalCents - order.creditedCents) throw new ConflictException({ message: 'Only fully paid orders can be invoiced' });
      // 30 days after delivery: the invoice is what the customer pays, due 30 days after the delivery.
      const invoiceDue = after && order.paidCents < order.totalCents - order.creditedCents ? isoDate(addDays(order.deliveredAt ?? new Date(), 30)) : null;
      const number = await this.numbering.next(tx, 'invoice');
      const [proforma] = await tx.select({ number: documents.number }).from(documents).where(and(eq(documents.orderId, id), eq(documents.type, 'proforma'), sql`${documents.supersededById} is null`)).orderBy(desc(documents.createdAt)).limit(1);
      const [lastPay] = await tx.select().from(payments).where(eq(payments.orderId, id)).orderBy(desc(payments.receivedOn)).limit(1);
      const data = await this.docs.customerDocData(tx, id, number, lines, {
        references: proforma?.number ?? null,
        paidCents: order.paidCents,
        paidOn: lastPay?.receivedOn ?? null,
        paidMethod: lastPay?.method ?? null,
        deliveredOn: order.deliveredAt ? isoDate(order.deliveredAt) : null,
        paymentTerms: order.paymentTerms,
        dueOn: invoiceDue,
      });
      const [doc] = await tx
        .insert(documents)
        .values({ type: 'invoice', number, orderId: id, customerId: order.customerId, language: data.language, data: data as never, totalCents: data.totalCents, createdById: auth.user.id })
        .returning();
      await tx.update(orders).set({ status: 'invoiced', invoicedAt: new Date(), ...(invoiceDue ? { paymentDueOn: invoiceDue } : {}) }).where(eq(orders.id, id));
      await this.audit.log(auth, { category: 'documents', action: 'invoice_issued', recordType: 'order', recordId: id, recordLabel: order.number, money: true, meta: { invoice: number, documentId: doc.id, totalCents: data.totalCents } }, tx);
      // Part delivery settled by credit note: credit the cartons that came back (already returned to stock).
      let credit: Awaited<ReturnType<OrdersService['writeCreditNote']>> | null = null;
      if (order.status === 'delivered_part' && order.partDeliveryOutcome === 'credit_note') {
        const cartons = Object.fromEntries(lines.map((l) => [l.flavour, l.cartons - (l.deliveredCartons ?? 0)])) as CartonsByFlavour;
        if (Object.values(cartons).some((c) => (c ?? 0) > 0)) credit = await this.writeCreditNote(tx, auth, order, lines, { id: doc.id, number }, { reason: 'returned', cartons, note: 'Part delivery' }, false);
      }
      return { order, data, number, credit };
    });
    await this.emailInvoice(r.order, r.data, r.number);
    if (r.credit) await this.emailCredit(r.order, r.credit.data, r.credit.number);
    return { ok: true, invoice: r.number };
  }

  /** Home › Delivered, no invoice › "Issue all N paid ones". */
  async issueAllPaid(auth: AuthContext) {
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'delivered'), sql`${orders.paidCents} >= ${orders.totalCents} - ${orders.creditedCents}`, orderScope(auth)));
    const issued: string[] = [];
    for (const r of rows) issued.push((await this.issueInvoice(auth, r.id)).invoice);
    return { issued };
  }

  private async emailInvoice(order: OrderRow, data: Awaited<ReturnType<DocumentsService['customerDocData']>>, number: string) {
    const email = await this.settings.get('email');
    await this.mail.send({
      kind: 'invoice',
      to: [data.customer.invoiceEmail],
      cc: [await this.emailOf(order.agentId), email.accounting, ...(await this.notify.emailsWithRoles(['system_admin', 'admin']))],
      subject: data.language === 'bg' ? `Фактура ${number} · ${order.number}` : `Invoice ${number} · ${order.number}`,
      body: invoiceBody(data, 'invoice'),
      recordType: 'order',
      recordId: order.id,
      attachments: [{ filename: `${number}.html`, content: this.docs.renderHtml('invoice', data), contentType: 'text/html' }],
    });
  }

  private async emailCredit(order: OrderRow, data: Awaited<ReturnType<DocumentsService['customerDocData']>>, number: string) {
    await this.mail.send({
      kind: 'credit_note',
      to: [data.customer.invoiceEmail],
      cc: [await this.emailOf(order.agentId)],
      subject: data.language === 'bg' ? `Кредитно известие ${number}` : `Credit note ${number}`,
      body: invoiceBody(data, 'credit_note'),
      recordType: 'order',
      recordId: order.id,
      attachments: [{ filename: `${number}.html`, content: this.docs.renderHtml('credit_note', data), contentType: 'text/html' }],
    });
  }

  private async writeCreditNote(
    tx: Tx,
    auth: AuthContext,
    order: OrderRow,
    lines: LineRow[],
    invoice: { id: string; number: string | null },
    input: { reason: string; cartons: CartonsByFlavour; note?: string },
    restock: boolean,
  ) {
    const creditLines = lines
      .map((l) => {
        const max = (l.deliveredCartons ?? l.cartons) - l.creditedCartons + (restock ? 0 : l.cartons - (l.deliveredCartons ?? l.cartons));
        const c = Math.max(0, Math.floor(input.cartons[l.flavour] ?? 0));
        if (c > max) throw new BadRequestException({ message: `At most ${max} cartons of ${l.flavour.toUpperCase()} can be credited`, fields: { [`cartons.${l.flavour}`]: `At most ${max}` } });
        return { line: l, cartons: c };
      })
      .filter((x) => x.cartons > 0);
    if (!creditLines.length) throw new BadRequestException({ message: 'Enter the cartons to credit' });
    const number = await this.numbering.next(tx, 'credit_note');
    const docLines = creditLines.map(({ line, cartons }) => ({ flavour: line.flavour, cartons, units: cartons * UNITS_PER_CARTON, unitPriceCents: line.unitPriceCents, lineNetCents: cartons * UNITS_PER_CARTON * line.unitPriceCents }));
    const units = docLines.reduce((s, l) => s + l.units, 0);
    const costPerUnit = order.purchaseCostCents && order.totalUnits ? order.purchaseCostCents / order.totalUnits : 0;
    const commissionPerUnit = order.totalUnits ? order.commissionCents / order.totalUnits : 0;
    const data = await this.docs.customerDocData(tx, order.id, number, docLines, {
      references: invoice.number,
      reason: input.reason,
      note: input.note ?? null,
      units,
      costCents: Math.round(units * costPerUnit),
      commissionCents: Math.round(units * commissionPerUnit),
    });
    const [doc] = await tx
      .insert(documents)
      .values({ type: 'credit_note', number, orderId: order.id, customerId: order.customerId, referencesDocumentId: invoice.id, language: data.language, data: data as never, totalCents: data.totalCents, createdById: auth.user.id })
      .returning();
    for (const { line, cartons } of creditLines) {
      await tx.update(orderLines).set({ creditedCartons: line.creditedCartons + cartons }).where(eq(orderLines.id, line.id));
      if (restock) await this.stock.move(tx, { flavour: line.flavour, units: cartons * UNITS_PER_CARTON, kind: 'credit_return', reason: input.reason, orderId: order.id, byId: auth.user.id });
    }
    await tx.update(orders).set({ creditedCents: order.creditedCents + data.totalCents }).where(eq(orders.id, order.id));
    // A5: commission already earned on credited units is offset against the next payout.
    if (data.commissionCents) {
      await tx.insert(commissionEntries).values({ agentId: order.agentId, orderId: order.id, units: -units, amountCents: -(data.commissionCents ?? 0), status: 'ready', readyAt: new Date(), note: `Credit note ${number}` });
    }
    await this.audit.log(auth, { category: 'documents', action: 'credit_note_issued', recordType: 'order', recordId: order.id, recordLabel: order.number, money: true, changes: { creditedCents: { from: order.creditedCents, to: order.creditedCents + data.totalCents } }, meta: { creditNote: number, documentId: doc.id, reason: input.reason } }, tx);
    return { number, data };
  }

  async creditNote(auth: AuthContext, id: string, input: { reason: string; cartons: CartonsByFlavour; note?: string; amountCents?: number }) {
    const r = await this.db.transaction(async (tx) => {
      const { order, lines } = await this.load(auth, id, tx, true);
      if (order.status !== 'invoiced') throw new ConflictException({ message: 'Credit notes follow an invoice' });
      const [invoice] = await tx.select().from(documents).where(and(eq(documents.orderId, id), eq(documents.type, 'invoice')));
      // Price adjustment: an agreed amount; stock doesn't change.
      if (input.amountCents != null) return { ...(await this.writePriceCredit(tx, auth, order, { id: invoice.id, number: invoice.number }, input.amountCents, input.note)), order };
      // Returned cartons go back into available stock; damaged ones are written off.
      const out = await this.writeCreditNote(tx, auth, order, lines, { id: invoice.id, number: invoice.number }, input, input.reason !== 'damaged');
      return { ...out, order };
    });
    await this.emailCredit(r.order, r.data, r.number);
    return { ok: true, creditNote: r.number };
  }

  private async writePriceCredit(tx: Tx, auth: AuthContext, order: OrderRow, invoice: { id: string; number: string | null }, amountCents: number, note?: string) {
    const max = order.totalCents - order.creditedCents;
    if (amountCents > max) throw new BadRequestException({ message: 'More than what is left on the invoice', fields: { amountCents: `At most ${(max / 100).toFixed(2)}` } });
    const number = await this.numbering.next(tx, 'credit_note');
    const netCents = Math.round(amountCents / 1.2);
    const data = await this.docs.customerDocData(tx, order.id, number, [], {
      references: invoice.number,
      reason: 'price_error',
      note: note ?? null,
      priceAdjustment: true,
      netCents,
      vatCents: amountCents - netCents,
      totalCents: amountCents,
    });
    const [doc] = await tx
      .insert(documents)
      .values({ type: 'credit_note', number, orderId: order.id, customerId: order.customerId, referencesDocumentId: invoice.id, language: data.language, data: data as never, totalCents: amountCents, createdById: auth.user.id })
      .returning();
    await tx.update(orders).set({ creditedCents: order.creditedCents + amountCents }).where(eq(orders.id, order.id));
    await this.audit.log(auth, { category: 'documents', action: 'credit_note_issued', recordType: 'order', recordId: order.id, recordLabel: order.number, money: true, changes: { creditedCents: { from: order.creditedCents, to: order.creditedCents + amountCents } }, meta: { creditNote: number, documentId: doc.id, reason: 'price_error' } }, tx);
    return { number, data };
  }

  // ---------- Correction and cancel ----------

  async requestCorrection(auth: AuthContext, id: string, cartons: CartonsByFlavour, reason: string) {
    // An Admin corrects directly: the corrected proforma replaces the old one and is sent at once.
    if (auth.perms.scope === 'all') {
      const r = await this.db.transaction(async (tx) => {
        const { order, lines } = await this.load(auth, id, tx, true);
        if (!ORDER_PRE_SHIPPING.includes(order.status)) throw new ConflictException({ message: 'Corrections are possible only before shipping. After invoicing, issue a credit note.' });
        const rules = await this.settings.rules(tx);
        const calc = calculateOrder(cartons, order.specialUnitPriceCents);
        if (calc.totalCartons < rules.minOrderCartons) throw new BadRequestException({ message: `The minimum order is ${rules.minOrderCartons} cartons` });
        const before = cartonsOf(lines);
        if (FLAVOURS.every((f) => (before[f] ?? 0) === (cartons[f] ?? 0))) throw new BadRequestException({ message: 'Change at least one quantity' });
        await tx.update(approvalRequests).set({ status: 'withdrawn' }).where(and(eq(approvalRequests.orderId, id), eq(approvalRequests.status, 'pending')));
        const applied = await this.applyCorrection(tx, auth, id, cartons);
        await this.audit.log(auth, { category: 'orders', action: 'correction_sent', recordType: 'order', recordId: id, recordLabel: order.number, meta: { reason, proforma: applied.number } }, tx);
        if (order.agentId !== auth.user.id) await this.notify.toUsers([order.agentId], { type: 'correction', title: `${order.number} was corrected`, body: reason, link: `/sales/${id}` }, tx);
        return applied;
      });
      await this.sendCorrectedProforma(r.order, { ...r.data, note: reason }, r.number);
      return { applied: true, proforma: r.number };
    }
    return this.db.transaction(async (tx) => {
      const { order, lines } = await this.load(auth, id, tx, true);
      if (!ORDER_PRE_SHIPPING.includes(order.status)) throw new ConflictException({ message: 'Corrections are possible only before shipping. After invoicing, issue a credit note.' });
      const rules = await this.settings.rules(tx);
      const calc = calculateOrder(cartons, order.specialUnitPriceCents);
      if (calc.totalCartons < rules.minOrderCartons) throw new BadRequestException({ message: `The minimum order is ${rules.minOrderCartons} cartons` });
      const [existing] = await tx.select().from(approvalRequests).where(and(eq(approvalRequests.orderId, id), eq(approvalRequests.status, 'pending')));
      if (existing) throw new ConflictException({ message: 'A request for this order is already waiting' });
      const payload = { from: cartonsOf(lines), to: cartons, fromTotalCents: order.totalCents, toTotalCents: calc.totalCents, fromCommissionCents: order.commissionCents, toCommissionCents: calc.commissionCents };
      const [req] = await tx.insert(approvalRequests).values({ type: 'correction', orderId: id, customerId: order.customerId, requestedById: auth.user.id, reason, payload }).returning();
      await this.audit.log(auth, { category: 'orders', action: 'correction_requested', recordType: 'order', recordId: id, recordLabel: order.number, meta: payload }, tx);
      await this.notify.toRoles(['system_admin', 'admin'], { type: 'approval', title: `Correction for ${order.number}`, body: reason, link: `/home?review=${req.id}` }, tx);
      return { id: req.id };
    });
  }

  /** Applied by Approvals: a corrected proforma replaces the old one; nothing is edited in place. */
  async applyCorrection(tx: Tx, auth: AuthContext, orderId: string, cartons: CartonsByFlavour) {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!ORDER_PRE_SHIPPING.includes(order.status)) throw new ConflictException({ message: 'The order has shipped; the correction can no longer be applied' });
    const before = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    const calc = await this.writeLines(tx, orderId, cartons, order.specialUnitPriceCents);
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    const rules = await this.settings.rules(tx);
    const owed = calc.totalCents - order.creditedCents;
    const fullyPaid = order.paidCents >= owed;
    let status: OrderStatus = order.status;
    let allocated = order.allocated;
    const after = order.paymentTerms === 'after_delivery_30';
    if (after) {
      // 30 days after delivery: no payment needed before shipping.
      allocated = await this.canReserve(tx, lines, orderId);
      status = allocated ? 'ready_to_send' : 'waiting_for_stock';
    } else if (!fullyPaid) {
      status = 'payment_to_confirm';
      allocated = await this.canReserve(tx, lines, orderId);
    } else if (order.status !== 'payment_to_confirm') {
      allocated = await this.canReserve(tx, lines, orderId);
      status = allocated ? 'ready_to_send' : 'waiting_for_stock';
    } else {
      allocated = await this.canReserve(tx, lines, orderId);
    }
    await tx
      .update(orders)
      .set({ ...this.totalsFrom(calc, await this.isHouse(tx, order.agentId)), status, allocated, paidAt: fullyPaid ? order.paidAt : null, reservedUntil: allocated && !fullyPaid && !after && !(order.paymentTerms === 'half_before_shipping' && order.paidCents >= depositOf(owed)) ? addDays(new Date(), rules.stockHoldDays) : null })
      .where(eq(orders.id, orderId));
    await tx
      .update(commissionEntries)
      .set({ units: calc.totalUnits, amountCents: calc.commissionCents, status: fullyPaid ? 'ready' : 'coming' })
      .where(and(eq(commissionEntries.orderId, orderId), inArray(commissionEntries.status, ['coming', 'ready']), sql`${commissionEntries.units} > 0`));

    const [old] = await tx.select().from(documents).where(and(eq(documents.orderId, orderId), eq(documents.type, 'proforma'), sql`${documents.supersededById} is null`));
    const number = await this.numbering.next(tx, 'proforma');
    const dueOn = order.paymentDueOn;
    const data = await this.docs.customerDocData(tx, orderId, number, lines, { dueOn, validUntil: isoDate(addDays(new Date(), rules.proformaValidityDays)), replaces: old?.number ?? null, paymentTerms: order.paymentTerms, depositCents: order.paymentTerms === 'half_before_shipping' ? depositOf(calc.totalCents) : null });
    const [doc] = await tx
      .insert(documents)
      .values({ type: 'proforma', number, orderId, customerId: order.customerId, language: data.language, data: data as never, totalCents: data.totalCents, label: 'Corrected proforma', createdById: auth.user.id })
      .returning();
    if (old) await tx.update(documents).set({ supersededById: doc.id }).where(eq(documents.id, old.id));
    await this.audit.log(
      auth,
      {
        category: 'orders',
        action: 'correction_applied',
        recordType: 'order',
        recordId: orderId,
        recordLabel: order.number,
        money: true,
        changes: { ...diff({ cartons: cartonsOf(before) }, { cartons }, ['cartons']), totalCents: { from: order.totalCents, to: calc.totalCents } },
        meta: { proforma: number, replaces: old?.number },
      },
      tx,
    );
    return { order, data, number };
  }

  async sendCorrectedProforma(order: OrderRow, data: Awaited<ReturnType<DocumentsService['customerDocData']>>, number: string) {
    await this.mail.send({
      kind: 'corrected_proforma',
      to: [data.customer.invoiceEmail],
      cc: [await this.emailOf(order.agentId)],
      subject: data.language === 'bg' ? `Коригирана проформа ${number} · ${order.number}` : `Corrected proforma ${number} · ${order.number}`,
      body: paymentRequestBody(data),
      recordType: 'order',
      recordId: order.id,
      attachments: [{ filename: `${number}.html`, content: this.docs.renderHtml('proforma', data), contentType: 'text/html' }],
    });
  }

  /** Cancel before shipping (FR-SALE-5). The customer, the agent and the warehouse are told; it can be undone. */
  async cancel(auth: AuthContext, id: string, reason: string, note?: string) {
    const r = await this.cancelTx(auth, id, reason, note);
    const [c] = r.order.customerId ? await this.db.select().from(customers).where(eq(customers.id, r.order.customerId)) : [];
    if (c) {
      const bg = c.proformaLanguage === 'bg';
      await this.mail.send({
        kind: 'order_cancelled',
        to: [c.invoiceEmail],
        cc: [await this.emailOf(r.order.agentId)],
        subject: bg ? `Поръчка ${r.order.number} е анулирана` : `Order ${r.order.number} is cancelled`,
        body: bg
          ? [`Здравейте, ${c.contactName},`, '', `Поръчка ${r.order.number} е анулирана.${note ? ` ${note}` : ''}`, 'Проформата към нея вече не е валидна.', '', 'ANANDA'].join('\n')
          : [`Hello ${c.contactName},`, '', `Order ${r.order.number} is cancelled.${note ? ` ${note}` : ''}`, 'Its proforma is no longer valid.', '', 'ANANDA'].join('\n'),
        recordType: 'order',
        recordId: id,
      });
    }
    return { ok: true };
  }

  private async cancelTx(auth: AuthContext, id: string, reason: string, note?: string) {
    return this.db.transaction(async (tx) => {
      const { order } = await this.load(auth, id, tx, true);
      if (!ORDER_PRE_SHIPPING.includes(order.status)) throw new ConflictException({ message: 'Orders can be cancelled only before shipping' });
      if (auth.perms.scope === 'own' && order.paidCents > 0) throw new ForbiddenException({ message: 'This order has a payment. Ask an admin to cancel it.' });
      await tx.update(orders).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, allocated: false, reservedUntil: null }).where(eq(orders.id, id));
      await tx.update(commissionEntries).set({ status: 'void' }).where(and(eq(commissionEntries.orderId, id), inArray(commissionEntries.status, ['coming', 'ready'])));
      await tx.update(approvalRequests).set({ status: 'withdrawn' }).where(and(eq(approvalRequests.orderId, id), eq(approvalRequests.status, 'pending')));
      await this.audit.log(auth, { category: 'orders', action: 'cancelled', recordType: 'order', recordId: id, recordLabel: order.number, changes: { status: { from: order.status, to: 'cancelled' } }, meta: { reason, note, paidCents: order.paidCents } }, tx);
      if (order.agentId !== auth.user.id) await this.notify.toUsers([order.agentId], { type: 'cancelled', title: `${order.number} was cancelled`, body: reason, link: `/sales/${id}` }, tx);
      await this.notify.toRoles(['warehouse'], { type: 'cancelled', title: `${order.number} was cancelled`, body: 'Nothing to ship for this order.', link: '/warehouse' }, tx);
      return { order };
    });
  }

  /** Undo a cancel: the order goes back to where its payment puts it, and stock is reserved again if it can be. */
  async uncancel(auth: AuthContext, id: string) {
    return this.db.transaction(async (tx) => {
      const { order, lines } = await this.load(auth, id, tx, true);
      if (order.status !== 'cancelled' || !order.requestSentAt) throw new ConflictException({ message: 'This order is not cancelled' });
      if (auth.perms.scope === 'own' && order.paidCents > 0) throw new ForbiddenException({ message: 'This order has a payment. Ask an admin to bring it back.' });
      const rules = await this.settings.rules(tx);
      const full = order.paidCents > 0 && order.paidCents >= order.totalCents - order.creditedCents;
      const allocated = await this.canReserve(tx, lines, id);
      const status: OrderStatus = full ? (allocated ? 'ready_to_send' : 'waiting_for_stock') : 'payment_to_confirm';
      await tx
        .update(orders)
        .set({ status, cancelledAt: null, cancelReason: null, allocated, reservedUntil: allocated && !full ? addDays(new Date(), rules.stockHoldDays) : null })
        .where(eq(orders.id, id));
      await tx.update(commissionEntries).set({ status: full ? 'ready' : 'coming' }).where(and(eq(commissionEntries.orderId, id), eq(commissionEntries.status, 'void')));
      await this.audit.log(auth, { category: 'orders', action: 'cancel_undone', recordType: 'order', recordId: id, recordLabel: order.number, changes: { status: { from: 'cancelled', to: status } } }, tx);
      if (order.agentId !== auth.user.id) await this.notify.toUsers([order.agentId], { type: 'cancel_undone', title: `${order.number} is open again`, body: 'The cancel was undone.', link: `/sales/${id}` }, tx);
      return { ok: true, status };
    });
  }

  // ---------- Uploads (agents, on their own orders) ----------

  async upload(auth: AuthContext, id: string, file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined, input: { kind: string; description?: string }) {
    if (!file) throw new BadRequestException({ message: 'Choose a file', fields: { file: 'Choose a file' } });
    if (!(ORDER_UPLOAD_KINDS as readonly string[]).includes(input.kind)) throw new BadRequestException({ message: 'Choose the type', fields: { kind: 'Choose the type' } });
    const description = input.description?.trim() || null;
    if (input.kind === 'other' && !description) throw new BadRequestException({ message: 'Say what it is', fields: { description: 'Say what it is, so the Admin knows where it belongs.' } });
    if (!this.files.isAllowed(file.mimetype) || !/\.(pdf|jpe?g|png|heic|heif|webp)$/i.test(file.originalname)) throw new BadRequestException({ message: 'Use a PDF, JPG, PNG or HEIC.', fields: { file: 'Use a PDF, JPG, PNG or HEIC.' } });
    if (file.size > ORDER_UPLOAD_MAX_BYTES) throw new BadRequestException({ message: 'The limit is 10 MB.', fields: { file: 'The limit is 10 MB.' } });
    const kind = input.kind as OrderUploadKind;
    const saved = await this.files.save(file);
    return this.db.transaction(async (tx) => {
      const { order } = await this.load(auth, id, tx, true);
      if (order.status === 'cancelled') throw new ConflictException({ message: 'This order is cancelled' });
      const [c] = order.customerId ? await tx.select({ name: customers.companyName }).from(customers).where(eq(customers.id, order.customerId)) : [];
      const [doc] = await tx
        .insert(documents)
        .values({ type: 'upload', orderId: id, customerId: order.customerId, label: UPLOAD_LABEL[kind], filePath: saved.path, fileName: saved.name, mimeType: saved.mime, data: { uploadKind: kind, description }, createdById: auth.user.id })
        .returning({ id: documents.id });
      await this.audit.log(auth, { category: 'documents', action: 'document_uploaded', recordType: 'order', recordId: id, recordLabel: order.number, meta: { documentId: doc.id, kind, description, fileName: saved.name } }, tx);
      // Every upload is told to the Admins. A proof of payment never confirms the payment: the bank does.
      const admins = (await this.notify.userIdsWithRoles(['system_admin', 'admin'], tx)).filter((u) => u !== auth.user.id);
      await this.notify.send('agent_upload', { users: admins }, { agent: auth.user.name, doc: kind === 'other' && description ? description : UPLOAD_DOC[kind], order: order.number, customer: c?.name ?? '' }, `/sales/${id}`, tx);
      return { id: doc.id };
    });
  }

  // ---------- Allocation (used by Inventory) ----------

  /** Waiting orders, oldest first, for the Allocate panel (FR-INV-3). */
  async waitingForStock() {
    const rows = await this.db
      .select({ id: orders.id, number: orders.number, paidAt: orders.paidAt, customerName: customers.companyName, agentId: orders.agentId })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orders.status, 'waiting_for_stock'))
      .orderBy(asc(orders.paidAt));
    const lines = rows.length ? await this.db.select().from(orderLines).where(inArray(orderLines.orderId, rows.map((r) => r.id))) : [];
    return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.orderId === r.id).map((l) => ({ flavour: l.flavour, cartons: l.cartons, units: l.units })) }));
  }

  async allocate(auth: AuthContext, orderIds: string[]) {
    return this.db.transaction(async (tx) => {
      const done: string[] = [];
      for (const id of orderIds) {
        const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
        if (!order || order.status !== 'waiting_for_stock') continue;
        const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, id));
        if (!(await this.canReserve(tx, lines, id))) throw new ConflictException({ message: `Not enough stock for ${order.number}. Untick it and try again.` });
        await tx.update(orders).set({ status: 'ready_to_send', allocated: true }).where(eq(orders.id, id));
        await this.audit.log(auth, { category: 'stock', action: 'allocated', recordType: 'order', recordId: id, recordLabel: order.number, changes: { status: { from: 'waiting_for_stock', to: 'ready_to_send' } } }, tx);
        await this.notify.toUsers([order.agentId], { type: 'allocated', title: `${order.number} has stock`, body: 'Paid · ready to send', link: `/sales/${id}` }, tx);
        done.push(order.number);
      }
      return { allocated: done };
    });
  }

  // ---------- Scheduled rules ----------

  /** A8: release the stock hold after N unpaid days and tell the agent; the order stays open. */
  async releaseExpiredHolds() {
    const now = new Date();
    const expired = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.status, 'payment_to_confirm'), eq(orders.allocated, true), isNotNull(orders.reservedUntil), lt(orders.reservedUntil, now)));
    for (const o of expired) {
      await this.db.transaction(async (tx) => {
        await tx.update(orders).set({ allocated: false, reservedUntil: null, holdReleasedAt: now }).where(eq(orders.id, o.id));
        await this.audit.log(null, { category: 'stock', action: 'stock_hold_released', recordType: 'order', recordId: o.id, recordLabel: o.number }, tx);
        await this.notify.toUsers([o.agentId], { type: 'hold_released', title: `Stock hold on ${o.number} released`, body: 'The payment did not arrive in time. The order stays open.', link: `/sales/${o.id}` }, tx);
      });
    }
    return expired.length;
  }

  /** A12: remind the agent when a proforma expires; the order stays open. */
  async remindExpiredProformas() {
    const now = new Date();
    const due = await this.db
      .select()
      .from(orders)
      .where(and(eq(orders.status, 'payment_to_confirm'), isNotNull(orders.paymentDueOn), lt(orders.proformaExpiresAt, now), sql`${orders.proformaReminderAt} is null`));
    for (const o of due) {
      await this.db.update(orders).set({ proformaReminderAt: now }).where(eq(orders.id, o.id));
      await this.notify.toUsers([o.agentId], { type: 'proforma_expired', title: `Proforma for ${o.number} expired`, body: 'Follow up with the customer.', link: `/sales/${o.id}` });
    }
    return due.length;
  }

  private async emailOf(userId: string) {
    const [u] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    return u?.email;
  }
}

const UPLOAD_LABEL: Record<OrderUploadKind, string> = {
  purchase_order: "Customer's purchase order",
  signed_order: 'Signed order or agreement',
  payment_proof: 'Proof of payment',
  delivery: 'Delivery photo or signed note',
  other: 'Something else',
};
/** Short name in the Admin's notification ("Ivan Kolev uploaded a purchase order"). */
const UPLOAD_DOC: Record<OrderUploadKind, string> = {
  purchase_order: 'Purchase order',
  signed_order: 'Signed order',
  payment_proof: 'Proof of payment',
  delivery: 'Delivery photo',
  other: 'Document',
};

export function lateDays(dueOn: string | null, outstandingCents: number, status: string, today: string): number {
  if (!dueOn || outstandingCents <= 0 || status === 'draft' || status === 'cancelled' || dueOn >= today) return 0;
  return Math.floor((new Date(today).getTime() - new Date(dueOn).getTime()) / 86_400_000);
}

function money(cents: number) {
  return `€${(cents / 100).toFixed(2)}`;
}

function paymentRequestBody(d: Awaited<ReturnType<DocumentsService['customerDocData']>>) {
  if (d.language === 'bg') {
    return [
      `Здравейте, ${d.customer.contactName},`,
      '',
      `Изпращаме проформа ${d.number} за поръчка ${d.orderNumber}.`,
      `Сума с ДДС: ${money(d.totalCents)}. Плащане до ${d.dueOn}.`,
      `IBAN ${d.bank.iban} · BIC ${d.bank.bic} · Основание: ${d.number}`,
      '',
      'Изпращаме стоката след получаване на пълното плащане.',
      '',
      d.company.name,
    ].join('\n');
  }
  return [
    `Hello ${d.customer.contactName},`,
    '',
    `Please find proforma ${d.number} for order ${d.orderNumber} attached.`,
    `Total incl. VAT: ${money(d.totalCents)}. Please pay by ${d.dueOn}.`,
    `IBAN ${d.bank.iban} · BIC ${d.bank.bic} · Reference: ${d.number}`,
    '',
    'We ship once the full payment has arrived.',
    '',
    d.company.name,
  ].join('\n');
}

function invoiceBody(d: Awaited<ReturnType<DocumentsService['customerDocData']>>, type: 'invoice' | 'credit_note') {
  const bg = d.language === 'bg';
  const what = type === 'invoice' ? (bg ? 'фактура' : 'invoice') : bg ? 'кредитно известие' : 'credit note';
  return bg
    ? [`Здравейте, ${d.customer.contactName},`, '', `Прилагаме ${what} ${d.number} за поръчка ${d.orderNumber}: ${money(d.totalCents)} с ДДС.`, '', d.company.name].join('\n')
    : [`Hello ${d.customer.contactName},`, '', `Please find ${what} ${d.number} for order ${d.orderNumber} attached: ${money(d.totalCents)} incl. VAT.`, '', d.company.name].join('\n');
}
