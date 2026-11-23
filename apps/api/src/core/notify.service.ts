import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { formatDate, formatMoney, type SystemRole } from '@ananda/shared';
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

/** Longest free text (a reason, a message, a document description) kept on a notification row. */
export const NOTIFY_TEXT_MAX = 500;

interface FieldTypes {
  /** A name, number, code or id. */
  string: string;
  /** Words typed by a person (a reason, a message): capped at NOTIFY_TEXT_MAX when stored. */
  text: string;
  number: number;
  yesno: 'yes' | 'no';
  payNext: 'waiting' | 'ready' | 'paid';
}
const S = 'string', T = 'text', N = 'number', YN = 'yesno', PN = 'payNext';

/**
 * The data each kind carries: field name -> type. One contract for the callers (`send` is typed by it),
 * the stored row (only these fields, free text capped) and the web messages (`common.notify.<kind>` may
 * only use these names; test/notify-data.test.mts checks it). Money is `...Cents`, dates ISO `YYYY-MM-DD`.
 */
export const NOTIFY_DATA = {
  customer_approval: { broker: S, customer: S, vatValid: YN },
  special_price_request: { order: S, reason: T },
  correction_request: { order: S, reason: T },
  /** doc: English label or the broker's own description; docKind: purchase_order | signed_order | payment_proof | delivery | other | custom */
  broker_upload: { broker: S, doc: T, docKind: S, order: S, customer: S },
  broker_signed: { broker: S },
  delivered: { order: S },
  delivered_back: { order: S, returned: N },
  part_delivered: { order: S, stays: N },
  purchase_late: { purchase: S, days: N, supplier: S, waiting: N },
  stock_arrived: { purchase: S, count: N, orders: S },
  stock_count: { name: S, total: N },
  iban_changed: { admin: S, last4: S, hasIban: YN },
  payment_confirmed: { order: S, customer: S, amountCents: N },
  payment: { order: S, next: PN },
  payment_late: { customer: S, days: N, order: S, amountCents: N },
  part_delivery_unpaid: { order: S, customer: S, amountCents: N, delivered: N, total: N },
  upload_opened: { doc: T, docKind: S, order: S, customer: S },
  commission_paid: { amountCents: N, order: S, customer: S },
  commission_paid_undone: {},
  sent_for_approval: { customer: S },
  commission_sent: { amountCents: N },
  broker_setup_done: { admin: S },
  event: { event: S, startsOn: S, endsOn: S, place: S },
  customer_assigned: { customer: S },
  customer_assigned_until: { customer: S, until: S },
  customer_moved: { customer: S, broker: S, hasBroker: YN },
  customer_moved_undone: { customer: S },
  customer_assigned_undone: { customer: S },
  ownership_expiring: { customer: S, days: N, until: S, lastOrderOn: S, hasLastOrder: YN },
  broker_changed: { order: S, customer: S, broker: S, hasBroker: YN },
  order_corrected: { order: S, reason: T },
  /** reason: a code from REASONS.cancel */
  cancelled: { order: S, reason: S },
  cancelled_warehouse: { order: S },
  cancel_undone: { order: S },
  allocated: { order: S },
  hold_released: { order: S },
  proforma_expired: { order: S },
  to_ship: { order: S },
  to_ship_again: { order: S },
  /** kind: new_customer | special_price | correction */
  approved: { label: S, kind: S },
  /** reason: a code, why: its English words, message: the Admin's own words ('' none) */
  declined: { label: S, kind: S, reason: S, why: T, message: T, hasMessage: YN },
  waiting_again: { label: S },
} as const satisfies Record<string, Record<string, keyof FieldTypes>>;

export type NotifyKind = keyof typeof NOTIFY_DATA;
export type NotifyData = { -readonly [K in NotifyKind]: { -readonly [F in keyof (typeof NOTIFY_DATA)[K]]: FieldTypes[(typeof NOTIFY_DATA)[K][F] & keyof FieldTypes] } };

