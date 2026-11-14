import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import { formatMoney, isoDate } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { collectionReminders, customers, documents, orders, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
import { DocumentsService } from '../documents/documents.service';
import { FiguresService, OWED_STATUSES, outstandingSql } from '../core/figures.service';
import { MailService } from '../core/mail.service';
import { SettingsService } from '../core/settings.service';
import { agentFilter, orderScope } from '../core/scope';
import { lateDays } from '../orders/orders.service';
import type { AuthContext } from '../common/context';

/** Late and due payments with calls and reminders (FR-COLL-1..3). */
@Injectable()
export class CollectionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly figures: FiguresService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly docs: DocumentsService,
  ) {}

  async list(auth: AuthContext, q: { filter?: string; agentId?: string }) {
    const today = isoDate();
    const week = isoDate(new Date(Date.now() + 7 * 86_400_000));
    const own = agentFilter(auth);
    // An agent only ever sees their own customers; the agent filter is for everyone else.
    const agentId = own ?? (q.agentId || null);
    const conds: SQL[] = [inArray(orders.status, [...OWED_STATUSES]), sql`${outstandingSql} > 0`];
    const scope = orderScope(auth);
    if (scope) conds.push(scope);
    if (agentId) conds.push(eq(orders.agentId, agentId));
    if (q.filter === 'late') conds.push(lt(orders.paymentDueOn, today));
    if (q.filter === 'week') conds.push(gte(orders.paymentDueOn, today), lte(orders.paymentDueOn, week));
    const rows = await this.db
      .select({
        orderId: orders.id,
        number: orders.number,
        status: orders.status,
        paymentDueOn: orders.paymentDueOn,
        outstandingCents: outstandingSql,
        totalCents: orders.totalCents,
        customerId: customers.id,
        customerName: customers.companyName,
        phone: customers.phone,
        email: customers.invoiceEmail,
        contactName: customers.contactName,
        agentId: users.id,
        agentName: users.name,
        lastReminderAt: sql<string | null>`(select max(${collectionReminders.createdAt}) from ${collectionReminders} where ${collectionReminders.orderId} = ${orders.id})`,
        remindedToday: sql<boolean>`exists (select 1 from ${collectionReminders} where ${collectionReminders.orderId} = ${orders.id} and ${collectionReminders.createdAt} >= date_trunc('day', now()))`,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.agentId))
      .where(and(...conds))
      .orderBy(asc(orders.paymentDueOn));
    const [owed, every, agents, email] = await Promise.all([
      this.figures.owed(agentId),
      // "{First}'s share of €X": the all-agents figure, only for people who may see every agent.
      !own && agentId ? this.figures.owed(null) : Promise.resolve(null),
      own ? Promise.resolve(null) : this.agentCounts(),
      this.settings.get('email'),
    ]);
    return {
      tiles: {
        lateCents: owed.lateCents,
        lateCount: owed.lateCount,
        dueWeekCents: owed.dueWeekCents,
        dueWeekCount: owed.dueWeekCount,
        allCents: owed.totalCents,
        allCount: owed.count,
        oldestLateDays: owed.oldestLateDays,
        everyCents: every?.totalCents ?? null,
      },
      // Settings › E-mail "Copy the agent on reminders".
      copyAgent: email.copyAgent !== false,
      // One agent filter shared by phone and desktop: each agent with their unpaid invoices.
      agents,
      items: rows.map((r) => ({
        ...r,
        outstandingCents: Number(r.outstandingCents),
        lastReminderAt: r.lastReminderAt ? new Date(r.lastReminderAt).toISOString() : null,
        remindedToday: !!r.remindedToday,
        daysLate: lateDays(r.paymentDueOn, Number(r.outstandingCents), r.status, today),
      })),
    };
  }

  private async agentCounts() {
    const [people, counts] = await Promise.all([
      this.db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(inArray(users.roleId, sql`(select id from roles where base_role = 'agent')`), eq(users.status, 'active')))
        .orderBy(asc(users.name)),
      this.db
        .select({ agentId: orders.agentId, n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(inArray(orders.status, [...OWED_STATUSES]), sql`${outstandingSql} > 0`))
        .groupBy(orders.agentId),
    ]);
    return people.map((p) => ({ ...p, unpaid: Number(counts.find((c) => c.agentId === p.id)?.n ?? 0) }));
  }

  /** The latest proforma of the order, if one was issued: it carries the payment details. */
  private async proforma(orderId: string) {
    const [doc] = await this.db
      .select({ number: documents.number, data: documents.data })
      .from(documents)
      .where(and(eq(documents.orderId, orderId), eq(documents.type, 'proforma'), sql`${documents.supersededById} is null`))
      .orderBy(desc(documents.createdAt))
      .limit(1);
    return doc ?? null;
  }

  /**
   * Pre-written reminder in the customer's proforma language, short and friendly, read and editable
   * before sending. The proforma is attached when one was issued; otherwise the bank details are inline.
   */
  async draft(auth: AuthContext, orderId: string) {
    const [row] = await this.db
      .select({ o: orders, c: customers, agentName: users.name })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.agentId))
      .where(and(eq(orders.id, orderId), orderScope(auth)));
    if (!row) throw new NotFoundException({ message: 'Order not found' });
    const proforma = await this.proforma(orderId);
    const [company, bank] = await Promise.all([this.settings.get('company'), this.settings.get('bank')]);
    const lang = row.c.proformaLanguage === 'bg' ? 'bg' : 'en';
    const owed = Math.max(0, row.o.totalCents - row.o.paidCents - row.o.creditedCents);
    const days = lateDays(row.o.paymentDueOn, owed, row.o.status, isoDate());
    const doc = proforma?.number ?? row.o.number;
    const amount = formatMoney(owed, lang);
    const sign = company.name || 'ANANDA';
    if (lang === 'bg') {
      const about = days ? `Здравейте, приятелско напомняне, че падежът на проформа ${doc} за ${amount} беше преди ${days} дни.` : `Здравейте, приятелско напомняне за проформа ${doc} за ${amount}.`;
      const pay = proforma ? 'Данните за плащане са в прикачената проформа.' : `Данни за плащане: IBAN ${bank.iban} · BIC ${bank.bic} · Основание ${doc}.`;
      return { to: row.c.invoiceEmail, subject: `Напомняне за плащане · ${doc}`, message: `${about} ${pay} Благодарим, ${sign}`, attached: !!proforma };
    }
    const about = days ? `Hello, a friendly reminder that proforma ${doc} for ${amount} was due ${days} days ago.` : `Hello, a friendly reminder about proforma ${doc} for ${amount}.`;
    const pay = proforma ? 'Payment details are in the attached proforma.' : `Payment details: IBAN ${bank.iban} · BIC ${bank.bic} · Reference ${doc}.`;
    return { to: row.c.invoiceEmail, subject: `Payment reminder · ${doc}`, message: `${about} ${pay} Thank you, ${sign}`, attached: !!proforma };
  }

  /** The agent is copied on every reminder when Settings › E-mail says so (FR-COLL-3). */
  async send(auth: AuthContext, orderId: string, subject: string, message: string) {
    const [row] = await this.db
      .select({ o: orders, c: customers, agentEmail: users.email })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.agentId))
      .where(and(eq(orders.id, orderId), orderScope(auth)));
    if (!row) throw new NotFoundException({ message: 'Order not found' });
    const [proforma, email] = await Promise.all([this.proforma(orderId), this.settings.get('email')]);
    const copyAgent = email.copyAgent !== false;
    await this.db.insert(collectionReminders).values({ orderId, sentById: auth.user.id, subject, message });
    await this.mail.send({
      kind: 'payment_reminder',
      to: [row.c.invoiceEmail],
      cc: copyAgent ? [row.agentEmail] : [],
      subject,
      body: message,
      recordType: 'order',
      recordId: orderId,
      attachments: proforma ? [{ filename: `${proforma.number ?? row.o.number}.html`, content: this.docs.renderHtml('proforma', proforma.data as never), contentType: 'text/html' }] : undefined,
    });
    await this.audit.log(auth, { category: 'payments', action: 'reminder_sent', recordType: 'order', recordId: orderId, recordLabel: row.o.number, meta: { to: row.c.invoiceEmail, cc: copyAgent ? row.agentEmail : null, subject } });
    return { ok: true, copyAgent };
  }
}
