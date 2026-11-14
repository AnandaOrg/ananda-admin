import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { canView, isoDate, type Flavour } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { bankBalances, commissionEntries, customers, orderLines, orders, payables, purchases, roles, suppliers, users } from '../db/schema';
import { FiguresService, OWED_STATUSES, outstandingSql, periodOf, type Period } from '../core/figures.service';
import { asOfNow } from '../core/as-of';
import { StockService } from '../core/stock.service';
import { SettingsService } from '../core/settings.service';
import { agentFilter, orderScope } from '../core/scope';
import { ApprovalsService } from '../approvals/approvals.service';
import { can, type AuthContext } from '../common/context';

type Attention = {
  kind: string;
  count: number;
  cents?: number;
  oldestDays?: number;
  detail?: string | null;
  link: string;
  items?: unknown[];
  [k: string]: unknown;
};

const DAY = 86_400_000;
const daysSince = (d: string | Date | null) => (d ? Math.max(0, Math.floor((asOfNow().getTime() - new Date(d).getTime()) / DAY)) : 0);

/** Same period one year earlier, up to the same day (year to date compares with year to date). */
function lastYearToDate(p: Period, now = asOfNow()): Period {
  const end = new Date(Math.min(p.to.getTime(), new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()));
  return { from: new Date(p.from.getFullYear() - 1, p.from.getMonth(), p.from.getDate()), to: new Date(end.getFullYear() - 1, end.getMonth(), end.getDate()) };
}

