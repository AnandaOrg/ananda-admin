'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { formatDate, formatDateShort, formatMoney, type Locale } from '@ananda/shared';
import { iso } from '@/lib/format';
import {
  Bell,
  CalendarBlank,
  Check,
  CheckCircle,
  Clock,
  Coins,
  Eye,
  FileText,
  Gear,
  Icon,
  NotePencil,
  Package,
  Signature,
  Tag,
  TrendDown,
  Truck,
  UserPlus,
  Users,
  X,
} from '../ui/icon';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  data?: Record<string, string | number> | null;
}

type Tone = '' | 'good' | 'warn' | 'bad' | 'blue' | 'hl';

/** Icon and colour per kind (NotifyService kinds; older rows fall back on their title). */
const KIND: Record<string, [PhosphorIcon, Tone]> = {
  customer_approval: [UserPlus, 'blue'],
  sent_for_approval: [UserPlus, 'blue'],
  special_price: [Tag, 'warn'],
  correction: [NotePencil, 'warn'],
  broker_upload: [FileText, 'hl'],
  broker_signed: [Signature, 'good'],
  broker_agreement: [Signature, 'good'],
  broker_setup_done: [CheckCircle, 'good'],
  upload_opened: [Eye, 'blue'],
  delivered: [Truck, ''],
  to_ship: [Package, ''],
  purchase_late: [Clock, 'bad'],
  payment_late: [Clock, 'bad'],
  part_delivery_unpaid: [Clock, 'warn'],
  payment: [Coins, 'good'],
  payment_confirmed: [Coins, 'good'],
  commission_paid: [Coins, 'good'],
  commission_sent: [Coins, 'blue'],
  approved: [CheckCircle, 'good'],
  declined: [X, 'bad'],
  cancelled: [X, 'bad'],
  allocated: [Package, 'good'],
  hold_released: [Clock, 'warn'],
  proforma_expired: [Clock, 'warn'],
  ownership_expiring: [Clock, 'warn'],
  event: [CalendarBlank, 'blue'],
  stock_count: [Package, ''],
  stock_low: [TrendDown, 'warn'],
  customer_assigned: [UserPlus, 'blue'],
  customer_assigned_until: [UserPlus, 'blue'],
  customer_assigned_undone: [UserPlus, 'blue'],
  customer_moved: [Users, ''],
  customer_moved_undone: [Users, ''],
  broker_changed: [Users, ''],
  special_price_request: [Tag, 'warn'],
  correction_request: [NotePencil, 'warn'],
  order_corrected: [NotePencil, 'warn'],
  delivered_back: [Truck, 'warn'],
  part_delivered: [Truck, 'warn'],
  to_ship_again: [Package, ''],
  cancelled_warehouse: [X, 'bad'],
  cancel_undone: [CheckCircle, 'good'],
  commission_paid_undone: [Coins, 'warn'],
  iban_changed: [Gear, 'warn'],
  stock_arrived: [Package, 'good'],
  waiting_again: [Clock, 'warn'],
};

