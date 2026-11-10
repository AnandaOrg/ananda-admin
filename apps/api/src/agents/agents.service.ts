import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { VAT_RATE, isoDate, vatOf } from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { agentNudges, commissionEntries, customers, events, orders, roles, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { MailService } from '../core/mail.service';
import { SettingsService } from '../core/settings.service';
import { agentFilter } from '../core/scope';
import type { AuthContext } from '../common/context';

function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
function dayStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
const euros = (cents: number) => `€${(cents / 100).toFixed(2)}`;

/** Orders that count as a sale: the payment request went out and the order was not cancelled. */
const SOLD = sql`${orders.requestSentAt} is not null and ${orders.status} <> 'cancelled'`;

/**
 * Agents & commissions (PRD §5.8). Commission figures have one definition here, shared by the
 * admin view and the agent's own view: Ready to pay = entries on fully paid orders not yet sent
 * (credit-note offsets, which are negative, included — A5); Coming = entries on orders not yet
 * fully paid; Sent to pay = sent to the accountant, waiting to be marked paid (A4).
 */
@Injectable()
export class AgentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
  ) {}

  private totalsSql() {
    return {
      readyCents: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'ready'), 0)::int`,
      comingCents: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'coming'), 0)::int`,
      sentCents: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'sent'), 0)::int`,
      paidThisYearCents: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'paid' and ${commissionEntries.paidAt} >= ${new Date(new Date().getFullYear(), 0, 1)}), 0)::int`,
    };
  }

  private async agentUsers() {
    return this.db
      .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, status: users.status, language: users.language, createdAt: users.createdAt })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(roles.baseRole, 'agent'), notInArray(users.status, ['deactivated'])))
      .orderBy(asc(users.name));
  }

  /** Admin and Finance view (FR-AGT-1 … FR-AGT-3). */
  async overview() {
    const since = monthStart();
    const today = dayStart();
    const people = await this.agentUsers();
    const ids = people.map((p) => p.id);
    const none = ids.length === 0;
    const [money, custs, sold, nudges, [newCustomers]] = await Promise.all([
      none ? [] : this.db.select({ agentId: commissionEntries.agentId, ...this.totalsSql() }).from(commissionEntries).where(inArray(commissionEntries.agentId, ids)).groupBy(commissionEntries.agentId),
      none
        ? []
        : this.db
            .select({ agentId: customers.agentId, n: sql<number>`count(*)::int` })
            .from(customers)
            .where(and(inArray(customers.agentId, ids), eq(customers.status, 'active')))
            .groupBy(customers.agentId),
      none
        ? []
        : this.db
            .select({
              agentId: orders.agentId,
              month: sql<number>`count(*) filter (where ${orders.requestSentAt} >= ${since})::int`,
              last: sql<string | null>`max(${orders.requestSentAt})`,
            })
            .from(orders)
            .where(and(inArray(orders.agentId, ids), SOLD))
            .groupBy(orders.agentId),
      none ? [] : this.db.select({ agentId: agentNudges.agentId, last: sql<string>`max(${agentNudges.createdAt})` }).from(agentNudges).where(inArray(agentNudges.agentId, ids)).groupBy(agentNudges.agentId),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(customers)
        .where(and(isNotNull(customers.approvedAt), gte(customers.approvedAt, since), inArray(customers.status, ['active', 'archived']))),
    ]);
    const agents = people.map((p) => {
      const m = money.find((x) => x.agentId === p.id);
      const s = sold.find((x) => x.agentId === p.id);
      const lastNudge = nudges.find((x) => x.agentId === p.id)?.last ?? null;
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        status: p.status,
        language: p.language,
        customers: Number(custs.find((x) => x.agentId === p.id)?.n ?? 0),
        ordersThisMonth: Number(s?.month ?? 0),
        lastOrderAt: s?.last ? new Date(s.last).toISOString() : null,
        readyCents: Number(m?.readyCents ?? 0),
        comingCents: Number(m?.comingCents ?? 0),
        sentCents: Number(m?.sentCents ?? 0),
        paidThisYearCents: Number(m?.paidThisYearCents ?? 0),
        lastNudgedAt: lastNudge ? new Date(lastNudge).toISOString() : null,
        nudgedToday: !!lastNudge && new Date(lastNudge) >= today,
      };
    });
    const active = agents.filter((a) => a.status === 'active');
    const didntSell = active.filter((a) => a.ordersThisMonth === 0);
    const rules = await this.settings.rules();
    const security = await this.settings.get('security');
    return {
      tiles: {
        readyCents: agents.reduce((s, a) => s + a.readyCents, 0),
        readyAgents: agents.filter((a) => a.readyCents > 0).length,
        comingCents: agents.reduce((s, a) => s + a.comingCents, 0),
        sentCents: agents.reduce((s, a) => s + a.sentCents, 0),
        didntSell: didntSell.length,
        activeAgents: active.length,
        newCustomersThisMonth: Number(newCustomers.n),
      },
      didntSellIds: didntSell.map((a) => a.id),
      agents,
      terms: { commissionPerUnitCents: rules.commissionPerUnitCents, vatRate: VAT_RATE, inviteValidityDays: security.inviteValidityDays },
      accountingEmail: (await this.settings.get('email')).accounting || null,
    };
  }

  private async assertAgent(id: string, tx: Db | Tx = this.db, lock = false) {
    const q = tx
      .select({ id: users.id, name: users.name, email: users.email, status: users.status })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, id), eq(roles.baseRole, 'agent')));
    const [agent] = lock ? await q.for('update', { of: users }) : await q;
    if (!agent) throw new NotFoundException({ message: 'Agent not found' });
    return agent;
  }

  /** The agent's own earnings (FR-AGT-5), or one agent's for an Admin. Agents see only their own. */
  async earnings(auth: AuthContext, agentId: string) {
    const own = agentFilter(auth);
    if (own && own !== agentId) throw new NotFoundException({ message: 'Agent not found' });
    const agent = await this.assertAgent(agentId);
    const [[totals], entries] = await Promise.all([
      this.db.select(this.totalsSql()).from(commissionEntries).where(eq(commissionEntries.agentId, agentId)),
      this.db
        .select({
          id: commissionEntries.id,
          orderId: commissionEntries.orderId,
          orderNumber: orders.number,
          customerName: customers.companyName,
          eventId: commissionEntries.eventId,
          eventName: events.name,
          units: commissionEntries.units,
          amountCents: commissionEntries.amountCents,
          status: commissionEntries.status,
          note: commissionEntries.note,
          createdAt: commissionEntries.createdAt,
          readyAt: commissionEntries.readyAt,
          sentAt: commissionEntries.sentAt,
          paidAt: commissionEntries.paidAt,
        })
        .from(commissionEntries)
        // Event sales (A13) have no order: they carry the event instead.
        .leftJoin(orders, eq(orders.id, commissionEntries.orderId))
        .leftJoin(customers, eq(customers.id, orders.customerId))
        .leftJoin(events, eq(events.id, commissionEntries.eventId))
        .where(and(eq(commissionEntries.agentId, agentId), sql`${commissionEntries.status} <> 'void'`))
        .orderBy(desc(commissionEntries.createdAt))
        .limit(300),
    ]);
    return {
      agent: { id: agent.id, name: agent.name },
      totals: {
        readyCents: Number(totals.readyCents),
        comingCents: Number(totals.comingCents),
        sentCents: Number(totals.sentCents),
        paidThisYearCents: Number(totals.paidThisYearCents),
      },
      entries,
    };
  }

  /** Nudge (FR-AGT-2): an edited e-mail to an agent who did not sell this month. */
  async nudge(auth: AuthContext, agentId: string, input: { subject: string; message: string }) {
    const agent = await this.db.transaction(async (tx) => {
      const a = await this.assertAgent(agentId, tx, true);
      if (a.status !== 'active') throw new ConflictException({ message: 'This agent has not accepted the invitation yet' });
      const [last] = await tx
        .select({ id: agentNudges.id })
        .from(agentNudges)
        .where(and(eq(agentNudges.agentId, agentId), gte(agentNudges.createdAt, dayStart())))
        .limit(1);
      if (last) throw new ConflictException({ message: `${a.name} was already nudged today` });
      const [row] = await tx.insert(agentNudges).values({ agentId, sentById: auth.user.id, subject: input.subject, message: input.message }).returning({ id: agentNudges.id });
      await this.audit.log(auth, { category: 'commission', action: 'agent_nudged', recordType: 'user', recordId: agentId, recordLabel: a.name, meta: { nudgeId: row.id, subject: input.subject } }, tx);
      return a;
    });
    await this.mail.send({ kind: 'nudge', to: [agent.email], subject: input.subject, body: input.message, recordType: 'user', recordId: agentId });
    return { ok: true };
  }

  /**
   * Send to pay (A4): the accountant gets a statement by e-mail and the agent's Ready to pay
   * entries move to Sent. Negative entries (credit-note offsets, A5) are part of the sum.
   */
  async sendToPay(auth: AuthContext, agentId: string, entryIds?: string[]) {
    const email = await this.settings.get('email');
    if (!email.accounting) throw new BadRequestException({ message: "Add the accountant's e-mail in Settings first" });
    const result = await this.db.transaction(async (tx) => {
      const agent = await this.assertAgent(agentId, tx, true);
      const rows = await tx
        .select({ id: commissionEntries.id, units: commissionEntries.units, amountCents: commissionEntries.amountCents, orderNumber: orders.number, eventName: events.name, note: commissionEntries.note })
        .from(commissionEntries)
        .leftJoin(orders, eq(orders.id, commissionEntries.orderId))
        .leftJoin(events, eq(events.id, commissionEntries.eventId))
        .where(and(eq(commissionEntries.agentId, agentId), eq(commissionEntries.status, 'ready'), entryIds?.length ? inArray(commissionEntries.id, entryIds) : undefined))
        .orderBy(asc(commissionEntries.createdAt))
        .for('update', { of: commissionEntries });
      const sum = rows.reduce((s, r) => s + r.amountCents, 0);
      if (!rows.length || sum <= 0) throw new ConflictException({ message: 'There is nothing ready to pay for this agent' });
      const now = new Date();
      await tx.update(commissionEntries).set({ status: 'sent', sentAt: now }).where(inArray(commissionEntries.id, rows.map((r) => r.id)));
      await this.audit.log(
        auth,
        {
          category: 'commission',
          action: 'commission_sent_to_pay',
          recordType: 'user',
          recordId: agentId,
          recordLabel: agent.name,
          money: true,
          changes: { readyCents: { from: sum, to: 0 }, sentCents: { from: 0, to: sum } },
          meta: { entries: rows.length, amountCents: sum, to: email.accounting },
        },
        tx,
      );
      return { agent, rows, sum };
    });
    const vat = vatOf(result.sum);
    const company = await this.settings.get('company');
    await this.mail.send({
      kind: 'commission_statement',
      to: [email.accounting],
      subject: `Commission to pay: ${result.agent.name} · ${euros(result.sum)} + VAT`,
      body: [
        `Please pay the agent commission below.`,
        '',
        `Agent: ${result.agent.name} (${result.agent.email})`,
        `Statement date: ${isoDate()}`,
        '',
        ...result.rows.map((r) => `${r.orderNumber ?? `Event: ${r.eventName ?? '—'}`}: ${r.units} units · ${euros(r.amountCents)}${r.note ? ` (${r.note})` : ''}`),
        '',
        `Commission excl. VAT: ${euros(result.sum)}`,
        `VAT ${Math.round(VAT_RATE * 100)}%: ${euros(vat)}`,
        `Total to pay: ${euros(result.sum + vat)}`,
        '',
        `Sent by ${auth.user.name}, ${company.name}`,
      ].join('\n'),
      recordType: 'user',
      recordId: agentId,
    });
    return { ok: true, amountCents: result.sum, entries: result.rows.length };
  }

  /** Mark as paid: moves Sent entries (or, when nothing was sent, Ready entries) to Paid. */
  async markPaid(auth: AuthContext, agentId: string, entryIds?: string[]) {
    return this.db.transaction(async (tx) => {
      const agent = await this.assertAgent(agentId, tx, true);
      const rows = await tx
        .select({ id: commissionEntries.id, status: commissionEntries.status, amountCents: commissionEntries.amountCents })
        .from(commissionEntries)
        .where(and(eq(commissionEntries.agentId, agentId), inArray(commissionEntries.status, ['sent', 'ready']), entryIds?.length ? inArray(commissionEntries.id, entryIds) : undefined))
        .for('update');
      const sent = rows.filter((r) => r.status === 'sent');
      const pick = entryIds?.length ? rows : sent.length ? sent : rows;
      const sum = pick.reduce((s, r) => s + r.amountCents, 0);
      if (!pick.length || sum <= 0) throw new ConflictException({ message: 'There is nothing to mark as paid for this agent' });
      const from = pick.every((r) => r.status === 'sent') ? 'sent' : 'ready';
      await tx.update(commissionEntries).set({ status: 'paid', paidAt: new Date() }).where(inArray(commissionEntries.id, pick.map((r) => r.id)));
      await this.audit.log(
        auth,
        {
          category: 'commission',
          action: 'commission_paid',
          recordType: 'user',
          recordId: agentId,
          recordLabel: agent.name,
          money: true,
          changes: { [`${from}Cents`]: { from: sum, to: 0 }, paidCents: { from: 0, to: sum } },
          meta: { entries: pick.length, amountCents: sum },
        },
        tx,
      );
      return { ok: true, amountCents: sum, entries: pick.length };
    });
  }
}
