import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { formatMoney, type SystemRole } from '@ananda/shared';
import { InjectDb, type Db, type DbOrTx } from '../db/db.module';
import { notifications, roles, users } from '../db/schema';
import { RealtimeService } from './realtime.service';

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Values for the translated text (web messages common.notify.<type>.title/body). Money as `...Cents`. */
  data?: Record<string, string | number>;
}

/**
 * Notification kinds shown in the header tray (prototype 10 Nov: grouped Today / Yesterday / Earlier).
 * Each has an icon and colour in the web (components/shell/notifications.tsx) and EN/BG/HE text in
 * messages common.notify.<kind>. The English text here is what is stored as the fallback.
 */
export const NOTIFY_KINDS = {
  /** Admin: a broker wants to add a customer. data: broker, customer */
  customer_approval: { title: (d: D) => `${d.broker} wants to add ${d.customer}`, body: (d: D) => (d.vatValid ? 'New customer · VAT valid' : 'New customer') },
  /** Admin: a broker asks for a special price. data: broker, order, customer, priceCents?, listPriceCents? */
  special_price: { title: (d: D) => `${d.broker} asks for a special price`, body: (d: D) => (d.priceCents != null && d.listPriceCents != null ? `${d.order} · ${eur(d.priceCents)} instead of ${eur(d.listPriceCents)}` : `${d.order} · ${d.customer}`) },
  /** Admin: a broker asks for a correction. data: broker, order, customer */
  correction: { title: (d: D) => `${d.broker} asks for a correction`, body: (d: D) => `${d.order} · ${d.customer}` },
  /** Admin: a broker uploaded a document on an order. data: broker, doc (label), order, customer */
  broker_upload: { title: (d: D) => `${d.broker} uploaded ${String(d.doc).toLowerCase().startsWith('a') ? 'an' : 'a'} ${String(d.doc).toLowerCase()}`, body: (d: D) => `${d.order} · ${d.customer}` },
  /** Admin: a new broker signed the broker agreement and waits to be countersigned. data: broker */
  broker_signed: { title: (d: D) => `${d.broker} signed the broker agreement`, body: () => 'Company and bank details are in. Countersign to finish their set-up.' },
  /** Admin + broker: delivered with the signed note. data: order, customer */
  delivered: { title: (d: D) => (d.customer ? `${d.order} delivered to ${d.customer}` : `${d.order} delivered`), body: () => 'The warehouse uploaded the signed note.' },
  /** Admin: a purchase is late. data: purchase, days, supplier, waiting (orders waiting for it) */
  purchase_late: { title: (d: D) => `${d.purchase} is ${plural(d.days, 'day')} late`, body: (d: D) => (Number(d.waiting) > 0 ? `${d.supplier} · ${plural(d.waiting, 'order')} waiting for this stock` : String(d.supplier)) },
  /** Admin + broker: payment confirmed. data: order, customer, amountCents */
  payment_confirmed: { title: (d: D) => `Payment confirmed for ${d.order}`, body: (d: D) => `${d.customer} · ${eur(d.amountCents)}` },
  /** Broker: a customer is late paying. data: customer, days, order, amountCents */
  payment_late: { title: (d: D) => `${d.customer} is ${plural(d.days, 'day')} late`, body: (d: D) => `${eur(d.amountCents)} owed on ${d.order}` },
  /** Broker: the Admin opened the broker's upload. data: doc, order, customer */
  upload_opened: { title: () => 'The Admin opened your upload', body: (d: D) => `${d.doc} · ${d.order} · ${d.customer}` },
  /** Broker: commission paid. data: amountCents, order, customer */
  commission_paid: { title: (d: D) => `Commission paid: ${eur(d.amountCents)}`, body: (d: D) => `${d.order} · ${d.customer}. It's on its way to your bank.` },
  /** Broker: their new customer went to the Admin. data: customer */
  sent_for_approval: { title: (d: D) => `${d.customer} sent for approval`, body: () => "An Admin reviews it. You'll hear back here." },
  /** Broker: commission sent to the accountant to pay. data: amountCents */
  commission_sent: { title: (d: D) => `Commission sent to pay: ${eur(d.amountCents)}`, body: () => 'With the accountant. You will see it as paid once it leaves the bank.' },
  /** Broker: an Admin countersigned the broker agreement. data: admin */
  broker_setup_done: { title: () => 'Your set-up is finished', body: (d: D) => `${d.admin} countersigned your broker agreement.` },
  /** Broker: invited to an event. data: event, startsOn, endsOn (YYYY-MM-DD, shown per language), place */
  event: { title: (d: D) => `You are invited to ${d.event}`, body: (d: D) => `${d.startsOn} – ${d.endsOn}, ${d.place}` },
} as const;

type D = Record<string, string | number>;
export type NotifyKind = keyof typeof NOTIFY_KINDS;
const plural = (n: string | number, word: string) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;
const eur = (c: string | number | undefined) => formatMoney(Number(c ?? 0), 'en');

/** In-app notifications inbox (header tray / phone bell with unread count). */
@Injectable()
export class NotifyService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly realtime: RealtimeService,
  ) {}

  async toUsers(userIds: (string | null | undefined)[], n: NotificationInput, tx: DbOrTx = this.db) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    await tx.insert(notifications).values(ids.map((userId) => ({ userId, ...n })));
    ids.forEach((id) => this.realtime.emit(['notifications', 'badges'], id));
  }

  async toRoles(baseRoles: SystemRole[], n: NotificationInput, tx: DbOrTx = this.db) {
    const ids = await this.userIdsWithRoles(baseRoles, tx);
    await this.toUsers(ids, n, tx);
  }

  /**
   * One of the kinds above, to users and/or roles, e.g.
   * `notify.send('broker_upload', { roles: ['system_admin', 'admin'] }, { broker, doc: 'Purchase order', order: 'S-0008', customer }, '/sales/<id>', tx)`.
   */
  async send(kind: NotifyKind, to: { users?: (string | null | undefined)[]; roles?: SystemRole[] }, data: D, link?: string, tx: DbOrTx = this.db) {
    const k = NOTIFY_KINDS[kind] as { title: (d: D) => string; body: (d: D) => string };
    const n: NotificationInput = { type: kind, title: k.title(data), body: k.body(data), link, data };
    const ids = [...(to.users ?? []), ...(to.roles?.length ? await this.userIdsWithRoles(to.roles, tx) : [])];
    await this.toUsers(ids, n, tx);
  }

  async userIdsWithRoles(baseRoles: SystemRole[], tx: DbOrTx = this.db): Promise<string[]> {
    const rows = await tx
      .select({ id: users.id })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(inArray(roles.baseRole, baseRoles), eq(users.status, 'active')));
    return rows.map((r) => r.id);
  }

  async emailsWithRoles(baseRoles: SystemRole[], tx: DbOrTx = this.db): Promise<string[]> {
    const rows = await tx
      .select({ email: users.email })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(and(inArray(roles.baseRole, baseRoles), eq(users.status, 'active')));
    return rows.map((r) => r.email);
  }
}
