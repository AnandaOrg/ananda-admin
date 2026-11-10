'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { REASONS, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { Banner, Button, FlavourName, KeyValue, Pill, ReasonChips, Sheet, TextArea, Totals, Skeleton } from '@/components/ui';

interface Review {
  id: string;
  type: 'new_customer' | 'special_price' | 'correction';
  status: string;
  reason: string | null;
  agent: { id: string; name: string };
  customer?: { id: string; companyName: string; vatNumber?: string; vatValid?: boolean | null; country?: string; registeredAddress?: string; contactName?: string; phone?: string; invoiceEmail?: string; note?: string | null };
  duplicates?: { id: string; companyName: string; vatNumber: string; status: string; agentName: string | null }[];
  order?: { id: string; number: string; totalCartons?: number; totalUnits?: number };
  price?: { fromCents: number; toCents: number };
  totals?: { fromCents: number; toCents: number };
  commission?: { fromCents: number; toCents: number };
  perFlavour?: { flavour: Flavour; from: number; to: number }[];
  cartons?: { from: number; to: number; minimum: number };
  stockReleasedUnits?: number;
}

/** The facts needed to decide, the agent's reason, and the consequence in one line (FR-HOME-4). */
export function ReviewPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const { money, unit, num } = useFmt();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const q = useQuery({ queryKey: ['approvals', id], queryFn: () => api.get<Review>(`/approvals/${id}`), enabled: !!id });
  const approve = useAction(() => api.post(`/approvals/${id}/approve`), { success: t('review.approved'), onDone: onClose });
  const decline = useAction(() => api.post(`/approvals/${id}/decline`, { reason, message: message || undefined }), { success: t('review.declined'), onDone: onClose });
  const r = q.data;

  const close = () => {
    setDeclining(false);
    setReason('');
    setMessage('');
    onClose();
  };

  const footer = !r ? null : r.status !== 'pending' ? (
    <Button onClick={close}>{tc('close')}</Button>
  ) : declining ? (
    <>
      <Button onClick={() => setDeclining(false)}>{tc('back')}</Button>
      <Button variant="primary" disabled={!reason} busy={decline.isPending} onClick={() => decline.mutate(undefined)}>
        {t('review.sendDecline')}
      </Button>
    </>
  ) : (
    <>
      <Button onClick={() => setDeclining(true)}>{tc('decline')}</Button>
      <Button variant="primary" busy={approve.isPending} onClick={() => approve.mutate(undefined)}>
        {tc('approve')}
      </Button>
    </>
  );

  return (
    <Sheet open={!!id} onClose={close} title={r ? t(`review.title.${r.type}`) : tc('review')} sub={r ? t('review.from', { agent: r.agent.name }) : undefined} footer={footer} dirty={declining && !!message}>
      {!r ? (
        <Skeleton h={240} />
      ) : (
        <>
          {r.status !== 'pending' && <Banner>{t('review.alreadyDecided')}</Banner>}
          {r.type === 'new_customer' && r.customer && (
            <>
              <KeyValue
                items={[
                  [t('review.company'), r.customer.companyName],
                  [
                    t('review.vat'),
                    <span key="v" className="row">
                      <bdi>{r.customer.vatNumber}</bdi>
                      {r.customer.vatValid === true && <Pill tone="good">{t('review.vatValid')}</Pill>}
                      {r.customer.vatValid === false && <Pill tone="bad">{t('review.vatInvalid')}</Pill>}
                      {r.customer.vatValid == null && <Pill tone="mute">{t('review.vatUnchecked')}</Pill>}
                    </span>,
                  ],
                  [t('review.country'), r.customer.country],
                  [t('review.address'), r.customer.registeredAddress],
                  [t('review.contact'), `${r.customer.contactName} · ${r.customer.phone}`],
                  [tc('email'), r.customer.invoiceEmail],
                ]}
              />
              {r.duplicates && r.duplicates.length > 0 ? (
                <Banner tone="bad" sub={r.duplicates.map((d) => `${d.companyName} (${d.vatNumber}${d.agentName ? ` · ${d.agentName}` : ''})`).join(', ')}>
                  {t('review.duplicates')}
                </Banner>
              ) : (
                <p className="body-sm good">{t('review.noDuplicates')}</p>
              )}
            </>
          )}
          {r.type === 'special_price' && r.price && (
            <>
              <KeyValue
                items={[
                  [t('review.order'), <bdi key="o">{r.order?.number}</bdi>],
                  [tc('customer'), r.customer?.companyName ?? '—'],
                  [tc('cartons'), num(r.order?.totalCartons)],
                  [
                    tc('unitPrice'),
                    <span key="p" className="diff">
                      <bdi className="from">{unit(r.price.fromCents)}</bdi>→<bdi>{unit(r.price.toCents)}</bdi>
                    </span>,
                  ],
                ]}
              />
              <Totals
                lines={[
                  [t('review.commission'), `${money(r.commission!.fromCents)} → ${money(r.commission!.toCents)}`],
                ]}
                big={[tc('totalInclVat'), `${money(r.totals!.toCents)}`]}
              />
            </>
          )}
          {r.type === 'correction' && r.perFlavour && (
            <>
              <KeyValue items={[[t('review.order'), <bdi key="o">{r.order?.number}</bdi>], [tc('customer'), r.customer?.companyName ?? '—']]} />
              <div className="stack tight">
                {r.perFlavour.map((f) => (
                  <div key={f.flavour} className="row between">
                    <FlavourName flavour={f.flavour} />
                    <span className="diff">
                      <span className="from">{f.from}</span>→<b>{f.to}</b>
                    </span>
                  </div>
                ))}
              </div>
              <Totals
                lines={[
                  [t('review.cartonsVsMin', { min: r.cartons!.minimum }), `${num(r.cartons!.from)} → ${num(r.cartons!.to)}`],
                  [t('review.commission'), `${money(r.commission!.fromCents)} → ${money(r.commission!.toCents)}`],
                  [t('review.stockReleased'), tc('unitsCount', { n: num(r.stockReleasedUnits) })],
                ]}
                big={[tc('totalInclVat'), `${money(r.totals!.fromCents)} → ${money(r.totals!.toCents)}`]}
              />
            </>
          )}
          {r.reason && (
            <div className="an-field">
              <label>{t('review.agentReason')}</label>
              <p>{r.reason}</p>
            </div>
          )}
          {declining ? (
            <>
              <ReasonChips reasons={REASONS.decline} value={reason} onChange={setReason} label={t('review.declineReason')} ns="decline" />
              <TextArea label={tc('messageOptional')} value={message} onChange={(e) => setMessage(e.target.value)} help={t('review.declineHelp')} />
            </>
          ) : (
            r.status === 'pending' && <p className="body-sm muted">{t(`review.consequence.${r.type}`)}</p>
          )}
          {(approve.errorText || decline.errorText) && <Banner tone="bad">{approve.errorText || decline.errorText}</Banner>}
        </>
      )}
    </Sheet>
  );
}
