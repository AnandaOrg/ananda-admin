import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { FLAVOURS, isoDate, type ExpenseInput, type Flavour } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { bankBalances, customers, documents, expenses, orderLines, orders, users } from '../db/schema';
import { FiguresService, periodOf, type Period } from '../core/figures.service';
import { AuditService } from '../core/audit.service';
import { FilesService } from '../core/files.service';
import { SettingsService } from '../core/settings.service';
import type { AuthContext } from '../common/context';

export interface PeriodQuery {
  period?: string;
  from?: string;
  to?: string;
}

interface DealRow {
  id: string;
  kind: 'deal' | 'credit_note';
  orderId: string;
  number: string;
  documentNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  agentId: string;
  agentName: string;
  paidAt: string;
  units: number;
  netCents: number;
  purchaseCostCents: number;
  commissionCents: number;
  profitCents: number;
}

interface Group {
  key: string;
  name: string;
  deals: number;
  customers: number;
  units: number;
  netCents: number;
  purchaseCostCents: number;
  commissionCents: number;
  profitCents: number;
}

/** Splits an integer amount by weights so the parts always add up to the whole (largest remainder). */
function split(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!sum) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((r) => Math.trunc(r));
  let rest = total - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => ({ i, f: Math.abs(r - Math.trunc(r)) })).sort((a, b) => b.f - a.f);
  const step = rest >= 0 ? 1 : -1;
  for (let k = 0; rest !== 0 && order.length; k = (k + 1) % order.length) {
    out[order[k].i] += step;
    rest -= step;
  }
  return out;
}

/** Same cutoff as FiguresService: counted when paid in full, never for drafts or cancelled orders. */
const countedOrders = (p: Period): SQL => and(gte(orders.paidAt, p.from), lt(orders.paidAt, p.to), notInArray(orders.status, ['cancelled', 'draft']))!;
const creditNotesIn = (p: Period): SQL => and(eq(documents.type, 'credit_note'), gte(documents.createdAt, p.from), lt(documents.createdAt, p.to))!;

/**
 * Deal profit, monthly P&L, expenses and bank balances (FR-MON-1..4). Headline figures come from
 * FiguresService; the breakdowns below use the same rows and cutoffs, so they add up to it.
 */
