import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { VAT_RATE, formatMoney, isoDate, vatOf } from '@ananda/shared';
import { InjectDb, type Db, type Tx } from '../db/db.module';
import { brokerNudges, brokerProfiles, commissionEntries, customers, events, orders, roles, users } from '../db/schema';
import { AuditService, UNDO_MINUTES } from '../core/audit.service';
import { MailService } from '../core/mail.service';
import { NotifyService } from '../core/notify.service';
import { SettingsService } from '../core/settings.service';
import { brokerFilter } from '../core/scope';
import { OWED_STATUSES, outstandingSql } from '../core/figures.service';
import { randomToken, sha256 } from '../core/crypto';
import { webOrigin } from '../core/origin';
import { setupStatus } from './setup.service';
import type { BrokerInviteInput } from './brokers.schemas';
import type { AuthContext } from '../common/context';

function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
function dayStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
const euros = (cents: number) => formatMoney(cents, 'en');
const from0 = (rows: { status: string }[]) => (rows.every((r) => r.status === 'sent') ? 'sent' : 'ready');

/** Orders that count as a sale: the payment request went out and the order was not cancelled. */
const SOLD = sql`${orders.requestSentAt} is not null and ${orders.status} <> 'cancelled'`;

/**
 * Brokers & commissions (PRD §5.8). Commission figures have one definition here, shared by the
 * admin view and the broker's own view: Ready to pay = entries on fully paid orders not yet sent
 * (credit-note offsets, which are negative, included — A5); Coming = entries on orders not yet
 * fully paid; Sent to pay = sent to the accountant, waiting to be marked paid (A4).
 */
@Injectable()
export class BrokersService {
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

