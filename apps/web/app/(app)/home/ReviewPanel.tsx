'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { ActionError, ArrowCounterClockwise, Button, LoadError, Pill, Sheet, Skeleton } from '@/components/ui';
import { useCountryName } from '../customers/AddCustomerSheet';
import { useDecision } from './useDecision';
import s from './home.module.css';

interface Review {
  id: string;
  type: 'new_customer' | 'special_price' | 'correction';
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  agent: { id: string; name: string };
  declineReason: string | null;
  declineReasons: string[];
  canUndo: boolean;
  ownershipMonths: number;
  customer?: { id: string; companyName: string; vatNumber?: string; vatValid?: boolean | null; country?: string; registeredAddress?: string; postcode?: string | null; city?: string | null; contactName?: string; phone?: string; invoiceEmail?: string };
  duplicates?: { id: string; companyName: string; vatNumber: string; status: string; agentName: string | null }[];
  order?: { id: string; number: string; status: string; totalCartons: number; totalUnits: number; paidCents: number };
  tier?: { minCartons: number; maxCartons: number; unitPriceCents: number };
  asked?: { unitPriceCents: number; normally: { minCartons: number; maxCartons: number } | null };
  discount?: { perUnitCents: number; units: number; totalCents: number };
  commission?: { perUnitFromCents?: number; perUnitToCents?: number; fromCents: number; toCents: number };
  paidByAnandaCents?: number;
  landedUnitCents?: number;
  marginUnitCents?: number;
  totals?: { fromCents: number; toCents: number };
  perFlavour?: { flavour: Flavour; from: number; to: number }[];
  cartons?: { from: number; to: number; minimum: number; tierChanges: boolean };
  stockReleasedUnits?: number;
  stockNeededUnits?: number;
}

/**
 * Review in a side panel (bottom sheet on phone): what was asked, by whom and what it changes.
 * Decline asks for a reason first, then a red Decline confirms it; the agent gets it as a notification.
 */