@Injectable()
export class MoneyService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly figures: FiguresService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
  ) {}

  period(q: PeriodQuery): Period {
    return periodOf(q.period, q.from, q.to);
  }

  // ---------- Deal profit (FR-MON-1) ----------

  private async dealRows(p: Period): Promise<{ rows: DealRow[]; lines: Map<string, { flavour: Flavour; units: number }[]>; creditLines: Map<string, { flavour: Flavour; units: number }[]> }> {
    const paid = await this.db
      .select({
        id: orders.id,
        number: orders.number,
        customerId: orders.customerId,
        customerName: customers.companyName,
        agentId: orders.agentId,
        agentName: users.name,
        paidAt: orders.paidAt,
        units: orders.totalUnits,
        netCents: orders.netCents,
        purchaseCostCents: orders.purchaseCostCents,
        commissionCents: orders.commissionCents,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.agentId))
      .where(countedOrders(p))
      .orderBy(desc(orders.paidAt));
    const credits = await this.db
      .select({
        id: documents.id,
        number: documents.number,
        data: documents.data,
        createdAt: documents.createdAt,
        orderId: orders.id,
        orderNumber: orders.number,
        customerId: orders.customerId,
        customerName: customers.companyName,
        agentId: orders.agentId,
        agentName: users.name,
      })
      .from(documents)
      .innerJoin(orders, eq(orders.id, documents.orderId))
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.agentId))
      .where(creditNotesIn(p))
      .orderBy(desc(documents.createdAt));

    const rows: DealRow[] = paid.map((o) => {
      const cost = o.purchaseCostCents ?? 0;
      return {
        id: o.id,
        kind: 'deal',
        orderId: o.id,
        number: o.number,
        documentNumber: null,
        customerId: o.customerId,
        customerName: o.customerName,
        agentId: o.agentId,
        agentName: o.agentName,
        paidAt: (o.paidAt as Date).toISOString(),
        units: o.units,
        netCents: o.netCents,
        purchaseCostCents: cost,
        commissionCents: o.commissionCents,
        profitCents: o.netCents - cost - o.commissionCents,
      };
    });
    const creditLines = new Map<string, { flavour: Flavour; units: number }[]>();
    for (const c of credits) {
      const d = c.data as { netCents?: number; costCents?: number; commissionCents?: number; units?: number; lines?: { flavour: Flavour; units: number }[] };
      const net = -Number(d.netCents ?? 0);
      const cost = -Number(d.costCents ?? 0);
      const com = -Number(d.commissionCents ?? 0);
      creditLines.set(c.id, (d.lines ?? []).map((l) => ({ flavour: l.flavour, units: Number(l.units) })));
      rows.push({
        id: c.id,
        kind: 'credit_note',
        orderId: c.orderId,
        number: c.orderNumber,
        documentNumber: c.number,
        customerId: c.customerId,
        customerName: c.customerName,
        agentId: c.agentId,
        agentName: c.agentName,
        paidAt: c.createdAt.toISOString(),
        units: -Number(d.units ?? 0),
        netCents: net,
        purchaseCostCents: cost,
        commissionCents: com,
        profitCents: net - cost - com,
      });
    }
    rows.sort((a, b) => b.paidAt.localeCompare(a.paidAt));

    const ids = paid.map((o) => o.id);
    const lineRows = ids.length ? await this.db.select({ orderId: orderLines.orderId, flavour: orderLines.flavour, units: orderLines.units }).from(orderLines).where(inArray(orderLines.orderId, ids)) : [];
    const lines = new Map<string, { flavour: Flavour; units: number }[]>();
    for (const l of lineRows) lines.set(l.orderId, [...(lines.get(l.orderId) ?? []), { flavour: l.flavour, units: l.units }]);
    return { rows, lines, creditLines };
  }

  async dealProfit(q: PeriodQuery) {
    const p = this.period(q);
    const [summary, data] = await Promise.all([this.figures.dealProfit(p, null), this.dealRows(p)]);
    const { rows, lines, creditLines } = data;

    const group = (keyOf: (r: DealRow) => string, nameOf: (r: DealRow) => string): Group[] => {
      const m = new Map<string, Group & { cust: Set<string> }>();
      for (const r of rows) {
        const k = keyOf(r);
        const g = m.get(k) ?? { key: k, name: nameOf(r), deals: 0, customers: 0, units: 0, netCents: 0, purchaseCostCents: 0, commissionCents: 0, profitCents: 0, cust: new Set<string>() };
        if (r.kind === 'deal') g.deals += 1;
        if (r.customerId) g.cust.add(r.customerId);
        g.units += r.units;
        g.netCents += r.netCents;
        g.purchaseCostCents += r.purchaseCostCents;
        g.commissionCents += r.commissionCents;
        g.profitCents += r.profitCents;
        m.set(k, g);
      }
      return [...m.values()].map(({ cust, ...g }) => ({ ...g, customers: cust.size })).sort((a, b) => b.profitCents - a.profitCents);
    };

    const byFlavour = new Map<Flavour, Group>(FLAVOURS.map((f) => [f, { key: f, name: f, deals: 0, customers: 0, units: 0, netCents: 0, purchaseCostCents: 0, commissionCents: 0, profitCents: 0 }]));
    for (const r of rows) {
      const ls = (r.kind === 'deal' ? lines.get(r.id) : creditLines.get(r.id)) ?? [];
      if (!ls.length) continue;
      const w = ls.map((l) => Math.abs(l.units));
      const net = split(r.netCents, w);
      const cost = split(r.purchaseCostCents, w);
      const com = split(r.commissionCents, w);
      ls.forEach((l, i) => {
        const g = byFlavour.get(l.flavour)!;
        if (r.kind === 'deal') g.deals += 1;
        g.units += r.kind === 'deal' ? l.units : -Math.abs(l.units);
        g.netCents += net[i];
        g.purchaseCostCents += cost[i];
        g.commissionCents += com[i];
        g.profitCents += net[i] - cost[i] - com[i];
      });
    }

    return {
      period: { from: isoDate(p.from), to: isoDate(new Date(p.to.getTime() - 86_400_000)) },
      summary: { ...summary, costPerUnitCents: summary.units ? Math.round(summary.purchaseCostCents / summary.units) : 0 },
      deals: rows,
      byCustomer: group(
        (r) => r.customerId ?? 'none',
        (r) => r.customerName ?? '',
      ),
      byAgent: group(
        (r) => r.agentId,
        (r) => r.agentName,
      ),
      byFlavour: [...byFlavour.values()],
    };
  }

  // ---------- Monthly P&L (FR-MON-2) ----------

  /** Expenses excl. VAT in a period: the one figure used on P&L and Expenses. */
  async expensesNet(p: Period): Promise<number> {
    const [r] = await this.db
      .select({ cents: sql<number>`coalesce(sum(${expenses.netCents}), 0)::int` })
      .from(expenses)
      .where(and(gte(expenses.spentOn, isoDate(p.from)), lt(expenses.spentOn, isoDate(p.to))));
    return Number(r.cents);
  }

  async pnl(q: PeriodQuery) {
    const p = this.period(q);
    const now = new Date();
    const months: Period[] = [];
    for (let d = new Date(p.from.getFullYear(), p.from.getMonth(), 1); d < p.to && d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      months.push({ from: d < p.from ? p.from : d, to: end > p.to ? p.to : end });
    }
    const rows = await Promise.all(
      months.map(async (m) => {
        const [dp, exp] = await Promise.all([this.figures.dealProfit(m, null), this.expensesNet(m)]);
        return {
          month: isoDate(new Date(m.from.getFullYear(), m.from.getMonth(), 1)),
          netCents: dp.netCents,
          purchaseCostCents: dp.purchaseCostCents,
          commissionCents: dp.commissionCents,
          dealProfitCents: dp.profitCents,
          expensesCents: exp,
          operatingProfitCents: dp.profitCents - exp,
          deals: dp.deals,
          hasData: dp.deals > 0 || dp.netCents !== 0 || exp !== 0,
        };
      }),
    );
    const [dp, exp, cash] = await Promise.all([this.figures.dealProfit(p, null), this.expensesNet(p), this.cashOnHand()]);
    return {
      period: { from: isoDate(p.from), to: isoDate(new Date(p.to.getTime() - 86_400_000)) },
      totals: {
        netCents: dp.netCents,
        purchaseCostCents: dp.purchaseCostCents,
        commissionCents: dp.commissionCents,
        dealProfitCents: dp.profitCents,
        expensesCents: exp,
        operatingProfitCents: dp.profitCents - exp,
        deals: dp.deals,
      },
      months: rows.reverse(),
      cash,
    };
  }

  // ---------- Bank balance (FR-MON-4) ----------

  /** Cash on hand = the latest recorded balance of each account. */
  async cashOnHand() {
    const bank = await this.settings.get('bank');
    const latest = await this.db.execute<{ account: string; balance_on: string; balance_cents: number }>(sql`
      SELECT DISTINCT ON (account) account, balance_on::text AS balance_on, balance_cents
      FROM bank_balances ORDER BY account, balance_on DESC, created_at DESC`);
    const accounts = latest.rows.map((r) => ({ account: r.account, balanceOn: r.balance_on, balanceCents: Number(r.balance_cents) }));
    const asOf = accounts.reduce<string | null>((m, a) => (!m || a.balanceOn < m ? a.balanceOn : m), null);
    const daysOld = asOf ? Math.max(0, Math.floor((Date.now() - new Date(asOf).getTime()) / 86_400_000)) : null;
    return {
      cents: accounts.reduce((s, a) => s + a.balanceCents, 0),
      asOf,
      daysOld,
      accounts,
      accountOptions: [...new Set([...bank.accounts, ...accounts.map((a) => a.account)])],
    };
  }

  async bankHistory() {
    const rows = await this.db
      .select({ id: bankBalances.id, account: bankBalances.account, balanceOn: bankBalances.balanceOn, balanceCents: bankBalances.balanceCents, recordedBy: users.name, createdAt: bankBalances.createdAt })
      .from(bankBalances)
      .leftJoin(users, eq(users.id, bankBalances.recordedById))
      .orderBy(desc(bankBalances.balanceOn), desc(bankBalances.createdAt))
      .limit(20);
    return { items: rows, cash: await this.cashOnHand() };
  }

  async recordBalance(auth: AuthContext, input: { account: string; balanceOn: string; balanceCents: number }) {
    if (input.balanceOn > isoDate()) throw new BadRequestException({ message: 'Check the highlighted fields', fields: { balanceOn: 'Pick today or an earlier date' } });
    return this.db.transaction(async (tx) => {
      const [prev] = await tx
        .select()
        .from(bankBalances)
        .where(eq(bankBalances.account, input.account))
        .orderBy(desc(bankBalances.balanceOn), desc(bankBalances.createdAt))
        .limit(1)
        .for('update');
      const [row] = await tx.insert(bankBalances).values({ ...input, recordedById: auth.user.id }).returning();
      await this.audit.log(
        auth,
        {
          category: 'payments',
          action: 'bank_balance_recorded',
          recordType: 'bank_balance',
          recordId: row.id,
          recordLabel: `${input.account} · ${input.balanceOn}`,
          money: true,
          changes: { balanceCents: { from: prev?.balanceCents ?? null, to: input.balanceCents } },
        },
        tx,
      );
      return { id: row.id };
    });
  }

  // ---------- Expenses (FR-MON-3) ----------

  async expenseTiles() {
    const year = periodOf('this_year');
    const month = periodOf('this_month');
    const [y, m, [unpaid]] = await Promise.all([
      this.expensesNet(year),
      this.expensesNet(month),
      this.db.select({ cents: sql<number>`coalesce(sum(${expenses.totalCents}), 0)::int`, count: sql<number>`count(*)::int` }).from(expenses).where(eq(expenses.paid, false)),
    ]);
    return { yearCents: y, monthCents: m, unpaidCents: Number(unpaid.cents), unpaidCount: Number(unpaid.count) };
  }

  async listExpenses(q: PeriodQuery & { category?: string; q?: string; status?: string }) {
    const p = q.period && q.period !== 'any' ? this.period(q) : null;
    const where = and(
      p ? and(gte(expenses.spentOn, isoDate(p.from)), lt(expenses.spentOn, isoDate(p.to))) : undefined,
      q.category ? eq(expenses.category, q.category) : undefined,
      q.status === 'unpaid' ? eq(expenses.paid, false) : q.status === 'paid' ? eq(expenses.paid, true) : undefined,
      q.q ? or(ilike(expenses.description, `%${q.q}%`), ilike(expenses.category, `%${q.q}%`)) : undefined,
    );
    const items = await this.db
      .select({
        id: expenses.id,
        spentOn: expenses.spentOn,
        category: expenses.category,
        description: expenses.description,
        netCents: expenses.netCents,
        vatRate: expenses.vatRate,
        totalCents: expenses.totalCents,
        paid: expenses.paid,
        eventId: expenses.eventId,
        receiptDocumentId: expenses.receiptDocumentId,
        createdBy: users.name,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .leftJoin(users, eq(users.id, expenses.createdById))
      .where(where)
      .orderBy(desc(expenses.spentOn), desc(expenses.createdAt));
    return { items, tiles: await this.expenseTiles() };
  }

  async createExpense(auth: AuthContext, input: ExpenseInput, file?: { buffer: Buffer; originalname: string; mimetype: string }) {
    if (file && !this.files.isAllowed(file.mimetype)) throw new BadRequestException({ message: 'Upload a photo (JPG, PNG, HEIC) or a PDF', fields: { receipt: 'Upload a photo or a PDF' } });
    const saved = file ? await this.files.save(file) : null;
    const totalCents = input.amountNetCents + Math.round(input.amountNetCents * input.vatRate);
    return this.db.transaction(async (tx) => {
      let receiptDocumentId: string | null = null;
      if (saved) {
        const [doc] = await tx.insert(documents).values({ type: 'upload', label: 'Expense receipt', filePath: saved.path, fileName: saved.name, mimeType: saved.mime, data: { kind: 'expense_receipt' }, createdById: auth.user.id }).returning();
        receiptDocumentId = doc.id;
      }
      const [row] = await tx
        .insert(expenses)
        .values({ spentOn: input.spentOn, category: input.category, description: input.description, netCents: input.amountNetCents, vatRate: input.vatRate, totalCents, paid: input.paid, eventId: input.eventId ?? null, receiptDocumentId, createdById: auth.user.id })
        .returning();
      await this.audit.log(
        auth,
        {
          category: 'expenses',
          action: 'expense_added',
          recordType: 'expense',
          recordId: row.id,
          recordLabel: input.description,
          money: true,
          changes: { netCents: { from: null, to: row.netCents }, totalCents: { from: null, to: row.totalCents } },
          meta: { category: input.category, spentOn: input.spentOn, receipt: !!receiptDocumentId },
        },
        tx,
      );
      return { id: row.id };
    });
  }

  async markPaid(auth: AuthContext, id: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update');
      if (!row) throw new NotFoundException({ message: 'Expense not found' });
      if (row.paid) throw new ConflictException({ message: 'This expense is already paid' });
      await tx.update(expenses).set({ paid: true }).where(eq(expenses.id, id));
      await this.audit.log(auth, { category: 'expenses', action: 'expense_paid', recordType: 'expense', recordId: id, recordLabel: row.description, money: true, changes: { paid: { from: false, to: true } }, meta: { totalCents: row.totalCents } }, tx);
      return { ok: true };
    });
  }

  async expenseCategories() {
    const rows = await this.db.selectDistinct({ category: expenses.category }).from(expenses).orderBy(asc(expenses.category));
    return rows.map((r) => r.category);
  }
}
