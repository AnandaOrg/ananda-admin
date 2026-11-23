'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Camera, Card, Check, EmptyState, ErrorState, FlavourName, Icon, ListCard, Package, PageHeader, PageSkeleton, Phone, Pill } from '@/components/ui';
import { PartDeliverySheet, SignedNoteSheet } from './DeliverySheets';
import { daysAgo, mapsUrl, type ShipCard } from './types';
import css from '../warehouse.module.css';

/** When an order reached the warehouse, as a day: Today, Yesterday, or the date. */
/** "Today", "Yesterday" or the date: compact (pills) by default, `full` for table cells where the date is the data. */
export function useWhen(full?: boolean) {
  const t = useTranslations('warehouse');
  const { dateShort, date } = useFmt();
  return (iso: string | null) => {
    const d = daysAgo(iso);
    if (d === null) return '—';
    if (d <= 0) return t('when.today');
    if (d === 1) return t('when.yesterday');
    return full ? date(iso) : dateShort(iso);
  };
}

/** The open order: address, contact, Call and Directions, cartons per flavour, and the two actions. */
function OpenOrder({ o, onToggle, onNote, onPart, canAct }: { o: ShipCard; onToggle: () => void; onNote: () => void; onPart: () => void; canAct: boolean }) {
  const t = useTranslations('warehouse');
  const { num } = useFmt();
  const when = useWhen();
  const fresh = (daysAgo(o.sentAt) ?? 0) <= 0;
  return (
    <section className={`an-card ${css.shipCard}`}>
      <button type="button" onClick={onToggle} aria-expanded="true" className={css.shipHead}>
        <span className={`row between ${css.shipTop}`}>
          <b className={css.shipName}>{o.customerName}</b>
          <Pill tone={fresh ? 'warn' : 'mute'}>{when(o.sentAt)}</Pill>
        </span>
        <span className={`muted ${css.shipSub}`}>
          <bdi>{o.number}</bdi>
          {o.city && ` · ${o.city}`}
          {o.partDelivered && ` · ${t('card.rest')}`}
        </span>
      </button>
      <div className={css.address}>
        <span>
          <bdi>{o.address}</bdi>
          {o.city && !o.address.includes(o.city) && `, ${o.city}`}
        </span>
        <span className="muted">{t('card.contact', { name: o.contactName, phone: o.phone })}</span>
      </div>
      <div className="row">
        <a href={`tel:${o.phone.replace(/[^\d+]/g, '')}`} className={`an-btn secondary ${css.share}`}>
          <Icon as={Phone} size="sm" />
          {t('card.call')}
        </a>
        <a className={`an-btn secondary ${css.share}`} href={mapsUrl(o)} target="_blank" rel="noreferrer">
          {t('card.directions')}
        </a>
      </div>
      {o.lines.map((l) => (
        <div key={l.flavour} className="row between">
          <FlavourName flavour={l.flavour} />
          <b className="num">{t('card.cartons', { n: l.cartons })}</b>
        </div>
      ))}
      <div className={`row between ${css.total}`}>
        <span className="muted">{t('card.total')}</span>
        <bdi className="num">{t('card.totalValue', { c: o.totalCartons, u: num(o.totalUnits) })}</bdi>
      </div>
      {canAct && (
        <>
          <Button variant="primary" block icon={Camera} onClick={onNote}>
            {t('card.uploadNote')}
          </Button>
          <Button block onClick={onPart}>
            {t('card.partDelivery')}
          </Button>
        </>
      )}
    </section>
  );
}

/**
 * Phone · To ship (FR-WH-2): the warehouse desk. One order open at a time; never prices or stock values.
 * `links`: Admins on the phone have no warehouse tab bar, so Delivered and Stock count are links here.
 */
export function ToShip({ links }: { links?: boolean }) {
  const t = useTranslations('warehouse');
  const tc = useTranslations('common');
  const { canEdit, readOnly } = useSession();
  const when = useWhen();
  const list = useQuery({ queryKey: ['warehouse', 'to-ship'], queryFn: () => api.get<ShipCard[]>('/warehouse/to-ship') });
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const [note, setNote] = useState<ShipCard | null>(null);
  const [part, setPart] = useState<ShipCard | null>(null);
  if (list.isLoading) return <PageSkeleton />;
  const rows = list.data ?? [];
  const canAct = canEdit('warehouse') && !readOnly;
  // The first order starts open, like the desk at the start of the day.
  const openId = open === undefined ? rows[0]?.id : open;
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <PageHeader title={t('toShipTitle', { n: rows.length })} />
      {links && (
        <div className="row">
          <Link href="/warehouse/delivered" className={`an-btn secondary sm ${css.share}`}>
            <Icon as={Check} size="sm" />
            {tc('tabs.delivered')}
          </Link>
          <Link href="/warehouse/count" className={`an-btn secondary sm ${css.share}`}>
            <Icon as={Package} size="sm" />
            {tc('tabs.count')}
          </Link>
        </div>
      )}
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={t('emptyToShip.title')} text={t('emptyToShip.text')} />
        </Card>
      ) : (
        <div className="list-cards">
          {rows.map((o) =>
            o.id === openId ? (
              <OpenOrder key={o.id} o={o} canAct={canAct} onToggle={() => setOpen(null)} onNote={() => setNote(o)} onPart={() => setPart(o)} />
            ) : (
              <ListCard
                key={o.id}
                onClick={() => setOpen(o.id)}
                title={o.customerName}
                amount={when(o.sentAt)}
                sub={
                  <>
                    <bdi>{o.number}</bdi>
                    {o.city && ` · ${o.city}`} · {t('card.cartons', { n: o.totalCartons })}
                  </>
                }
                status={<span />}
              />
            ),
          )}
        </div>
      )}
      <span className="body-sm muted">{t('noPrices')}</span>
      <SignedNoteSheet order={note} onClose={() => setNote(null)} />
      <PartDeliverySheet order={part} onClose={() => setPart(null)} />
    </div>
  );
}