export function ReviewPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const { money, unit, num, dateShort } = useFmt();
  const country = useCountryName();
  const [declining, setDeclining] = useState(false);
  const [why, setWhy] = useState('');
  const [message, setMessage] = useState('');
  const q = useQuery({ queryKey: ['approvals', id], queryFn: () => api.get<Review>(`/approvals/${id}`), enabled: !!id });
  const close = () => {
    setDeclining(false);
    setWhy('');
    setMessage('');
    onClose();
  };
  const { approve, decline, undo } = useDecision(close);
  const r = q.data && q.data.id === id ? q.data : undefined;
  const first = r?.agent.name.split(' ')[0] ?? '';
  const today = new Date().toISOString().slice(0, 10);

  const rows: [ReactNode, ReactNode, ('good' | 'bad' | 'warn')?][] = [];
  let sub: ReactNode = null;
  let note: ReactNode = null;
  if (r?.type === 'new_customer' && r.customer) {
    const c = r.customer;
    sub = r.createdAt.slice(0, 10) === today ? t('review.requestedToday', { date: dateShort(r.createdAt) }) : t('review.requestedOn', { date: dateShort(r.createdAt) });
    const vat = !c.vatNumber ? t('review.noVat') : c.vatValid === true ? t('review.vatValid', { vat: c.vatNumber }) : c.vatValid === false ? t('review.vatInvalid', { vat: c.vatNumber }) : t('review.vatUnchecked', { vat: c.vatNumber });
    rows.push([t('review.company'), c.companyName]);
    rows.push([t('review.vat'), <bdi key="v">{vat}</bdi>, !c.vatNumber ? undefined : c.vatValid === true ? 'good' : c.vatValid === false ? 'bad' : 'warn']);
    rows.push([t('review.country'), c.country ? country(c.country) : '—']);
    rows.push([t('review.address'), [c.registeredAddress, [c.postcode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')]);
    rows.push([t('review.contact'), [c.contactName, c.phone].filter(Boolean).join(' · ')]);
    rows.push([
      t('review.alreadyIn'),
      r.duplicates && r.duplicates.length ? r.duplicates.map((d) => `${d.companyName}${d.agentName ? ` · ${d.agentName}` : ''}`).join(', ') : t('review.noMatch'),
      r.duplicates && r.duplicates.length ? 'bad' : undefined,
    ]);
    note = (
      <>
        {r.reason && <>{t('review.reasonOf', { name: first, reason: r.reason })} </>}
        {t('review.keeps', { name: first, n: r.ownershipMonths })}
      </>
    );
  }
  if (r?.type === 'special_price' && r.tier && r.asked && r.discount && r.commission && r.order) {
    sub = t('review.onOrder', { number: r.order.number, cartons: num(r.order.totalCartons), units: num(r.order.totalUnits) });
    rows.push([t('review.priceList', { min: num(r.tier.minCartons), max: num(r.tier.maxCartons) }), t('review.aUnit', { price: unit(r.tier.unitPriceCents) })]);
    rows.push([t('review.askedFor'), t('review.aUnit', { price: unit(r.asked.unitPriceCents) }), 'warn']);
    if (r.asked.normally) rows.push([t('review.normallyFor'), t('review.cartonsRange', { min: num(r.asked.normally.minCartons), max: num(r.asked.normally.maxCartons) })]);
    rows.push([t('review.discount'), `${unit(r.discount.perUnitCents)} × ${num(r.discount.units)} = ${money(r.discount.totalCents)}`]);
    rows.push([t('review.fromCommission', { name: first }), t('review.aUnit', { price: `${unit(r.commission.perUnitFromCents ?? 0)} → ${unit(r.commission.perUnitToCents ?? 0)}` })]);
    rows.push([t('review.paidByAnanda'), money(r.paidByAnandaCents ?? 0)]);
    rows.push([
      t('review.margin'),
      t('review.marginValue', { price: unit(r.asked.unitPriceCents), landed: unit(r.landedUnitCents ?? 0), commission: unit(r.commission.perUnitToCents ?? 0), margin: unit(r.marginUnitCents ?? 0) }),
      (r.marginUnitCents ?? 0) < 0 ? 'bad' : undefined,
    ]);
    note = r.reason ? t('review.reasonOf', { name: first, reason: r.reason }) : null;
  }
  if (r?.type === 'correction' && r.perFlavour && r.cartons && r.totals && r.commission && r.order) {
    sub = t(r.order.paidCents > 0 ? 'review.orderPaid' : 'review.orderNotPaid', { number: r.order.number });
    const changed = r.perFlavour.filter((f) => f.from !== f.to);
    for (const f of changed) rows.push([f.flavour.toUpperCase(), t('review.cartonsChange', { from: num(f.from), to: num(f.to) }), 'warn']);
    if (changed.length < 4) rows.push([t('review.otherFlavours'), t('review.noChange')]);
    const cartonsNote = r.cartons.to === r.cartons.minimum ? t('review.atMinimum') : r.cartons.tierChanges ? t('review.tierChanges') : '';
    rows.push([tc('cartons'), `${num(r.cartons.from)} → ${num(r.cartons.to)}${cartonsNote ? ` · ${cartonsNote}` : ''}`]);
    rows.push([tc('totalInclVat'), `${money(r.totals.fromCents)} → ${money(r.totals.toCents)}`]);
    rows.push([t('review.commissionOf', { name: first }), `${money(r.commission.fromCents)} → ${money(r.commission.toCents)}`]);
    rows.push([
      t('review.stock'),
      r.stockReleasedUnits ? t('review.stockBack', { n: num(r.stockReleasedUnits) }) : r.stockNeededUnits ? t('review.stockNeeded', { n: num(r.stockNeededUnits) }) : t('review.noChange'),
    ]);
    note = (
      <>
        {r.reason && <>{t('review.reasonOf', { name: first, reason: r.reason })} </>}
        {t('review.replaces')}
      </>
    );
  }

  const title = r ? (
    <span className={s.revTitle}>
      {t(`review.title.${r.type}`)}
      <Pill tone="blue">{r.agent.name}</Pill>
    </span>
  ) : (
    tc('review')
  );

  return (
    <Sheet open={!!id} onClose={close} title={title} sub={sub ?? undefined} dirty={declining && !!message}>
      {q.error ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : !r ? (
        <Skeleton h={320} />
      ) : (
        <div className={s.rev}>
          <div className={s.rvBox}>
            {rows.map(([k, v, tone], i) => (
              <div key={i} className={s.rvRow}>
                <span>{k}</span>
                <span className={tone ?? ''}>{v}</span>
              </div>
            ))}
          </div>
          {note && <div className={s.note}>{note}</div>}
          {r.status !== 'pending' ? (
            <>
              <div className={s.decided}>
                <Pill tone={r.status === 'approved' ? 'good' : r.status === 'withdrawn' ? 'mute' : 'bad'}>{t(`ok.${r.status}`)}</Pill>
                {r.canUndo && (
                  <Button size="sm" icon={ArrowCounterClockwise} writes busy={undo.busy} onClick={() => undo.mutate(r.id, { onSuccess: () => q.refetch() })}>
                    {tc('undo')}
                  </Button>
                )}
              </div>
              <ActionError action={undo} />
            </>
          ) : declining ? (
            <>
              <div className={s.declineBox}>
                <b>{t('review.whyDecline')}</b>
                <div className="an-chips" role="group" aria-label={t('review.whyDecline')} style={{ flexWrap: 'wrap' }}>
                  {r.declineReasons.map((k) => (
                    <button key={k} type="button" className="an-chip" aria-pressed={why === k} onClick={() => setWhy(k)}>
                      {t(`review.why.${r.type}.${k}`)}
                    </button>
                  ))}
                </div>
                <div className="an-field">
                  <label htmlFor="rv-msg">{t('review.messageTo', { name: first })}</label>
                  <input id="rv-msg" className="an-input" value={message} placeholder={t('review.messagePh')} onChange={(e) => setMessage(e.target.value)} />
                </div>
              </div>
              <div className={s.btns}>
                <Button onClick={() => setDeclining(false)}>{tc('back')}</Button>
                <Button variant="primary" className={s.danger} disabled={!why} busy={decline.busy} onClick={() => decline.mutate({ id: r.id, reason: why, message })}>
                  {tc('decline')}
                </Button>
              </div>
              <ActionError action={decline} />
              <span className={s.caption}>{t('review.reasonNotified', { name: first })}</span>
            </>
          ) : (
            <>
              <div className={s.btns}>
                <Button writes className={s.declineBtn} onClick={() => setDeclining(true)}>
                  {tc('decline')}
                </Button>
                <Button variant="primary" busy={approve.busy} onClick={() => approve.mutate(r.id)}>
                  {tc('approve')}
                </Button>
              </div>
              <ActionError action={approve} />
              <span className={s.caption}>{t(`review.after.${r.type}`, { name: first })}</span>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