function kindOf(n: Notification): string {
  if (n.type !== 'approval') return n.type;
  if (/^special price/i.test(n.title)) return 'special_price';
  if (/^correction/i.test(n.title)) return 'correction';
  return 'customer_approval';
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

type Data = Record<string, string | number>;
type Translate = ReturnType<typeof useTranslations>;

/**
 * Per kind, next to the catalog: how stored `data` becomes the message's inputs.
 *  - `legacy` makes rows written before the kind's data changed read like new ones (Production still holds them).
 *  - `words` puts codes (reasons, upload kinds) into the reader's language; `plain` lists the inputs that are
 *    already translated phrases (not wrapped for right-to-left).
 * A kind with neither needs nothing: its data goes straight into the message.
 */
interface KindRules {
  legacy?: (d: Data) => Data;
  words?: (a: { t: Translate; locale: Locale; data: Data; vals: Data }) => void;
  plain?: string[];
}

/** English labels the API stored in `doc` before `docKind` existed (broker_upload: short name, upload_opened: document label). */
const DOC_KIND_BY_LABEL: Record<string, string> = {
  'Purchase order': 'purchase_order',
  'Signed order': 'signed_order',
  'Proof of payment': 'payment_proof',
  'Delivery photo': 'delivery',
  Document: 'other',
  "Customer's purchase order": 'purchase_order',
  'Signed order or agreement': 'signed_order',
  'Delivery photo or signed note': 'delivery',
  'Something else': 'other',
};
const withDocKind = (d: Data): Data => (d.docKind ? d : { ...d, docKind: DOC_KIND_BY_LABEL[String(d.doc ?? '')] ?? 'custom' });

const KIND_RULES: Record<string, KindRules> = {
  // Old rows: `vatValid` was the number 1, or missing, instead of 'yes' / 'no'.
  customer_approval: { legacy: (d) => ({ ...d, vatValid: [1, '1', 'yes', 'true'].includes(d.vatValid as string | number) ? 'yes' : 'no' }) },
  cancelled: {
    words: ({ t, data, vals }) => {
      const reason = String(data.reason ?? '');
      if (t.has(`reasons.cancel.${reason}`)) vals.reason = t(`reasons.cancel.${reason}`);
    },
  },
  declined: {
    words: ({ t, data, vals }) => {
      const reason = String(data.reason ?? '');
      vals.why = t.has(`notify.why.${data.kind}.${reason}`) ? t(`notify.why.${data.kind}.${reason}`) : String(data.why ?? reason);
    },
  },
  upload_opened: {
    legacy: withDocKind,
    words: ({ t, data, vals }) => {
      if (t.has(`notify.docs.${data.docKind}`)) vals.doc = t(`notify.docs.${data.docKind}`);
    },
  },
  broker_upload: {
    legacy: withDocKind,
    plain: ['docPhrase'],
    words: ({ t, locale, data, vals }) => {
      const doc = String(data.doc ?? '').toLowerCase();
      vals.docPhrase = t.has(`notify.docsA.${data.docKind}`) ? t(`notify.docsA.${data.docKind}`) : locale === 'en' ? `${doc.startsWith('a') ? 'an' : 'a'} ${doc}` : doc;
    },
  },
};

/** The switches (`{name, select, ...}`) a message uses: matched, never shown, so never wrapped for right-to-left. */
const selectNames = (message: unknown) => (typeof message === 'string' ? [...message.matchAll(/\{(\w+),\s*select\b/g)].map((m) => m[1]) : []);

/**
 * The reader's text for a notification that carries structured data: money (`...Cents`) and ISO dates
 * in the reader's number style, codes (reasons, upload kinds) in the reader's words, and in Hebrew every
 * value isolated so order numbers, names and amounts stay left-to-right.
 */
export function notifyText(t: Translate, locale: Locale, n: Notification, key: string): string {
  const rules = KIND_RULES[n.type];
  const data = rules?.legacy ? rules.legacy(n.data ?? {}) : (n.data ?? {});
  const vals: Data = {};
  for (const [k, v] of Object.entries(data)) {
    vals[k] = v;
    if (k.endsWith('Cents')) vals[k.slice(0, -5) || 'amount'] = formatMoney(Number(v), locale);
    else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) vals[k] = formatDate(v, locale);
  }
  const control = new Set(selectNames(t.raw(key)));
  for (const f of control) vals[f] ??= 'no';
  rules?.words?.({ t, locale, data, vals });
  if (locale === 'he') {
    const plain = new Set(rules?.plain);
    for (const [k, v] of Object.entries(vals)) if (typeof v === 'string' && v && !control.has(k) && !plain.has(k)) vals[k] = iso(v);
  }
  return t(key, vals);
}

/**
 * Notifications list (desktop popover under the tray, phone sheet from the bell): grouped Today /
 * Yesterday / Earlier, All / Unread, "Mark all as read", "You're all caught up", empty state.
 */
export function NotificationsBody({
  items,
  loading,
  locale,
  phone,
  isAdmin,
  onOpen,
  onMarkAll,
  onClose,
}: {
  items: Notification[];
  loading: boolean;
  locale: Locale;
  phone?: boolean;
  isAdmin: boolean;
  onOpen: (n: Notification) => void;
  onMarkAll: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('common');
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const un = items.filter((n) => !n.readAt).length;
  const list = tab === 'unread' ? items.filter((n) => !n.readAt) : items;
  const now = new Date();
  const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const groups: [string, Notification[]][] = (
    [
      ['today', list.filter((n) => sameDay(new Date(n.createdAt), now))],
      ['yesterday', list.filter((n) => sameDay(new Date(n.createdAt), yest))],
      ['earlier', list.filter((n) => { const d = new Date(n.createdAt); return !sameDay(d, now) && !sameDay(d, yest); })],
    ] as [string, Notification[]][]
  ).filter((g) => g[1].length);
  const text = (n: Notification, part: 'title' | 'body') => {
    const key = `notify.${n.type}.${part}`;
    if (n.data && t.has(key)) return notifyText(t, locale, n, key);
    // Older rows have no data: show the English that was stored with them.
    return part === 'title' ? n.title : (n.body ?? '');
  };
  const markAll = (
    <button type="button" className="nt-link" onClick={onMarkAll}>
      {t('notifications.markAll')}
    </button>
  );
  return (
    <>
      {phone && <span className="an-grab" />}
      <div className="nt-h">
        <b id="nt-title">{t('notifications.title')}</b>
        {phone ? (
          <button type="button" className="cal-ib big" aria-label={t('close')} onClick={onClose}>
            <Icon as={X} />
          </button>
        ) : (
          un > 0 && markAll
        )}
      </div>
      <div className="nt-tabs" role="group">
        <button type="button" className="an-tabx" aria-pressed={tab === 'all'} onClick={() => setTab('all')}>
          {t('notifications.all')}
        </button>
        <button type="button" className="an-tabx" aria-pressed={tab === 'unread'} onClick={() => setTab('unread')}>
          {t('notifications.unread')}
          {un > 0 && <span className="n">{un}</span>}
        </button>
        {phone && un > 0 && markAll}
      </div>
      <div className="nt-list">
        {loading && !items.length ? (
          <div className="nt-empty">
            <span className="an-spin" aria-hidden />
          </div>
        ) : !items.length ? (
          <div className="nt-empty">
            <span className="ei">
              <Icon as={Bell} size="lg" />
            </span>
            <b>{t('notifications.emptyTitle')}</b>
            <span>{t(isAdmin ? 'notifications.emptyAdmin' : 'notifications.emptyBroker')}</span>
          </div>
        ) : !list.length ? (
          <div className="nt-empty">
            <span className="ei done">
              <Icon as={Check} size="lg" />
            </span>
            <b>{t('notifications.caughtUp')}</b>
            <span>{t('notifications.caughtUpText')}</span>
          </div>
        ) : (
          groups.map(([g, xs]) => (
            <div key={g} role="group" aria-label={t(`notifications.${g}`)}>
              <div className="nt-g">{t(`notifications.${g}`)}</div>
              {xs.map((n) => {
                const [ic, tone] = KIND[kindOf(n)] ?? [Bell, ''];
                const d = new Date(n.createdAt);
                const body = text(n, 'body');
                return (
                  <button key={n.id} type="button" className={`nt-n ${n.readAt ? 'read' : ''}`} onClick={() => onOpen(n)}>
                    <span className={`ni ${tone}`}>
                      <Icon as={ic} />
                    </span>
                    <span>
                      <b>{text(n, 'title')}</b>
                      {body && <small>{body}</small>}
                    </span>
                    <span className="tm">
                      {g === 'earlier' ? formatDateShort(d, locale) : hm(d)}
                      {!n.readAt && <span className="dot" aria-label={t('notifications.unreadDot')} />}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="nt-f">
        <Link href="/profile" className="nt-link mute" onClick={onClose}>
          <Icon as={Gear} size="sm" />
          {t('notifications.settings')}
        </Link>
        {items.length > 0 && <span className="nt-help">{un ? t('notifications.unreadCount', { n: un }) : t('notifications.allRead')}</span>}
      </div>
    </>
  );
}
