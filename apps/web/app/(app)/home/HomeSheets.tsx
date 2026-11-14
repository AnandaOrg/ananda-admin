'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { EmailDraft, type Draft } from '@/components/EmailDraft';
import { ActionError, Button, EnvelopeSimple, FileText, Icon, LoadError, Package, Phone, Pill, Sheet } from '@/components/ui';
import { PurchaseSheet } from '../purchasing/[id]/PurchaseSheets';
import { BankBalanceSheet, type CashOnHand } from '../money/_components/bank-balance-sheet';
import type { PurchaseDetail } from '../purchasing/_lib/types';
import type { Attention } from './types';
import s from './home.module.css';

const first = (name?: string | null) => (name ?? '').split(' ')[0];

/** Overdue invoices: oldest first; Call, or read a drafted reminder and send it. The agent is copied. */
export function OverdueSheet({ row, onClose }: { row: Attention | null; onClose: () => void }) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const { money, num } = useFmt();
  const [drafts, setDrafts] = useState<Record<string, { subject: string; message: string } | 'sent'>>({});
  const items = (row?.items ?? []) as { orderId: string; number: string; customerName: string; phone: string | null; agentName: string; outstandingCents: number; daysLate: number }[];
  const load = useAction((orderId: string) => api.get<{ subject: string; message: string }>(`/collections/${orderId}/reminder`).then((d) => ({ d, orderId })), {
    onDone: ({ d, orderId }) => setDrafts((x) => ({ ...x, [orderId]: d })),
    errorToast: true,
  });
  const send = useAction((orderId: string) => {
    const d = drafts[orderId];
    if (!d || d === 'sent') return Promise.resolve(orderId);
    return api.post(`/collections/${orderId}/reminder`, { subject: d.subject, message: d.message }).then(() => orderId);
  }, {
    success: t('overdue.sentToast'),
    onDone: (orderId) => setDrafts((x) => ({ ...x, [orderId]: 'sent' })),
  });
  const close = () => {
    setDrafts({});
    onClose();
  };
  return (
    <Sheet open={!!row} onClose={close} title={t('overdue.title', { n: items.length, amount: money(row?.cents ?? 0, true) })}>
      <div className={s.panel}>
        <p className={s.sub}>{t('overdue.sub')}</p>
        {items.map((o) => {
          const d = drafts[o.orderId];
          return (
            <div key={o.orderId} className={s.box}>
              <div className={s.tot}>
                <b>{o.customerName}</b>
                <b>
                  <bdi>{money(o.outstandingCents)}</bdi>
                </b>
              </div>
              <div className={s.tot}>
                <span className={s.m}>
                  <bdi>{o.number}</bdi> · {o.agentName}
                </span>
                <Pill tone="bad">{t('daysLate', { n: num(o.daysLate) })}</Pill>
              </div>
              {d === 'sent' ? (
                <span className={s.good}>{t('overdue.sent', { name: first(o.agentName) })}</span>
              ) : d ? (
                <>
                  <div className={s.draft}>{d.message}</div>
                  <div className={s.btns}>
                    <Button onClick={() => setDrafts((x) => ({ ...x, [o.orderId]: undefined as never }))}>{t('overdue.discard')}</Button>
                    <Button variant="primary" busy={send.busy && send.variables === o.orderId} onClick={() => send.mutate(o.orderId)}>
                      {t('overdue.send')}
                    </Button>
                  </div>
                  {send.variables === o.orderId && <ActionError action={send} />}
                </>
              ) : (
                <div className={s.btns}>
                  <a className={`an-btn secondary keep ${o.phone ? '' : 'disabled'}`} href={o.phone ? `tel:${o.phone}` : undefined} aria-disabled={!o.phone || undefined}>
                    <Icon as={Phone} size="sm" />
                    {tc('call')}
                  </a>
                  <Button icon={EnvelopeSimple} busy={load.busy && load.variables === o.orderId} onClick={() => load.mutate(o.orderId)}>
                    {t('overdue.reminder')}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Delivered, no invoice yet: only fully paid orders can be invoiced; one, or all paid ones at once. */
export function NoInvoiceSheet({ row, onClose }: { row: Attention | null; onClose: () => void }) {
  const t = useTranslations('home');
  const { dateShort } = useFmt();
  const [items, setItems] = useState<{ orderId: string; number: string; customerName: string | null; deliveredAt: string | null; paid: boolean }[]>([]);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);
  useEffect(() => {
    // Keep the list as it was when opened, so issued ones stay with an Invoiced tag.
    if (row) setItems((row.items ?? []) as typeof items);
    else {
      setItems([]);
      setDone({});
      setAll(false);
    }
  }, [row]);
  const one = useAction((id: string) => api.post(`/orders/${id}/invoice`).then(() => id), { success: t('noinv.issuedOne'), onDone: (id) => setDone((x) => ({ ...x, [id]: true })), errorToast: true });
  const ready = items.filter((x) => x.paid && !done[x.orderId]);
  const many = useAction(() => api.post<{ issued: string[] }>('/orders/invoice-all'), {
    success: (r) => t('issuedAll', { n: r.issued.length }),
    onDone: () => setDone((x) => ({ ...x, ...Object.fromEntries(ready.map((r) => [r.orderId, true])) })),
  });
  const left = items.length - Object.keys(done).length;
  const shown = all ? items : items.slice(0, 4);
  return (
    <Sheet open={!!row} onClose={onClose} title={t('noinv.title', { n: left })}>
      <div className={s.panel}>
        <p className={s.sub}>{t('noinv.sub')}</p>
        {row?.canIssue && ready.length > 1 && (
          <Button variant="primary" icon={FileText} busy={many.busy} onClick={() => many.mutate(undefined)}>
            {t('attention.issueAll', { n: ready.length })}
          </Button>
        )}
        <ActionError action={many} />
        {shown.map((o) => (
          <div key={o.orderId} className={s.prow} style={{ cursor: 'default', background: 'var(--surface-2)' }}>
            <b>{o.customerName ?? o.number}</b>
            <span className={s.r}>
              {done[o.orderId] ? (
                <Pill tone="good">{t('noinv.invoiced')}</Pill>
              ) : o.paid && row?.canIssue ? (
                <Button size="sm" busy={one.busy && one.variables === o.orderId} onClick={() => one.mutate(o.orderId)} writes>
                  {t('noinv.issue')}
                </Button>
              ) : (
                <Pill tone={o.paid ? 'good' : 'warn'}>{o.paid ? t('noinv.paid') : t('noinv.notPaid')}</Pill>
              )}
            </span>
            <span className={s.s}>
              <bdi>{o.number}</bdi>
              {o.deliveredAt && ` · ${t('noinv.delivered', { date: dateShort(o.deliveredAt) })}`}
            </span>
          </div>
        ))}
        {!all && items.length > 4 && <Button onClick={() => setAll(true)}>{t('noinv.more', { n: items.length - 4 })}</Button>}
      </div>
    </Sheet>
  );
}

interface LateItem {
  id: string;
  number: string;
  supplierName: string;
  orderedOn: string;
  expectedOn: string;
  units: number;
  cartons: number;
  daysLate: number;
  stillToPayCents: number | null;
  waitingCustomers: string[];
}

/** The late purchase: when it was due, what's on the way, what's still to pay; ask the supplier or mark it received. */
export function LatePurchaseSheet({ row, onClose }: { row: Attention | null; onClose: () => void }) {
  const t = useTranslations('home');
  const { money, num, date } = useFmt();
  const { canEdit } = useSession();
  const p = ((row?.items ?? []) as LateItem[])[0];
  const [sheet, setSheet] = useState<'ask' | 'receive' | null>(null);
  const detail = useQuery({ queryKey: ['purchases', p?.id], queryFn: () => api.get<PurchaseDetail>(`/purchases/${p!.id}`), enabled: !!p });
  const received = detail.data?.purchase.status === 'received';
  return (
    <>
      <Sheet open={!!row && !sheet} onClose={onClose} title={p ? t('late.title', { number: p.number }) : ''}>
        {p && (
          <div className={s.panel}>
            <p className={s.sub}>{t('late.sub', { supplier: p.supplierName, date: date(p.orderedOn) })}</p>
            <div className={s.box} style={{ gap: 'var(--space-2)' }}>
              <div className={s.tot}>
                <span className={s.m}>{t('late.expected')}</span>
                <span>
                  {date(p.expectedOn)} · <b className="bad">{t('daysLate', { n: num(p.daysLate) })}</b>
                </span>
              </div>
              <div className={s.tot}>
                <span className={s.m}>{t('late.onTheWay')}</span>
                <span>{t('late.unitsCartons', { units: num(p.units), cartons: num(p.cartons) })}</span>
              </div>
              {p.stillToPayCents != null && (
                <div className={s.tot}>
                  <span className={s.m}>{t('late.toPay')}</span>
                  <bdi>{money(p.stillToPayCents)}</bdi>
                </div>
              )}
              <div className={s.tot}>
                <span className={s.m}>{t('late.waiting')}</span>
                <span>{p.waitingCustomers.length ? p.waitingCustomers.join(', ') : t('late.noneWaiting')}</span>
              </div>
            </div>
            {received ? (
              <div className={`${s.box} ${s.hl}`}>
                <b className="good">{t('late.received')}</b>
                <span className={s.m}>{t('late.receivedText')}</span>
              </div>
            ) : canEdit('purchasing') ? (
              <div className={s.btns}>
                <Button icon={EnvelopeSimple} writes disabled={!detail.data} onClick={() => setSheet('ask')}>
                  {t('late.ask')}
                </Button>
                <Button variant="primary" icon={Package} disabled={!detail.data} onClick={() => setSheet('receive')}>
                  {t('late.markReceived')}
                </Button>
              </div>
            ) : null}
            {detail.error && <LoadError error={detail.error} onRetry={() => detail.refetch()} />}
          </div>
        )}
      </Sheet>
      {detail.data && sheet && <PurchaseSheet sheet={sheet} detail={detail.data} onClose={() => setSheet(null)} />}
    </>
  );
}

/** Record bank balance (the Money area's panel), opened in place from Needs attention. */
export function BankSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ['money', 'bank-balances'], queryFn: () => api.get<{ cash: CashOnHand }>('/money/bank-balances'), enabled: open });
  return <BankBalanceSheet open={open} onClose={onClose} cash={q.data?.cash} />;
}

/** A note to an agent from What to do (a draft left unsent, a customer due to reorder). */
export function AgentEmailSheet({ mail, onClose }: { mail: { agentId: string; agentName: string; agentEmail?: string | null; subject: string; body: string } | null; onClose: () => void }) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const [draft, setDraft] = useState<Draft>({ subject: '', body: '' });
  useEffect(() => {
    if (mail) setDraft({ subject: mail.subject, body: mail.body });
  }, [mail]);
  const send = useAction(() => api.post(`/agents/${mail!.agentId}/nudge`, { subject: draft.subject, message: draft.body }), { success: t('mail.sent', { name: mail?.agentName ?? '' }), onDone: onClose });
  return (
    <Sheet
      open={!!mail}
      onClose={onClose}
      dirty
      title={t('mail.title')}
      footer={
        <>
          <Button onClick={onClose}>{tc('discard')}</Button>
          <Button variant="primary" icon={EnvelopeSimple} busy={send.busy} disabled={!draft.subject.trim() || !draft.body.trim()} onClick={() => send.mutate(undefined)}>
            {t('mail.send')}
          </Button>
        </>
      }
    >
      {mail && <EmailDraft value={draft} onChange={setDraft} to={mail.agentEmail ?? mail.agentName} />}
      <span className={s.caption} style={{ textAlign: 'start' }}>
        {t('mail.note')}
      </span>
      <ActionError action={send} />
    </Sheet>
  );
}