  private async brokerUsers() {
    return this.db
      .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, status: users.status, language: users.language, createdAt: users.createdAt })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(roles.baseRole, 'broker'), notInArray(users.status, ['deactivated'])))
      .orderBy(asc(users.name));
  }

  /** Admin and Finance view (FR-AGT-1 … FR-AGT-3). */
  async overview() {
    const since = monthStart();
    const today = dayStart();
    const people = await this.brokerUsers();
    const ids = people.map((p) => p.id);
    const none = ids.length === 0;
    const [money, custs, sold, nudges, [newCustomers], profiles] = await Promise.all([
      none ? [] : this.db.select({ brokerId: commissionEntries.brokerId, ...this.totalsSql() }).from(commissionEntries).where(inArray(commissionEntries.brokerId, ids)).groupBy(commissionEntries.brokerId),
      none
        ? []
        : this.db
            .select({ brokerId: customers.brokerId, n: sql<number>`count(*)::int` })
            .from(customers)
            .where(and(inArray(customers.brokerId, ids), eq(customers.status, 'active')))
            .groupBy(customers.brokerId),
      none
        ? []
        : this.db
            .select({
              brokerId: orders.brokerId,
              month: sql<number>`count(*) filter (where ${orders.requestSentAt} >= ${since})::int`,
              last: sql<string | null>`max(${orders.requestSentAt})`,
            })
            .from(orders)
            .where(and(inArray(orders.brokerId, ids), SOLD))
            .groupBy(orders.brokerId),
      none ? [] : this.db.select({ brokerId: brokerNudges.brokerId, last: sql<string>`max(${brokerNudges.createdAt})` }).from(brokerNudges).where(inArray(brokerNudges.brokerId, ids)).groupBy(brokerNudges.brokerId),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(customers)
        .where(and(isNotNull(customers.approvedAt), gte(customers.approvedAt, since), inArray(customers.status, ['active', 'archived']))),
      none ? [] : this.db.select().from(brokerProfiles).where(inArray(brokerProfiles.userId, ids)),
    ]);
    const brokers = people.map((p) => {
      const m = money.find((x) => x.brokerId === p.id);
      const s = sold.find((x) => x.brokerId === p.id);
      const lastNudge = nudges.find((x) => x.brokerId === p.id)?.last ?? null;
      const prof = profiles.find((x) => x.userId === p.id) ?? null;
      return {
        id: p.id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        status: p.status,
        language: p.language,
        customers: Number(custs.find((x) => x.brokerId === p.id)?.n ?? 0),
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
    // Brokers still setting up are not expected to sell yet.
    const active = brokers.filter((a) => a.status === 'active' && a.setup === 'done');
    const range = { from: isoDate(since), to: isoDate() };
    const didntSell = active.filter((a) => a.ordersThisMonth === 0);
    const rules = await this.settings.rules();
    const security = await this.settings.get('security');
    return {
      tiles: {
        readyCents: brokers.reduce((s, a) => s + a.readyCents, 0),
        readyBrokers: brokers.filter((a) => a.readyCents > 0).length,
        comingCents: brokers.reduce((s, a) => s + a.comingCents, 0),
        sentCents: brokers.reduce((s, a) => s + a.sentCents, 0),
        didntSell: didntSell.length,
        activeBrokers: active.length,
        newCustomersThisMonth: Number(newCustomers.n),
      },
      range,
      didntSellIds: didntSell.map((a) => a.id),
      brokers,
      terms: { commissionPerUnitCents: rules.commissionPerUnitCents, vatRate: VAT_RATE, inviteValidityDays: security.inviteValidityDays },
      accountingEmail: (await this.settings.get('email')).accounting || null,
    };
  }

  private async assertBroker(id: string, tx: Db | Tx = this.db, lock = false) {
    const q = tx
      .select({ id: users.id, name: users.name, email: users.email, status: users.status })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.id, id), eq(roles.baseRole, 'broker')));
    const [broker] = lock ? await q.for('update', { of: users }) : await q;
    if (!broker) throw new NotFoundException({ message: 'Broker not found' });
    return broker;
  }

  /** Commission goes to the bank account in the countersigned agreement: no payout before the set-up is finished. */
  private async assertSetUp(tx: Db | Tx, broker: { id: string; name: string; status: string }) {
    const [p] = await tx.select().from(brokerProfiles).where(eq(brokerProfiles.userId, broker.id));
    if (p && !p.countersignedAt) throw new ConflictException({ message: `${broker.name}'s set-up isn't finished: countersign the broker agreement first` });
    return p ?? null;
  }

  /** The broker's own earnings (FR-AGT-5), or one broker's for an Admin. Brokers see only their own. */
  async earnings(auth: AuthContext, brokerId: string) {
    const own = brokerFilter(auth);
    if (own && own !== brokerId) throw new NotFoundException({ message: 'Broker not found' });
    const broker = await this.assertBroker(brokerId);
    const [[totals], entries] = await Promise.all([
      this.db.select(this.totalsSql()).from(commissionEntries).where(eq(commissionEntries.brokerId, brokerId)),
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
        .where(and(eq(commissionEntries.brokerId, brokerId), sql`${commissionEntries.status} <> 'void'`))
        .orderBy(desc(commissionEntries.createdAt))
        .limit(300),
    ]);
    return {
      broker: { id: broker.id, name: broker.name },
      totals: {
        readyCents: Number(totals.readyCents),
        comingCents: Number(totals.comingCents),
        sentCents: Number(totals.sentCents),
        paidThisYearCents: Number(totals.paidThisYearCents),
      },
      entries,
    };
  }

  /** Nudge (FR-AGT-2): an edited e-mail to a broker who did not sell this month. */
  async nudge(auth: AuthContext, brokerId: string, input: { subject: string; message: string }) {
    const broker = await this.db.transaction(async (tx) => {
      const a = await this.assertBroker(brokerId, tx, true);
      if (a.status !== 'active') throw new ConflictException({ message: 'This broker has not accepted the invitation yet' });
      const [last] = await tx
        .select({ id: brokerNudges.id })
        .from(brokerNudges)
        .where(and(eq(brokerNudges.brokerId, brokerId), gte(brokerNudges.createdAt, dayStart())))
        .limit(1);
      if (last) throw new ConflictException({ message: `${a.name} was already nudged today` });
      const [row] = await tx.insert(brokerNudges).values({ brokerId, sentById: auth.user.id, subject: input.subject, message: input.message }).returning({ id: brokerNudges.id });
      await this.audit.log(auth, { category: 'commission', action: 'broker_nudged', recordType: 'user', recordId: brokerId, recordLabel: a.name, meta: { nudgeId: row.id, subject: input.subject } }, tx);
      return a;
    });
    await this.mail.send({ kind: 'nudge', to: [broker.email], subject: input.subject, body: input.message, recordType: 'user', recordId: brokerId });
    return { ok: true };
  }

  /** A plain e-mail to a broker from their panel ("E-mail Daniel"). */
  async email(auth: AuthContext, brokerId: string, input: { subject: string; message: string }) {
    const broker = await this.assertBroker(brokerId);
    if (broker.status !== 'active') throw new ConflictException({ message: 'This broker has not accepted the invitation yet' });
    await this.mail.send({ kind: 'broker_email', to: [broker.email], subject: input.subject, body: input.message, recordType: 'user', recordId: brokerId });
    await this.audit.log(auth, { category: 'users_access', action: 'broker_emailed', recordType: 'user', recordId: brokerId, recordLabel: broker.name, meta: { subject: input.subject } });
    return { ok: true };
  }

  /**
   * Send to pay (A4): the accountant gets a statement by e-mail and the broker's Ready to pay
   * entries move to Sent. Negative entries (credit-note offsets, A5) are part of the sum.
   */
  async sendToPay(auth: AuthContext, brokerId: string, entryIds?: string[], note?: string) {
    const email = await this.settings.get('email');
    if (!email.accounting) throw new BadRequestException({ message: "Add the accountant's e-mail in Settings first" });
    const result = await this.db.transaction(async (tx) => {
      const broker = await this.assertBroker(brokerId, tx, true);
      const bank = await this.assertSetUp(tx, broker);
      const rows = await tx
        .select({ id: commissionEntries.id, units: commissionEntries.units, amountCents: commissionEntries.amountCents, orderNumber: orders.number, eventName: events.name, note: commissionEntries.note })
        .from(commissionEntries)
        .leftJoin(orders, eq(orders.id, commissionEntries.orderId))
        .leftJoin(events, eq(events.id, commissionEntries.eventId))
        .where(and(eq(commissionEntries.brokerId, brokerId), eq(commissionEntries.status, 'ready'), entryIds?.length ? inArray(commissionEntries.id, entryIds) : undefined))
        .orderBy(asc(commissionEntries.createdAt))
        .for('update', { of: commissionEntries });
      const sum = rows.reduce((s, r) => s + r.amountCents, 0);
      if (!rows.length || sum <= 0) throw new ConflictException({ message: 'There is nothing ready to pay for this broker' });
      const now = new Date();
      await tx.update(commissionEntries).set({ status: 'sent', sentAt: now }).where(inArray(commissionEntries.id, rows.map((r) => r.id)));
      await this.audit.log(
        auth,
        {
          category: 'commission',
          action: 'commission_sent_to_pay',
          recordType: 'user',
          recordId: brokerId,
          recordLabel: broker.name,
          money: true,
          changes: { readyCents: { from: sum, to: 0 }, sentCents: { from: 0, to: sum } },
          meta: { entries: rows.length, amountCents: sum, to: email.accounting },
        },
        tx,
      );
      await this.notify.send('commission_sent', { users: [brokerId] }, { amountCents: sum }, '/brokers', tx);
      return { broker, rows, sum, bank };
    });
    const vat = vatOf(result.sum);
    const company = await this.settings.get('company');
    await this.mail.send({
      kind: 'commission_statement',
      to: [email.accounting],
      subject: `Commission to pay: ${result.broker.name} · ${euros(result.sum)} + VAT`,
      body: [
        `Please pay the broker commission below.`,
        '',
        `Broker: ${result.broker.name} (${result.broker.email})`,
        `Statement date: ${isoDate()}`,
        '',
        ...result.rows.map((r) => `${r.orderNumber ?? `Event: ${r.eventName ?? '—'}`}: ${r.units} units · ${euros(r.amountCents)}${r.note ? ` (${r.note})` : ''}`),
        '',
        `Commission excl. VAT: ${euros(result.sum)}`,
        `VAT ${Math.round(VAT_RATE * 100)}%: ${euros(vat)}`,
        `Total to pay: ${euros(result.sum + vat)}`,
        '',
        ...(result.bank?.iban ? [`Pay to: ${result.bank.accountHolder ?? result.broker.name}${result.bank.bankName ? `, ${result.bank.bankName}` : ''}`, `IBAN ${result.bank.iban}${result.bank.bic ? ` · BIC ${result.bank.bic}` : ''}`, ''] : []),
        ...(note?.trim() ? [`Note: ${note.trim()}`, ''] : []),
        `Sent by ${auth.user.name}, ${company.name}`,
      ].join('\n'),
      recordType: 'user',
      recordId: brokerId,
    });
    return { ok: true, amountCents: result.sum, entries: result.rows.length };
  }

  /** Mark as paid: moves Sent entries (or, when nothing was sent, Ready entries) to Paid. */
  async markPaid(auth: AuthContext, brokerId: string, entryIds?: string[]) {
    return this.db.transaction(async (tx) => {
      const broker = await this.assertBroker(brokerId, tx, true);
      const rows = await tx
        .select({ id: commissionEntries.id, status: commissionEntries.status, amountCents: commissionEntries.amountCents })
        .from(commissionEntries)
        .where(and(eq(commissionEntries.brokerId, brokerId), inArray(commissionEntries.status, ['sent', 'ready']), entryIds?.length ? inArray(commissionEntries.id, entryIds) : undefined))
        .for('update');
      const sent = rows.filter((r) => r.status === 'sent');
      const pick = entryIds?.length ? rows : sent.length ? sent : rows;
      const sum = pick.reduce((s, r) => s + r.amountCents, 0);
      if (!pick.length || sum <= 0) throw new ConflictException({ message: 'There is nothing to mark as paid for this broker' });
      if (from0(pick) === 'ready') await this.assertSetUp(tx, broker);
      const from = from0(pick);
      await tx.update(commissionEntries).set({ status: 'paid', paidAt: new Date() }).where(inArray(commissionEntries.id, pick.map((r) => r.id)));
      await this.audit.log(
        auth,
        {
          category: 'commission',
          action: 'commission_paid',
          recordType: 'user',
          recordId: brokerId,
          recordLabel: broker.name,
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
      await this.notify.send('commission_paid', { users: [brokerId] }, { amountCents: sum, order: list(what.map((w) => w.order ?? w.event)), customer: list(what.map((w) => w.customer)) || '—' }, '/brokers', tx);
      return { ok: true, amountCents: sum, entries: pick.length, entryIds: pick.map((r) => r.id) };
    });
  }

  /**
   * Take a Mark as paid back (the toast's Undo): the entries go back to Sent, or to Ready when they were never
   * sent. Only while they are still Paid from that tap and it was a moment ago; the broker is told it was a mistake.
   */
  async undoMarkPaid(auth: AuthContext, brokerId: string, entryIds: string[]) {
    if (!auth.perms.sensitive.includes('pay_commission')) throw new ForbiddenException({ code: 'no_access', message: 'You do not have access to this' });
    return this.db.transaction(async (tx) => {
      const broker = await this.assertBroker(brokerId, tx, true);
      const rows = await tx.select().from(commissionEntries).where(and(eq(commissionEntries.brokerId, brokerId), inArray(commissionEntries.id, entryIds))).for('update');
      const since = Date.now() - UNDO_MINUTES * 60_000;
      if (!rows.length || rows.length !== new Set(entryIds).size || rows.some((r) => r.status !== 'paid')) throw new ConflictException({ message: 'This payment changed since, so it cannot be undone' });
      if (rows.some((r) => !r.paidAt || r.paidAt.getTime() < since)) throw new ConflictException({ message: `A payment can be undone for ${UNDO_MINUTES} minutes. Ask finance to correct it.` });
      const sum = rows.reduce((s, r) => s + r.amountCents, 0);
      const wasSent = rows.filter((r) => r.sentAt);
      const wasReady = rows.filter((r) => !r.sentAt);
      if (wasSent.length) await tx.update(commissionEntries).set({ status: 'sent', paidAt: null }).where(inArray(commissionEntries.id, wasSent.map((r) => r.id)));
      if (wasReady.length) await tx.update(commissionEntries).set({ status: 'ready', paidAt: null }).where(inArray(commissionEntries.id, wasReady.map((r) => r.id)));
      const total = (xs: typeof rows) => xs.reduce((s, r) => s + r.amountCents, 0);
      await this.audit.log(
        auth,
        {
          category: 'commission',
          action: 'commission_paid_undone',
          recordType: 'user',
          recordId: brokerId,
          recordLabel: broker.name,
          money: true,
          changes: { paidCents: { from: sum, to: 0 }, ...(wasSent.length ? { sentCents: { from: 0, to: total(wasSent) } } : {}), ...(wasReady.length ? { readyCents: { from: 0, to: total(wasReady) } } : {}) },
          meta: { entries: rows.length, amountCents: sum },
        },
        tx,
      );
      await this.notify.send('commission_paid_undone', { users: [brokerId] }, {}, '/brokers', tx);
      return { ok: true, amountCents: sum, entries: rows.length };
    });
  }

  /** One broker for the side panel: figures and their customers with what each owes. */
  async detail(brokerId: string) {
    const broker = await this.assertBroker(brokerId);
    const rows = await this.db
      .select({
        id: customers.id,
        name: customers.companyName,
        lastOrderAt: sql<string | null>`max(${orders.requestSentAt})`,
        owedCents: sql<number>`coalesce(sum(${outstandingSql}) filter (where ${inArray(orders.status, [...OWED_STATUSES])}), 0)::int`,
      })
      .from(customers)
      .leftJoin(orders, and(eq(orders.customerId, customers.id), SOLD))
      .where(and(eq(customers.brokerId, brokerId), eq(customers.status, 'active')))
      .groupBy(customers.id)
      .orderBy(sql`max(${orders.requestSentAt}) desc nulls last`);
    return {
      broker: { id: broker.id, name: broker.name, email: broker.email },
      customers: rows.map((r) => ({ id: r.id, name: r.name, lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt).toISOString() : null, owedCents: Number(r.owedCents) })),
    };
  }

  /**
   * Invite new broker (FR-AGT-4) with the invitation e-mail exactly as written in the panel; the
   * set-password link and its validity are added at the end. After setting a password the broker
   * fills in company and bank details and signs the broker agreement (BrokerSetupService).
   */
  async invite(auth: AuthContext, input: BrokerInviteInput) {
    const security = await this.settings.get('security');
    const result = await this.db.transaction(async (tx) => {
      const [role] = await tx.select().from(roles).where(eq(roles.key, 'broker'));
      if (!role) throw new BadRequestException({ message: 'The broker role is missing' });
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