/** What is stored: only the fields the kind declares, free text capped. */
export function cleanNotifyData<K extends NotifyKind>(kind: K, data: NotifyData[K]): NotifyData[K] {
  const fields = NOTIFY_DATA[kind] as Record<string, keyof FieldTypes>;
  const out: Record<string, string | number> = {};
  for (const [name, type] of Object.entries(fields)) {
    const v = (data as Record<string, string | number | undefined>)[name];
    if (v === undefined) continue;
    out[name] = type === 'text' ? String(v).slice(0, NOTIFY_TEXT_MAX) : v;
  }
  return out as NotifyData[K];
}

/**
 * Notification kinds shown in the header tray (prototype 10 Nov: grouped Today / Yesterday / Earlier).
 * Each has an icon and colour in the web (components/shell/notifications.tsx) and EN/BG/HE text in
 * messages common.notify.<kind>. The English text here is what is stored as the fallback.
 */
export const NOTIFY_KINDS: { [K in NotifyKind]: { title: (d: NotifyData[K]) => string; body: (d: NotifyData[K]) => string } } = {
  /** Admin: a broker wants to add a customer. data: broker, customer, vatValid ('yes' | 'no') */
  customer_approval: { title: (d) => `${d.broker} wants to add ${d.customer}`, body: (d) => (d.vatValid === 'yes' ? 'New customer · VAT valid' : 'New customer') },
  /** Admin: a broker asks for a special price. data: order, reason (the broker's words) */
  special_price_request: { title: (d) => `Special price for ${d.order}`, body: (d) => String(d.reason) },
  /** Admin: a broker asks for a correction. data: order, reason (the broker's words) */
  correction_request: { title: (d) => `Correction for ${d.order}`, body: (d) => String(d.reason) },
  /** Admin: a broker uploaded a document on an order. data: broker, doc (English label), docKind (purchase_order | signed_order | payment_proof | delivery | other), order, customer */
  broker_upload: { title: (d) => `${d.broker} uploaded ${String(d.doc).toLowerCase().startsWith('a') ? 'an' : 'a'} ${String(d.doc).toLowerCase()}`, body: (d) => `${d.order} · ${d.customer}` },
  /** Admin: a new broker signed the broker agreement and waits to be countersigned. data: broker */
  broker_signed: { title: (d) => `${d.broker} signed the agreement`, body: () => 'Company and bank details are in. Countersign to finish their set-up.' },
  /** Admin + broker: delivered with the signed note. data: order */
  delivered: { title: (d) => `${d.order} delivered`, body: () => '' },
  /** Admin + broker: delivered, part came back. data: order, returned (cartons) */
  delivered_back: { title: (d) => `${d.order} delivered in part · ${d.returned} cartons back`, body: () => '' },
  /** Admin + broker: part delivered, the rest still to ship. data: order, stays (cartons) */
  part_delivered: { title: (d) => `${d.order} part delivered · ${d.stays} cartons still to ship`, body: () => '' },
  /** Admin: a purchase is late. data: purchase, days, supplier, waiting (orders waiting for it) */
  purchase_late: { title: (d) => `${d.purchase} is ${plural(d.days, 'day')} late`, body: (d) => (Number(d.waiting) > 0 ? `${d.supplier} · ${plural(d.waiting, 'order')} waiting for this stock` : String(d.supplier)) },
  /** Admin: a purchase arrived and orders can be allocated. data: purchase, count, orders (numbers, comma separated) */
  stock_arrived: { title: (d) => `${d.purchase} received · ${plural(d.count, 'order')} can be allocated`, body: (d) => String(d.orders) },
  /** Admin: the warehouse sent a stock count. data: name, total (cartons) */
  stock_count: { title: (d) => `Stock count from ${d.name}`, body: (d) => `${d.total} full cartons counted` },
  /** Admin: a broker's IBAN change on proformas. data: admin, last4, hasIban ('yes' | 'no') */
  iban_changed: { title: (d) => `${d.admin} changed the IBAN on proformas`, body: (d) => (d.hasIban === 'yes' ? `New IBAN …${d.last4}` : 'The IBAN was removed') },
  /** Admin + broker: payment confirmed. data: order, customer, amountCents */
  payment_confirmed: { title: (d) => `Payment confirmed for ${d.order}`, body: (d) => `${d.customer} · ${eur(d.amountCents)}` },
  /** Broker: an order is paid in full. data: order, next ('waiting' | 'ready' | 'paid') */
  payment: { title: (d) => `${d.order} is paid`, body: (d) => (d.next === 'waiting' ? 'Waiting for stock' : d.next === 'ready' ? 'Ready to send' : 'Paid in full') },
  /** Broker: a customer is late paying. data: customer, days, order, amountCents */
  payment_late: { title: (d) => `${d.customer} is ${plural(d.days, 'day')} late`, body: (d) => `${eur(d.amountCents)} owed on ${d.order}` },
  /** Broker: an order was delivered in part and still has an unpaid balance. data: order, customer, amountCents, delivered, total */
  part_delivery_unpaid: { title: (d) => `${d.order} is part delivered and not paid`, body: (d) => `${d.customer} · ${eur(d.amountCents)} owed · ${d.delivered} of ${plural(d.total, 'carton')} delivered` },
  /** Broker: the Admin opened the broker's upload. data: doc, docKind, order, customer */
  upload_opened: { title: () => 'The Admin opened your upload', body: (d) => `${d.doc} · ${d.order} · ${d.customer}` },
  /** Broker: commission paid. data: amountCents, order, customer */
  commission_paid: { title: (d) => `Commission paid: ${eur(d.amountCents)}`, body: (d) => `${d.order} · ${d.customer}. It's on its way to your bank.` },
  /** Broker: a commission payment was taken back. data: none */
  commission_paid_undone: { title: () => 'Commission marked paid by mistake', body: () => 'It is not paid yet. You will see it as paid once it leaves the bank.' },
  /** Broker: their new customer went to the Admin. data: customer */
  sent_for_approval: { title: (d) => `${d.customer} sent for approval`, body: () => "An Admin reviews it. You'll hear back here." },
  /** Broker: commission sent to the accountant to pay. data: amountCents */
  commission_sent: { title: (d) => `Commission sent to pay: ${eur(d.amountCents)}`, body: () => 'With the accountant. You will see it as paid once it leaves the bank.' },
  /** Broker: an Admin countersigned the broker agreement. data: admin */
  broker_setup_done: { title: () => 'Your set-up is finished', body: (d) => `${d.admin} countersigned your broker agreement.` },
  /** Broker: invited to an event. data: event, startsOn, endsOn (YYYY-MM-DD, shown per language), place */
  event: { title: (d) => `You are invited to ${d.event}`, body: (d) => `${d.startsOn} – ${d.endsOn}, ${d.place}` },
  /** Broker: an Admin added a customer for them. data: customer */
  customer_assigned: { title: (d) => `${d.customer} is now yours`, body: () => 'Added by an Admin. You can start a sale.' },
  /** Broker: a customer was moved to them. data: customer, until (YYYY-MM-DD) */
  customer_assigned_until: { title: (d) => `${d.customer} is now yours`, body: (d) => `Yours until ${d.until}, and longer with each order.` },
  /** Broker: their customer moved to another broker (or none). data: customer, broker ('' for none), hasBroker ('yes' | 'no') */
  customer_moved: { title: (d) => `${d.customer} moved to ${d.hasBroker === 'yes' ? d.broker : 'no broker'}`, body: () => 'Open orders stay with you.' },
  /** Broker: a customer move was undone. data: customer */
  customer_moved_undone: { title: (d) => `${d.customer} is no longer yours`, body: () => 'The move was undone.' },
  customer_assigned_undone: { title: (d) => `${d.customer} is yours again`, body: () => 'The move was undone.' },
  /** Broker: ownership of a customer ends soon. data: customer, days, until (YYYY-MM-DD), lastOrderOn (YYYY-MM-DD or ''), hasLastOrder ('yes' | 'no') */
  ownership_expiring: {
    title: (d) => `${plural(d.days, 'day')} left with ${d.customer}`,
    body: (d) => `${d.hasLastOrder === 'yes' ? `No order since ${fmtDate(d.lastOrderOn)}. ` : ''}If ${d.customer} doesn't order by ${fmtDate(d.until)}, it becomes free for any broker to claim.`,
  },
  /** Broker: an order of their customer went to another broker. data: order, customer, broker ('' unknown), hasBroker */
  broker_changed: { title: (d) => `${d.order} for ${d.customer} went to ${d.hasBroker === 'yes' ? d.broker : 'another broker'}`, body: () => 'The commission on this order goes to them.' },
  /** Broker: an order was corrected by someone else. data: order, reason (their words) */
  order_corrected: { title: (d) => `${d.order} was corrected`, body: (d) => String(d.reason) },
  /** Broker: an order was cancelled by someone else. data: order, reason (a code from REASONS.cancel) */
  cancelled: { title: (d) => `${d.order} was cancelled`, body: (d) => String(d.reason) },
  /** Warehouse: nothing to ship any more. data: order */
  cancelled_warehouse: { title: (d) => `${d.order} was cancelled`, body: () => 'Nothing to ship for this order.' },
  /** Broker: a cancel was undone. data: order */
  cancel_undone: { title: (d) => `${d.order} is open again`, body: () => 'The cancel was undone.' },
  /** Broker: a waiting order got its stock. data: order */
  allocated: { title: (d) => `${d.order} has stock`, body: () => 'Paid · ready to send' },
  /** Broker: the stock hold ran out. data: order */
  hold_released: { title: (d) => `Stock hold on ${d.order} released`, body: () => 'The payment did not arrive in time. The order stays open.' },
  /** Broker: the proforma expired. data: order */
  proforma_expired: { title: (d) => `Proforma for ${d.order} expired`, body: () => 'Follow up with the customer.' },
  /** Warehouse: an order is ready to ship. data: order */
  to_ship: { title: (d) => `${d.order} to ship`, body: () => '' },
  /** Warehouse: deliver again after a part delivery. data: order */
  to_ship_again: { title: (d) => `${d.order} to deliver again`, body: () => '' },
  /** Broker: an Admin approved a request. data: label (customer or order), kind (new_customer | special_price | correction) */
  approved: {
    title: (d) => `Approved: ${d.label}`,
    body: (d) => (d.kind === 'new_customer' ? 'You can start a sale.' : d.kind === 'special_price' ? 'The proforma will use the approved price.' : 'The customer received the corrected proforma.'),
  },
  /** Broker: an Admin declined a request. data: label, kind, reason (code), why (English reason), message ('' none), hasMessage */
  declined: { title: (d) => `Declined: ${d.label}`, body: (d) => [d.why, d.message].filter(Boolean).join(' · ') },
  /** Broker: the Admin took a decision back. data: label */
  waiting_again: { title: (d) => `Waiting again: ${d.label}`, body: () => 'The Admin took the decision back. You will hear again soon.' },
};

const plural = (n: string | number, word: string) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`;
const eur = (c: string | number | undefined) => formatMoney(Number(c ?? 0), 'en');
const fmtDate = (v: string | number | undefined) => formatDate(String(v ?? ''), 'en');

/** The English title and body of a kind (what is stored as the fallback, and what e-mails use). */
export function notifyText<K extends NotifyKind>(kind: K, data: NotifyData[K]) {
  const k = NOTIFY_KINDS[kind] as { title: (d: NotifyData[K]) => string; body: (d: NotifyData[K]) => string };
  return { title: k.title(data), body: k.body(data) };
}

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
  async send<K extends NotifyKind>(kind: K, to: { users?: (string | null | undefined)[]; roles?: SystemRole[] }, data: NotifyData[K], link?: string, tx: DbOrTx = this.db) {
    const clean = cleanNotifyData(kind, data);
    const { title, body } = notifyText(kind, clean);
    const n: NotificationInput = { type: kind, title, body: body || undefined, link, data: clean as Record<string, string | number> };
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
