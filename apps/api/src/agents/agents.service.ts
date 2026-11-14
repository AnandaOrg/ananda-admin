import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { VAT_RATE, isoDate, vatOf } from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { agentNudges, agentProfiles, commissionEntries, customers, events, orders, roles, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { MailService } from '../core/mail.service';
import { NotifyService } from '../core/notify.service';
import { SettingsService } from '../core/settings.service';
import { agentFilter } from '../core/scope';
import { OWED_STATUSES, outstandingSql } from '../core/figures.service';
import { randomToken, sha256 } from '../core/crypto';
import { webOrigin } from '../core/origin';
import { setupStatus } from './setup.service';
import type { AgentInviteInput } from './agents.schemas';
import type { AuthContext } from '../common/context';

function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
function dayStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
const euros = (cents: number) => `€${(cents / 100).toFixed(2)}`;
const from0 = (rows: { status: string }[]) => (rows.every((r) => r.status === 'sent') ? 'sent' : 'ready');

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
    private readonly notify: NotifyService,
  ) {}

  private totalsSql() {
    return {
      readyCents: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'ready'), 0)::int`,
      comingCents: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'coming'), 0)::int`,
      sentCents: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'sent'), 0)::int`,
      paidThisYearCents: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'paid' and ${commissionEntries.paidAt} >= ${new Date(new Date().getFullYear(), 0, 1)}), 0)::int`,
      paidTodayCents: sql<number>`coalesce(sum(${commissionEntries.amountCents}) filter (where ${commissionEntries.status} = 'paid' and ${commissionEntries.paidAt} >= ${dayStart()}), 0)::int`,
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
    const [money, custs, sold, nudges, [newCustomers], profiles] = await Promise.all([
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
      none ? [] : this.db.select().from(agentProfiles).where(inArray(agentProfiles.userId, ids)),
    ]);
    const agents = people.map((p) => {
      const m = money.find((x) => x.agentId === p.id);
      const s = sold.find((x) => x.agentId === p.id);
      const lastNudge = nudges.find((x) => x.agentId === p.id)?.last ?? null;
      const prof = profiles.find((x) => x.userId === p.id) ?? null;
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
        paidTodayCents: Number(m?.paidTodayCents ?? 0),
        setup: setupStatus(p.status, prof),
        signedAt: prof?.signedAt?.toISOString() ?? null,
        bank: prof?.iban ? { accountHolder: prof.accountHolder, bankName: prof.bankName, iban: prof.iban, bic: prof.bic } : null,
        companyName: prof?.companyName ?? null,
        lastNudgedAt: lastNudge ? new Date(lastNudge).toISOString() : null,
        nudgedToday: !!lastNudge && new Date(lastNudge) >= today,
      };
    });
    // Agents still setting up are not expected to sell yet.
    const active = agents.filter((a) => a.status === 'active' && a.setup === 'done');
    const range = { from: isoDate(since), to: isoDate() };
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
      range,
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

  /** Commission goes to the bank account in the countersigned agreement: no payout before the set-up is finished. */
  private async assertSetUp(tx: Db | Tx, agent: { id: string; name: string; status: string }) {
    const [p] = await tx.select().from(agentProfiles).where(eq(agentProfiles.userId, agent.id));
    if (p && !p.countersignedAt) throw new ConflictException({ message: `${agent.name}'s set-up isn't finished: countersign the agent agreement first` });
    return p ?? null;
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

  /** A plain e-mail to an agent from their panel ("E-mail Daniel"). */
  async email(auth: AuthContext, agentId: string, input: { subject: string; message: string }) {
    const agent = await this.assertAgent(agentId);
    if (agent.status !== 'active') throw new ConflictException({ message: 'This agent has not accepted the invitation yet' });
    await this.mail.send({ kind: 'agent_email', to: [agent.email], subject: input.subject, body: input.message, recordType: 'user', recordId: agentId });
    await this.audit.log(auth, { category: 'users_access', action: 'agent_emailed', recordType: 'user', recordId: agentId, recordLabel: agent.name, meta: { subject: input.subject } });
    return { ok: true };
  }

  /**
   * Send to pay (A4): the accountant gets a statement by e-mail and the agent's Ready to pay
   * entries move to Sent. Negative entries (credit-note offsets, A5) are part of the sum.
   */
  async sendToPay(auth: AuthContext, agentId: string, entryIds?: string[], note?: string) {
    const email = await this.settings.get('email');
    if (!email.accounting) throw new BadRequestException({ message: "Add the accountant's e-mail in Settings first" });
    const result = await this.db.transaction(async (tx) => {
      const agent = await this.assertAgent(agentId, tx, true);
      const bank = await this.assertSetUp(tx, agent);
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
      await this.notify.send('commission_sent', { users: [agentId] }, { amountCents: sum }, '/agents', tx);
      return { agent, rows, sum, bank };
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
        ...(result.bank?.iban ? [`Pay to: ${result.bank.accountHolder ?? result.agent.name}${result.bank.bankName ? `, ${result.bank.bankName}` : ''}`, `IBAN ${result.bank.iban}${result.bank.bic ? ` · BIC ${result.bank.bic}` : ''}`, ''] : []),
        ...(note?.trim() ? [`Note: ${note.trim()}`, ''] : []),
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
      if (from0(pick) === 'ready') await this.assertSetUp(tx, agent);
      const from = from0(pick);
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
      const what = await tx
        .select({ order: orders.number, customer: customers.companyName, event: events.name })
        .from(commissionEntries)
        .leftJoin(orders, eq(orders.id, commissionEntries.orderId))
        .leftJoin(customers, eq(customers.id, orders.customerId))
        .leftJoin(events, eq(events.id, commissionEntries.eventId))
        .where(inArray(commissionEntries.id, pick.map((r) => r.id)));
      const list = (xs: (string | null)[]) => {
        const u = [...new Set(xs.filter((x): x is string => !!x))];
        return u.length > 2 ? `${u.slice(0, 2).join(', ')} +${u.length - 2}` : u.join(', ');
      };
      await this.notify.send('commission_paid', { users: [agentId] }, { amountCents: sum, order: list(what.map((w) => w.order ?? w.event)), customer: list(what.map((w) => w.customer)) || '—' }, '/agents', tx);
      return { ok: true, amountCents: sum, entries: pick.length };
    });
  }

  /** One agent for the side panel: figures and their customers with what each owes. */
  async detail(agentId: string) {
    const agent = await this.assertAgent(agentId);
    const rows = await this.db
      .select({
        id: customers.id,
        name: customers.companyName,
        lastOrderAt: sql<string | null>`max(${orders.requestSentAt})`,
        owedCents: sql<number>`coalesce(sum(${outstandingSql}) filter (where ${inArray(orders.status, [...OWED_STATUSES])}), 0)::int`,
      })
      .from(customers)
      .leftJoin(orders, and(eq(orders.customerId, customers.id), SOLD))
      .where(and(eq(customers.agentId, agentId), eq(customers.status, 'active')))
      .groupBy(customers.id)
      .orderBy(sql`max(${orders.requestSentAt}) desc nulls last`);
    return {
      agent: { id: agent.id, name: agent.name, email: agent.email },
      customers: rows.map((r) => ({ id: r.id, name: r.name, lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt).toISOString() : null, owedCents: Number(r.owedCents) })),
    };
  }

  /**
   * Invite new agent (FR-AGT-4) with the invitation e-mail exactly as written in the panel; the
   * set-password link and its validity are added at the end. After setting a password the agent
   * fills in company and bank details and signs the agent agreement (AgentSetupService).
   */
  async invite(auth: AuthContext, input: AgentInviteInput) {
    const security = await this.settings.get('security');
    const result = await this.db.transaction(async (tx) => {
      const [role] = await tx.select().from(roles).where(eq(roles.key, 'agent'));
      if (!role) throw new BadRequestException({ message: 'The agent role is missing' });
      const [existing] = await tx.select().from(users).where(eq(users.email, input.email)).for('update');
      const reusable = existing && existing.status === 'deactivated' && !existing.passwordHash;
      if (existing && !reusable) {
        throw new ConflictException({ message: 'Check the highlighted fields', fields: { email: existing.status === 'invited' ? 'This person is already invited. Resend the invitation from Users & roles.' : 'This e-mail already has an account' } });
      }
      const token = randomToken();
      const expiresAt = new Date(Date.now() + security.inviteValidityDays * 86_400_000);
      const values = { name: input.name, email: input.email, roleId: role.id, language: input.language, status: 'invited' as const, inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt, invitedById: auth.user.id };
      const [user] = existing ? await tx.update(users).set(values).where(eq(users.id, existing.id)).returning() : await tx.insert(users).values(values).returning();
      await this.audit.log(
        auth,
        { category: 'users_access', action: 'member_invited', recordType: 'user', recordId: user.id, recordLabel: `${user.name} · ${user.email}`, changes: { role: { from: null, to: role.name }, status: { from: existing?.status ?? null, to: 'invited' } }, meta: { expiresAt: expiresAt.toISOString(), subject: input.subject } },
        tx,
      );
      return { user, token, expiresAt };
    });
    const first = result.user.name.trim().split(/\s+/)[0];
    const link = `${webOrigin()}/invite/${result.token}`;
    await this.mail.send({
      kind: 'invitation',
      to: [result.user.email],
      subject: input.subject,
      body: [input.letter.replace(/\[Name\]/g, first).trim(), '', link].join('\n'),
      recordType: 'user',
      recordId: result.user.id,
    });
    return { id: result.user.id };
  }
}
