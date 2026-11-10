'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Camera, Card, EmptyState, ErrorState, FlavourRows, Icon, MapPin, Package, PageHeader, PageSkeleton, Phone, Pill } from '@/components/ui';
import { PartDeliverySheet, SignedNoteSheet } from './DeliverySheets';
import { mapsUrl, type ShipCard } from './types';

/** How long an order has waited at the warehouse, as a word (never colour alone). */
export function DueMarker({ order }: { order: Pick<ShipCard, 'waitingDays' | 'redelivery'> }) {
  const t = useTranslations('warehouse');
  if (order.redelivery) return <Pill tone="warn">{t('due.redelivery')}</Pill>;
  if (order.waitingDays <= 0) return <Pill tone="info">{t('due.today')}</Pill>;
  if (order.waitingDays === 1) return <Pill tone="info">{t('due.yesterday')}</Pill>;
  return <Pill tone="warn">{t('due.days', { n: order.waitingDays })}</Pill>;
}

function ShipOrderCard({ o, onNote, onPart, canAct }: { o: ShipCard; onNote: () => void; onPart: () => void; canAct: boolean }) {
  const t = useTranslations('warehouse');
  const tc = useTranslations('common');
  const { num } = useFmt();
  return (
    <Card
      title={
        <span className="stack tight" style={{ gap: 2 }}>
          <span>{o.customerName}</span>
          <span className="body-sm muted">
            <bdi>{o.number}</bdi>
            {o.city && ` · ${o.city}`}
          </span>
        </span>
      }
      action={<DueMarker order={o} />}
    >
      <div className="stack tight">
        <span className="row" style={{ alignItems: 'flex-start' }}>
          <Icon as={MapPin} size="sm" className="muted" />
          <span className="body-sm">{o.address}</span>
        </span>
        <span className="body-sm">
          <span className="muted">{t('card.contact')}: </span>
          {o.contactName} · <bdi>{o.phone}</bdi>
        </span>
      </div>
      <div className="row">
        <a className="an-btn secondary sm" href={`tel:${o.phone.replace(/[^\d+]/g, '')}`} style={{ flex: 1 }}>
          <Icon as={Phone} size="sm" />
          {tc('call')}
        </a>
        <a className="an-btn secondary sm" href={mapsUrl(o)} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
          <Icon as={MapPin} size="sm" />
          {tc('directions')}
        </a>
      </div>
      <FlavourRows cartons={Object.fromEntries(o.lines.map((l) => [l.flavour, l.cartons]))} />
      <div className="row between body-sm">
        <span className="muted">{t('card.total')}</span>
        <bdi className="strong num">{t('card.totalValue', { c: o.totalCartons, u: num(o.totalUnits) })}</bdi>
      </div>
      {canAct && (
        <div className="stack tight">
          <Button variant="primary" size="lg" block icon={Camera} onClick={onNote}>
            {t('card.uploadNote')}
          </Button>
          <Button block onClick={onPart}>
            {t('card.partDelivery')}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Phone · To ship (FR-WH-2). The Warehouse role sees these cards at every width. */
export function ToShip() {
  const t = useTranslations('warehouse');
  const { canEdit, readOnly } = useSession();
  const list = useQuery({ queryKey: ['warehouse', 'to-ship'], queryFn: () => api.get<ShipCard[]>('/warehouse/to-ship') });
  const [note, setNote] = useState<ShipCard | null>(null);
  const [part, setPart] = useState<ShipCard | null>(null);
  if (list.isLoading) return <PageSkeleton />;
  const rows = list.data ?? [];
  const canAct = canEdit('warehouse') && !readOnly;
  return (
    <div className="page">
      <PageHeader
        kicker={t('toShipKicker', { n: rows.length })}
        title={t('toShipTitle')}
        actions={
          <span className="row only-wide">
            <Link href="/warehouse/delivered" className="an-btn secondary sm">
              {t('deliveredPage.title')}
            </Link>
            <Link href="/warehouse/count" className="an-btn secondary sm">
              {t('count.title')}
            </Link>
          </span>
        }
      />
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Package} title={t('emptyToShip.title')} text={t('emptyToShip.text')} />
        </Card>
      ) : (
        <div className={rows.length > 1 ? 'cols even' : 'list-cards'}>
          {rows.map((o) => (
            <ShipOrderCard key={o.id} o={o} canAct={canAct} onNote={() => setNote(o)} onPart={() => setPart(o)} />
          ))}
        </div>
      )}
      <SignedNoteSheet order={note} onClose={() => setNote(null)} />
      <PartDeliverySheet order={part} onClose={() => setPart(null)} />
    </div>
  );
}
