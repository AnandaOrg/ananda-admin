import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { canView, isoDate } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import {
  bankBalances,
  commissionEntries,
  customers,
  orders,
  purchases,
  roles,
  stockCounts,
  supplierMessages,
  suppliers,
  users,
} from '../db/schema';
import { FiguresService, periodOf } from '../core/figures.service';
import { StockService } from '../core/stock.service';
import { SettingsService } from '../core/settings.service';
import { agentFilter, orderScope } from '../core/scope';
import { ApprovalsService } from '../approvals/approvals.service';
import { can, type AuthContext } from '../common/context';

/** Home: what needs a decision first, the key figures and stock (FR-HOME-1..7). */
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
    const [salesMonth, couldClose, owed, salesYear] = await Promise.all([
      this.figures.netSales(month, agentId),
      this.figures.couldClose(month, agentId),
      this.figures.owed(agentId),
      this.figures.netSales(year, agentId),
    ]);
    const showProfit = canView(auth.perms.areas, 'deal_profit');
    const profit = showProfit ? await this.figures.dealProfit(year, null) : null;
    const commission = auth.perms.scope === 'own' ? await this.agentCommission(auth.user.id) : null;

    const [needsYourOk, attention, stock, onboarding, whatToDo] = await Promise.all([
      this.needsYourOk(auth),
      this.needsAttention(auth),
      canView(auth.perms.areas, 'inventory') || auth.perms.scope === 'own' ? this.stock.overview() : Promise.resolve(null),
      auth.perms.baseRole === 'system_admin' || auth.perms.baseRole === 'admin' ? this.onboarding() : Promise.resolve(null),
      this.whatToDo(auth),
    ]);

    return {
      tiles: {
        salesMonth: { cents: salesMonth.cents, couldCloseCents: Number(couldClose.cents), couldCloseCount: Number(couldClose.count) },
        owed: { cents: owed.totalCents, lateCents: owed.lateCents, lateCount: owed.lateCount, oldestLateDays: owed.oldestLateDays },
        salesYear: { cents: salesYear.cents, units: salesYear.units, deals: salesYear.count },
        dealProfitYear: profit ? { cents: profit.profitCents, deals: profit.deals } : null,
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
      })),
      onboarding,
    };
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
      for (const a of await this.approvals.pending()) {
        rows.push({ kind: a.type, id: a.id, customerName: a.customerName, agentName: a.agentName, orderId: a.orderId, orderNumber: a.orderNumber, reason: a.reason, payload: a.payload, totalCents: a.orderTotalCents, createdAt: a.createdAt });
      }
    }
    if (can(auth, 'confirm_payment')) {
      const pays = await this.db
        .select({ id: orders.id, number: orders.number, totalCents: orders.totalCents, paidCents: orders.paidCents, customerName: customers.companyName, agentName: users.name, requestSentAt: orders.requestSentAt, paymentDueOn: orders.paymentDueOn })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .innerJoin(users, eq(users.id, orders.agentId))
        .where(eq(orders.status, 'payment_to_confirm'))
        .orderBy(asc(orders.requestSentAt));
      for (const p of pays) rows.push({ kind: 'payment', id: p.id, orderId: p.id, orderNumber: p.number, customerName: p.customerName, agentName: p.agentName, totalCents: p.totalCents - p.paidCents, createdAt: p.requestSentAt, paymentDueOn: p.paymentDueOn });
    }
    return rows;
  }

  private async needsAttention(auth: AuthContext) {
    const today = isoDate();
    const scope = orderScope(auth);
    const out: Array<{ kind: string; count: number; cents?: number; oldestDays?: number; detail?: string; link: string; action?: string }> = [];
    const owed = await this.figures.owed(agentFilter(auth));
    if (owed.lateCount > 0) out.push({ kind: 'overdue', count: owed.lateCount, cents: owed.lateCents, oldestDays: owed.oldestLateDays, link: '/collections?filter=late' });

    const [delivered] = await this.db
      .select({ count: sql<number>`count(*)::int`, paid: sql<number>`count(*) filter (where ${orders.paidCents} >= ${orders.totalCents} - ${orders.creditedCents})::int`, cents: sql<number>`coalesce(sum(${orders.totalCents}),0)::int` })
      .from(orders)
      .where(and(inArray(orders.status, ['delivered', 'delivered_part']), scope));
    if (delivered.count > 0) out.push({ kind: 'delivered_not_invoiced', count: delivered.count, cents: delivered.cents, link: '/sales?filter=needs_action', action: can(auth, 'issue_invoices') && delivered.paid > 0 ? `issue_all:${delivered.paid}` : undefined });

    if (canView(auth.perms.areas, 'purchasing')) {
      const [late] = await this.db.select({ count: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${purchases.expectedOn})::text` }).from(purchases).where(and(inArray(purchases.status, ['ordered', 'on_the_way']), lt(purchases.expectedOn, today)));
      if (late.count > 0) out.push({ kind: 'late_purchases', count: late.count, oldestDays: daysSince(late.oldest), link: '/purchasing?filter=late' });
      const [followUps] = await this.db.select({ count: sql<number>`count(*)::int` }).from(supplierMessages).where(and(lte(supplierMessages.followUpOn, today), isNull(supplierMessages.resolvedAt)));
      if (followUps.count > 0) out.push({ kind: 'supplier_follow_up', count: followUps.count, link: '/purchasing' });
    }
    if (canView(auth.perms.areas, 'inventory')) {
      const stock = await this.stock.overview();
      const reorder = stock.filter((s) => s.runway.status !== 'ok');
      if (reorder.length) out.push({ kind: 'reorder', count: reorder.length, detail: reorder.map((s) => s.flavour).join(','), link: '/inventory' });
      const [counts] = await this.db.select({ count: sql<number>`count(*)::int` }).from(stockCounts).where(isNull(stockCounts.reconciledAt));
      if (counts.count > 0) out.push({ kind: 'stock_count', count: counts.count, link: '/inventory?tab=counts' });
    }
    const [waiting] = await this.db.select({ count: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.status, 'waiting_for_stock'), scope));
    if (waiting.count > 0) out.push({ kind: 'waiting_for_stock', count: waiting.count, link: canView(auth.perms.areas, 'inventory') ? '/inventory?allocate=1' : '/sales?filter=needs_action' });
    const [toDeliver] = await this.db.select({ count: sql<number>`count(*)::int` }).from(orders).where(and(inArray(orders.status, ['ready_to_send', 'at_warehouse']), scope));
    if (toDeliver.count > 0) out.push({ kind: 'to_deliver', count: toDeliver.count, link: canView(auth.perms.areas, 'warehouse') ? '/warehouse' : '/sales?filter=needs_action' });
    const [drafts] = await this.db.select({ count: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${orders.netCents}),0)::int` }).from(orders).where(and(eq(orders.status, 'draft'), scope));
    if (drafts.count > 0) out.push({ kind: 'drafts', count: drafts.count, cents: drafts.cents, link: '/sales?filter=drafts' });
    if (canView(auth.perms.areas, 'pnl')) {
      const [bal] = await this.db.select({ last: sql<string | null>`max(${bankBalances.balanceOn})::text` }).from(bankBalances);
      if (!bal.last || daysSince(bal.last) > 7) out.push({ kind: 'bank_balance', count: 1, detail: bal.last ?? undefined, link: '/money/pnl?bank=1' });
    }
    return out;
  }

  /** Up to three next steps, largest amount first (FR-HOME-2). */
  private async whatToDo(auth: AuthContext) {
    if (auth.perms.scope === 'shipping') return [];
    const steps: Array<{ kind: string; cents: number; label: string; id: string; agentId?: string; agentName?: string; link: string }> = [];
    if (can(auth, 'approve')) {
      for (const a of await this.approvals.pending()) {
        if (a.type !== 'new_customer') continue;
        const [d] = await this.db.select({ cents: sql<number>`coalesce(sum(${orders.netCents}),0)::int` }).from(orders).where(and(eq(orders.customerId, a.customerId!), eq(orders.status, 'draft')));
        steps.push({ kind: 'approve_customer', cents: Number(d.cents), label: a.customerName ?? '', id: a.id, agentName: a.agentName, link: `/home?review=${a.id}` });
      }
    }
    const since = new Date(Date.now() - 2 * 86_400_000);
    const drafts = await this.db
      .select({ id: orders.id, number: orders.number, cents: orders.netCents, agentId: orders.agentId, agentName: users.name, customerName: customers.companyName })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.agentId))
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.status, 'draft'), lt(orders.createdAt, since), orderScope(auth)))
      .orderBy(desc(orders.netCents))
      .limit(5);
    for (const d of drafts) steps.push({ kind: auth.perms.scope === 'own' ? 'send_draft' : 'email_agent_draft', cents: d.cents, label: `${d.number}${d.customerName ? ` · ${d.customerName}` : ''}`, id: d.id, agentId: d.agentId, agentName: d.agentName, link: `/sales/${d.id}` });
    return steps.sort((a, b) => b.cents - a.cents).slice(0, 3);
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

function daysSince(d: string | null): number {
  if (!d) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));
}