/** Overview: what needs a decision first, the key figures and stock (FR-HOME-1..7). */
@Injectable()
export class HomeService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly figures: FiguresService,
    private readonly stock: StockService,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
  ) {}

  async get(auth: AuthContext) {
    const agentId = agentFilter(auth);
    const month = periodOf('this_month');
    const year = periodOf('this_year');
    const lastYearMonth = { from: new Date(month.from.getFullYear() - 1, month.from.getMonth(), 1), to: new Date(month.to.getFullYear() - 1, month.to.getMonth(), 1) };
    const [salesMonth, couldClose, owed, salesYear, salesLastYear, salesMonthLastYear] = await Promise.all([
      this.figures.netSales(month, agentId),
      this.figures.couldCloseWithDrafts(month, agentId),
      this.figures.owed(agentId),
      this.figures.netSales(year, agentId),
      this.figures.netSales(lastYearToDate(year), agentId),
      this.figures.netSales(lastYearMonth, agentId),
    ]);
    const showProfit = canView(auth.perms.areas, 'deal_profit');
    const profit = showProfit ? await this.figures.dealProfit(year, null) : null;
    const awaiting = showProfit ? await this.awaitingPayment(year) : 0;
    const commission = auth.perms.scope === 'own' ? await this.agentCommission(auth.user.id) : null;

    const [needsYourOk, attention, stock, onboarding, whatToDo] = await Promise.all([
      this.needsYourOk(auth),
      this.needsAttention(auth),
      canView(auth.perms.areas, 'inventory') || auth.perms.scope === 'own' ? this.stock.overview() : Promise.resolve(null),
      auth.perms.baseRole === 'system_admin' || auth.perms.baseRole === 'admin' ? this.onboarding() : Promise.resolve(null),
      this.whatToDo(auth),
    ]);

    return {
      today: isoDate(asOfNow()),
      tiles: {
        salesMonth: {
          cents: salesMonth.cents,
          couldCloseCents: couldClose.cents,
          couldCloseCount: couldClose.count,
          requestsCents: couldClose.requestsCents,
          draftsCents: couldClose.draftsCents,
          lastYearCents: salesMonthLastYear.cents,
        },
        owed: { cents: owed.totalCents, lateCents: owed.lateCents, lateCount: owed.lateCount, oldestLateDays: owed.oldestLateDays },
        salesYear: {
          cents: salesYear.cents,
          units: salesYear.units,
          deals: salesYear.count,
          lastYearCents: salesLastYear.cents,
          changePct: salesLastYear.cents > 0 ? Math.round(((salesYear.cents - salesLastYear.cents) / salesLastYear.cents) * 100) : null,
        },
        dealProfitYear: profit ? { cents: profit.profitCents, deals: profit.deals, awaitingPayment: awaiting } : null,
        commission,
      },
      whatToDo,
      needsYourOk,
      attention,
      stock: stock?.map((s) => ({
        flavour: s.flavour,
        available: s.available,
        reserved: s.reserved,
        onTheWay: s.onTheWay,
        nextArrivalOn: s.nextArrivalOn,
        status: s.runway.status,
        runsOutOn: s.runway.runsOutOn,
        monthsLeft: s.runway.monthsLeft,
      })),
      onboarding,
    };
  }

  /** Deals with a payment request out this year whose profit isn't counted yet (not paid in full). */
  private async awaitingPayment(year: Period) {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(isNotNull(orders.requestSentAt), gte(orders.requestSentAt, year.from), isNull(orders.paidAt), notInArray(orders.status, ['draft', 'cancelled'])));
    return Number(r.n);
  }

  private async agentCommission(agentId: string) {
    const [r] = await this.db
      .select({
        readyCents: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'ready'), 0)::int`,
        comingCents: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'coming'), 0)::int`,
      })
      .from(commissionEntries)
      .where(eq(commissionEntries.agentId, agentId));
    return r;
  }

  private async needsYourOk(auth: AuthContext) {
    const rows: Array<Record<string, unknown>> = [];
    if (can(auth, 'approve')) {
      const [pending, decided] = await Promise.all([this.approvals.pending(), this.approvals.recentlyDecided()]);
      // Decided ones keep their place (with Undo), so the list doesn't jump.
      for (const a of [...pending, ...decided].sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime())) {
        rows.push({
          kind: a.type,
          id: a.id,
          status: a.status,
          decidedAt: a.decidedAt,
          customerId: a.customerId,
          customerName: a.customerName,
          agentName: a.agentName,
          orderId: a.orderId,
          orderNumber: a.orderNumber,
          reason: a.reason,
          summary: a.summary,
          totalCents: a.orderTotalCents,
          createdAt: a.createdAt,
        });
      }
    }
    if (can(auth, 'confirm_payment')) {
      const pays = await this.db
        .select({ id: orders.id, number: orders.number, totalCents: orders.totalCents, paidCents: orders.paidCents, creditedCents: orders.creditedCents, customerName: customers.companyName, agentName: users.name, requestSentAt: orders.requestSentAt, paymentDueOn: orders.paymentDueOn })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .innerJoin(users, eq(users.id, orders.agentId))
        .where(eq(orders.status, 'payment_to_confirm'))
        .orderBy(asc(orders.requestSentAt));
      for (const p of pays) rows.push({ kind: 'payment', id: p.id, status: 'pending', orderId: p.id, orderNumber: p.number, customerName: p.customerName, agentName: p.agentName, totalCents: Math.max(0, p.totalCents - p.paidCents - p.creditedCents), createdAt: p.requestSentAt, paymentDueOn: p.paymentDueOn });
    }
    return rows;
  }

  private async needsAttention(auth: AuthContext) {
    const today = isoDate(asOfNow());
    const scope = orderScope(auth);
    const out: Attention[] = [];

    // Overdue invoices: oldest first, with what to call or remind about.
    const overdue = await this.db
      .select({ orderId: orders.id, number: orders.number, customerId: customers.id, customerName: customers.companyName, phone: customers.phone, agentName: users.name, dueOn: orders.paymentDueOn, outstandingCents: outstandingSql })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.agentId))
      .where(and(inArray(orders.status, [...OWED_STATUSES]), sql`${outstandingSql} > 0`, lt(orders.paymentDueOn, today), scope))
      .orderBy(asc(orders.paymentDueOn));
    if (overdue.length) {
      const owed = await this.figures.owed(agentFilter(auth));
      out.push({
        kind: 'overdue',
        count: overdue.length,
        cents: owed.lateCents,
        oldestDays: owed.oldestLateDays,
        link: '/collections?filter=late',
        items: overdue.map((o) => ({ ...o, outstandingCents: Number(o.outstandingCents), daysLate: daysSince(o.dueOn) })),
      });
    }

    // Delivered, no invoice yet: only fully paid orders can be invoiced.
    const delivered = await this.db
      .select({ orderId: orders.id, number: orders.number, customerName: customers.companyName, deliveredAt: orders.deliveredAt, paid: sql<boolean>`${orders.paidCents} >= ${orders.totalCents} - ${orders.creditedCents}` })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(inArray(orders.status, ['delivered', 'delivered_part']), scope))
      .orderBy(asc(orders.deliveredAt));
    if (delivered.length) {
      const paid = delivered.filter((d) => d.paid).length;
      out.push({ kind: 'delivered_not_invoiced', count: delivered.length, paidCount: paid, canIssue: can(auth, 'issue_invoices'), link: '/sales?filter=needs_action', items: delivered });
    }

    if (canView(auth.perms.areas, 'purchasing')) {
      const late = await this.db
        .select({ id: purchases.id, number: purchases.number, supplierName: suppliers.company, supplierEmail: suppliers.ordersEmail, orderedOn: purchases.orderedOn, expectedOn: purchases.expectedOn, units: purchases.totalUnits, cartons: purchases.totalCartons, status: purchases.status, goodsCents: purchases.goodsCents })
        .from(purchases)
        .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
        .where(and(inArray(purchases.status, ['ordered', 'on_the_way']), lt(purchases.expectedOn, today)))
        .orderBy(asc(purchases.expectedOn));
      if (late.length) {
        const ids = late.map((p) => p.id);
        const [pay, waiting] = await Promise.all([
          this.db
            .select({ purchaseId: payables.purchaseId, cents: sql<number>`coalesce(sum(${payables.amountCents} - ${payables.paidCents}), 0)::int` })
            .from(payables)
            .where(inArray(payables.purchaseId, ids))
            .groupBy(payables.purchaseId),
          this.db.select({ customerName: customers.companyName }).from(orders).leftJoin(customers, eq(customers.id, orders.customerId)).where(eq(orders.status, 'waiting_for_stock')).orderBy(asc(orders.paidAt)),
        ]);
        out.push({
          kind: 'late_purchases',
          count: late.length,
          oldestDays: daysSince(late[0].expectedOn),
          detail: late[0].number,
          link: `/purchasing/${late[0].id}`,
          items: late.map((p) => ({
            ...p,
            daysLate: daysSince(p.expectedOn),
            // Before the supplier invoice is booked, what's owed is the ordered goods.
            stillToPayCents: pay.find((x) => x.purchaseId === p.id)?.cents ?? p.goodsCents,
            waitingCustomers: waiting.map((w) => w.customerName).filter(Boolean),
          })),
        });
      }
    }

    if (canView(auth.perms.areas, 'inventory')) {
      const stock = await this.stock.overview();
      const reorder = stock.filter((s) => s.runway.status !== 'ok');
      if (reorder.length)
        out.push({
          kind: 'reorder',
          count: reorder.length,
          tone: reorder.some((s) => s.runway.status === 'reorder_now') ? 'bad' : 'warn',
          link: '/inventory',
          items: reorder.map((s) => ({ flavour: s.flavour, status: s.runway.status, monthsLeft: s.runway.monthsLeft, runsOutOn: s.runway.runsOutOn })),
        });
    }

    // Orders waiting for stock: Allocate opens once stock can cover at least one of them.
    const waiting = await this.db.select({ id: orders.id, number: orders.number }).from(orders).where(and(eq(orders.status, 'waiting_for_stock'), scope));
    if (waiting.length) {
      const [lines, available, [next]] = await Promise.all([
        this.db.select({ orderId: orderLines.orderId, flavour: orderLines.flavour, units: orderLines.units }).from(orderLines).where(inArray(orderLines.orderId, waiting.map((w) => w.id))),
        this.stock.available(),
        this.db
          .select({ id: purchases.id, number: purchases.number, status: purchases.status })
          .from(purchases)
          .where(inArray(purchases.status, ['ordered', 'on_the_way']))
          .orderBy(asc(purchases.expectedOn))
          .limit(1),
      ]);
      const canAllocate = waiting.some((w) => {
        const need = lines.filter((l) => l.orderId === w.id);
        return need.length > 0 && need.every((l) => available[l.flavour as Flavour] >= l.units);
      });
      out.push({
        kind: 'waiting_for_stock',
        count: waiting.length,
        canAllocate: canAllocate && canView(auth.perms.areas, 'inventory') && auth.perms.areas.inventory === 'edit',
        purchase: next ?? null,
        link: canView(auth.perms.areas, 'inventory') ? '/inventory' : '/sales?filter=needs_action',
      });
    }

    const toDeliver = await this.db
      .select({ id: orders.id, number: orders.number })
      .from(orders)
      .where(and(inArray(orders.status, ['ready_to_send', 'at_warehouse']), scope))
      .orderBy(asc(orders.number));
    if (toDeliver.length) out.push({ kind: 'to_deliver', count: toDeliver.length, numbers: toDeliver.map((o) => o.number), link: canView(auth.perms.areas, 'warehouse') ? '/warehouse' : '/sales?filter=needs_action' });

    const drafts = await this.db
      .select({ id: orders.id, cents: orders.netCents, createdAt: orders.createdAt, customerName: customers.companyName })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.status, 'draft'), scope))
      .orderBy(asc(orders.createdAt));
    if (drafts.length) out.push({ kind: 'drafts', count: drafts.length, cents: drafts.reduce((s, d) => s + d.cents, 0), oldest: { customerName: drafts[0].customerName, createdAt: drafts[0].createdAt }, link: '/sales?filter=drafts' });

    if (canView(auth.perms.areas, 'pnl')) {
      const [bal] = await this.db.select({ last: sql<string | null>`max(${bankBalances.balanceOn})::text` }).from(bankBalances);
      if (!bal.last || daysSince(bal.last) > 7) out.push({ kind: 'bank_balance', count: 1, detail: bal.last, daysOld: bal.last ? daysSince(bal.last) : null, canRecord: auth.perms.areas.pnl === 'edit' || auth.perms.areas.expenses === 'edit', link: '/money/pnl' });
    }
    return out;
  }

  /**
   * What to do (FR-HOME-2): sales this month against last year, and up to three next steps,
   * largest amount first: new customers to approve, drafts left unsent, customers due to reorder.
   */
  private async whatToDo(auth: AuthContext) {
    if (auth.perms.scope === 'shipping') return { lastSaleAt: null, steps: [] };
    const own = auth.perms.scope === 'own';
    const steps: Array<{ kind: string; cents: number; id: string; label: string; agentId?: string | null; agentName?: string | null; agentEmail?: string | null; since?: string | Date | null; number?: string; link: string }> = [];
    if (can(auth, 'approve')) {
      for (const a of await this.approvals.pending()) {
        if (a.type !== 'new_customer') continue;
        const [d] = await this.db.select({ cents: sql<number>`coalesce(sum(${orders.netCents}),0)::int` }).from(orders).where(and(eq(orders.customerId, a.customerId!), eq(orders.status, 'draft')));
        steps.push({ kind: 'approve_customer', cents: Number(d.cents), id: a.id, label: a.customerName ?? '', agentName: a.agentName, link: `/home?review=${a.id}` });
      }
    }
    const since = new Date(Date.now() - 2 * DAY);
    const drafts = await this.db
      .select({ id: orders.id, number: orders.number, cents: orders.netCents, createdAt: orders.createdAt, agentId: orders.agentId, agentName: users.name, agentEmail: users.email, customerName: customers.companyName })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.agentId))
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.status, 'draft'), lt(orders.createdAt, since), orderScope(auth)))
      .orderBy(desc(orders.netCents))
      .limit(5);
    for (const d of drafts) steps.push({ kind: own ? 'send_draft' : 'draft', cents: d.cents, id: d.id, number: d.number, label: d.customerName ?? d.number, agentId: d.agentId, agentName: d.agentName, agentEmail: d.agentEmail, since: d.createdAt, link: `/sales/${d.id}` });

    // Due to reorder: customers with at least two orders whose usual gap since the last one has passed.
    const due = await this.db.execute<{ id: string; name: string; agent_id: string | null; agent_name: string | null; agent_email: string | null; last: string; avg_cents: number }>(sql`
      with o as (
        select ${orders.customerId} as cid, ${orders.requestSentAt} as at, ${orders.netCents} as net
        from ${orders}
        where ${orders.requestSentAt} is not null and ${orders.status} not in ('draft','cancelled') ${own ? sql`and ${orders.agentId} = ${auth.user.id}` : sql``}
      ), s as (
        select cid, max(at) as last, count(*) as n, avg(net)::int as avg_cents,
               extract(epoch from (max(at) - min(at))) / nullif(count(*) - 1, 0) / 86400 as gap
        from o group by cid having count(*) >= 2
      )
      select c.id, c.company_name as name, c.agent_id, u.name as agent_name, u.email as agent_email, s.last::text as last, s.avg_cents
      from s join ${customers} c on c.id = s.cid left join ${users} u on u.id = c.agent_id
      where c.status = 'active' and s.gap is not null and s.last + make_interval(days => greatest(ceil(s.gap)::int, 14)) < now()
        and not exists (select 1 from ${orders} x where x.customer_id = c.id and x.status in ('draft','payment_to_confirm'))
      order by s.avg_cents desc limit 3`);
    for (const r of due.rows) steps.push({ kind: 'reorder', cents: Number(r.avg_cents), id: r.id, label: r.name, agentId: r.agent_id, agentName: r.agent_name, agentEmail: r.agent_email, since: r.last, link: `/customers/${r.id}` });

    const [last] = await this.db
      .select({ at: sql<string | null>`max(${orders.requestSentAt})::text` })
      .from(orders)
      .where(and(notInArray(orders.status, ['draft', 'cancelled']), orderScope(auth)));
    // Approvals first (only an Admin can unblock them), then the biggest money.
    const ordered = [...steps.filter((x) => x.kind === 'approve_customer'), ...steps.filter((x) => x.kind !== 'approve_customer').sort((a, b) => b.cents - a.cents)];
    return { lastSaleAt: last?.at ?? null, steps: ordered.slice(0, 3) };
  }

  /** Six steps that unlock in order for a new company (FR-HOME-7). */
  async onboarding() {
    const s = await this.settings.all();
    if (s.onboarding.dismissed) return null;
    const [[sup], [pur], [agents], [cust]] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(suppliers).where(eq(suppliers.status, 'approved')),
      this.db.select({ n: sql<number>`count(*)::int` }).from(purchases),
      this.db.select({ n: sql<number>`count(*)::int` }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(roles.baseRole, 'agent')),
      this.db.select({ n: sql<number>`count(*)::int` }).from(customers).where(eq(customers.status, 'active')),
    ]);
    const steps = [
      { key: 'company', done: !!(s.company.name && s.company.vatNumber), link: '/settings/company' },
      { key: 'bank', done: !!s.bank.iban, link: '/settings/bank' },
      { key: 'supplier', done: sup.n > 0, link: '/purchasing/suppliers?new=1' },
      { key: 'purchase', done: pur.n > 0, link: '/purchasing?new=1' },
      { key: 'agents', done: agents.n > 0, link: '/agents?invite=1' },
      { key: 'customer', done: cust.n > 0, link: '/customers?new=1' },
    ];
    if (steps.every((x) => x.done)) return null;
    const firstOpen = steps.findIndex((x) => !x.done);
    return steps.map((x, i) => ({ ...x, unlocked: i <= firstOpen }));
  }
}

