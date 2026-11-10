import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import { formatDate, formatMoney, isoDate } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { collectionReminders, customers, documents, orders, users } from '../db/schema';
import { AuditService } from '../core/audit.service';
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
  ) {}

  async list(auth: AuthContext, q: { filter?: string; agentId?: string }) {
    const today = isoDate();
    const week = isoDate(new Date(Date.now() + 7 * 86_400_000));
    const conds: SQL[] = [inArray(orders.status, [...OWED_STATUSES]), sql`${outstandingSql} > 0`];
    const scope = orderScope(auth);
    if (scope) conds.push(scope);
    if (q.agentId) conds.push(eq(orders.agentId, q.agentId));
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
        lastReminderAt: sql<string | null>`(select max(${collectionReminders.createdAt})::text from ${collectionReminders} where ${collectionReminders.orderId} = ${orders.id})`,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.agentId))
      .where(and(...conds))
      .orderBy(asc(orders.paymentDueOn));
    const agentId = q.agentId ?? agentFilter(auth);
    const owed = await this.figures.owed(agentId);
    return {
      tiles: {
        lateCents: owed.lateCents,
        lateCount: owed.lateCount,
        dueWeekCents: owed.dueWeekCents,
        dueWeekCount: owed.dueWeekCount,
        allCents: owed.totalCents,
        allCount: owed.count,
        oldestLateDays: owed.oldestLateDays,
      },
      items: rows.map((r) => ({ ...r, outstandingCents: Number(r.outstandingCents), daysLate: lateDays(r.paymentDueOn, Number(r.outstandingCents), r.status, today) })),
    };
  }

  /** Pre-written reminder in the customer's proforma language, editable before sending. */
  async draft(auth: AuthContext, orderId: string) {
    const [row] = await this.db
      .select({ o: orders, c: customers, agentName: users.name })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.agentId))
      .where(and(eq(orders.id, orderId), orderScope(auth)));
    if (!row) throw new NotFoundException({ message: 'Order not found' });
    const [proforma] = await this.db.select({ number: documents.number }).from(documents).where(and(eq(documents.orderId, orderId), eq(documents.type, 'proforma'), sql`${documents.supersededById} is null`)).orderBy(desc(documents.createdAt)).limit(1);
    const [company, bank] = await Promise.all([this.settings.get('company'), this.settings.get('bank')]);
    const lang = row.c.proformaLanguage;
    const owed = Math.max(0, row.o.totalCents - row.o.paidCents - row.o.creditedCents);
    const days = lateDays(row.o.paymentDueOn, owed, row.o.status, isoDate());
    const doc = proforma?.number ?? row.o.number;
    if (lang === 'bg') {
      return {
        to: row.c.invoiceEmail,
        subject: `Напомняне за плащане · ${doc}`,
        message: [
          `Здравейте, ${row.c.contactName},`,
          '',
          `Напомняме за плащането по ${doc} (поръчка ${row.o.number}) на стойност ${formatMoney(owed, 'bg')}${row.o.paymentDueOn ? `, с падеж ${formatDate(row.o.paymentDueOn, 'bg')}` : ''}${days ? ` (${days} дни просрочие)` : ''}.`,
          `IBAN ${bank.iban} · BIC ${bank.bic} · Основание: ${doc}`,
          '',
          'Ако вече сте платили, моля, изпратете ни потвърждение.',
          '',
          `${row.agentName}, ${company.name}`,
        ].join('\n'),
      };
    }
    return {
      to: row.c.invoiceEmail,
      subject: `Payment reminder · ${doc}`,
      message: [
        `Hello ${row.c.contactName},`,
        '',
        `This is a reminder about ${doc} (order ${row.o.number}) for ${formatMoney(owed, 'en')}${row.o.paymentDueOn ? `, due ${formatDate(row.o.paymentDueOn, 'en')}` : ''}${days ? ` (${days} days late)` : ''}.`,
        `IBAN ${bank.iban} · BIC ${bank.bic} · Reference: ${doc}`,
        '',
        'If you have already paid, please send us the confirmation.',
        '',
        `${row.agentName}, ${company.name}`,
      ].join('\n'),
    };
  }

  /** The agent is copied on every reminder (FR-COLL-3). */
  async send(auth: AuthContext, orderId: string, subject: string, message: string) {
    const [row] = await this.db
      .select({ o: orders, c: customers, agentEmail: users.email })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .innerJoin(users, eq(users.id, orders.agentId))
      .where(and(eq(orders.id, orderId), orderScope(auth)));
    if (!row) throw new NotFoundException({ message: 'Order not found' });
    await this.db.insert(collectionReminders).values({ orderId, sentById: auth.user.id, subject, message });
    await this.mail.send({ kind: 'payment_reminder', to: [row.c.invoiceEmail], cc: [row.agentEmail], subject, body: message, recordType: 'order', recordId: orderId });
    await this.audit.log(auth, { category: 'payments', action: 'reminder_sent', recordType: 'order', recordId: orderId, recordLabel: row.o.number, meta: { to: row.c.invoiceEmail, subject } });
    return { ok: true };
  }
}
