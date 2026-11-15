import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { isoDate } from '@ananda/shared';
import { InjectDb, type Db } from '../db/db.module';
import { customers, notifications, orders, purchases, suppliers } from '../db/schema';
import { NotifyService } from '../core/notify.service';
import { OWED_STATUSES, outstandingSql } from '../core/figures.service';

const days = (d: string) => Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));

/**
 * Daily notifications for things that became late (prototype tray: "P-0003 is 34 days late",
 * "Sofia Rooftop Bar is 8 days late"). Each record is notified at most once a week, so the tray
 * doesn't fill up with the same line.
 */
@Injectable()
export class LateAlertsService {
  private readonly log = new Logger('LateAlerts');
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly notify: NotifyService,
  ) {}

  /** Local and Docker: every morning. On Vercel: GET /api/cron/late (vercel.json). */
  @Cron('0 8 * * *')
  async scheduled() {
    if (process.env.VERCEL) return;
    try {
      await this.run();
    } catch (e) {
      this.log.error(e);
    }
  }

  private async recentlySent(type: string, link: string) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.type, type), eq(notifications.link, link), gte(notifications.createdAt, since)));
    return r.n > 0;
  }

  async run() {
    const today = isoDate();
    let sent = 0;
    // Purchases past their expected date and not received: to Admins.
    const late = await this.db
      .select({ id: purchases.id, number: purchases.number, expectedOn: purchases.expectedOn, supplier: suppliers.company })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .where(and(inArray(purchases.status, ['ordered', 'on_the_way']), lt(purchases.expectedOn, today)));
    if (late.length) {
      const [w] = await this.db.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.status, 'waiting_for_stock'));
      for (const p of late) {
        const link = `/purchasing/${p.id}`;
        if (await this.recentlySent('purchase_late', link)) continue;
        await this.notify.send('purchase_late', { roles: ['system_admin', 'admin'] }, { purchase: p.number, days: days(p.expectedOn), supplier: p.supplier, waiting: w.n }, link);
        sent++;
      }
    }
    // Customers past their payment due date: to their broker.
    const owed = await this.db
      .select({ id: orders.id, number: orders.number, brokerId: orders.brokerId, dueOn: orders.paymentDueOn, customer: customers.companyName, cents: sql<number>`${outstandingSql}::int` })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(and(inArray(orders.status, [...OWED_STATUSES]), lt(orders.paymentDueOn, today), sql`${outstandingSql} > 0`));
    for (const o of owed) {
      const link = `/sales/${o.id}`;
      if (!o.dueOn || (await this.recentlySent('payment_late', link))) continue;
      await this.notify.send('payment_late', { users: [o.brokerId] }, { customer: o.customer, days: days(o.dueOn), order: o.number, amountCents: Number(o.cents) }, link);
      sent++;
    }
    return { sent };
  }
}
