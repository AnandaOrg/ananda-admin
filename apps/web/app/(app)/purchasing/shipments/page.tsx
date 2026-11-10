'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { StatusTone } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { Card, Chips, EmptyState, ErrorState, ListCard, PageHeader, PageSkeleton, Pill, Table, Truck, type Column } from '@/components/ui';
import { PurchasingTabs } from '../_components/PurchasingTabs';
import type { PurchaseStatus, Shipment } from '../_lib/types';

type Filter = 'all' | 'booked' | 'in_transit' | 'arrived';
type Row = Shipment & { purchaseNumber: string; purchaseStatus: PurchaseStatus; supplierName: string; late: boolean };
const TONE: Record<Shipment['status'], StatusTone> = { booked: 'mute', in_transit: 'info', arrived: 'good' };

/** FR-PUR-5: purchase, carrier and mode, route, when, status. */
export default function ShipmentsPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const router = useRouter();
  const { date, dateShort } = useFmt();
  const [filter, setFilter] = useState<Filter>('all');
  const query = qs({ filter: filter === 'all' ? undefined : filter });
  const list = useQuery({ queryKey: ['purchases', 'shipments', query], queryFn: () => api.get<{ items: Row[]; counts: Record<Filter, number> }>(`/purchases/shipments${query}`) });

  if (list.isLoading) return <PageSkeleton />;
  const rows = list.data?.items ?? [];
  const chips = (['all', 'in_transit', 'booked', 'arrived'] as Filter[]).map((f) => ({ value: f, label: f === 'all' ? t('filters.all') : t(`shipments.status.${f}`), count: list.data?.counts[f] }));
  const when = (s: Row) => {
    if (s.status === 'arrived') return t('shipments.arrivedOn', { date: date(s.arriveOn) });
    if (s.arriveOn) return t('shipments.arrivesOn', { date: date(s.arriveOn) });
    return s.departOn ? t('shipments.leftOn', { date: date(s.departOn) }) : '—';
  };
  const status = (s: Row) => (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <Pill tone={TONE[s.status]}>{t(`shipments.status.${s.status}`)}</Pill>
      {s.late && <Pill tone="bad">{t('shipments.late')}</Pill>}
    </span>
  );

  const columns: Column<Row>[] = [
    {
      key: 'purchase',
      header: t('cols.purchase'),
      render: (s) => (
        <>
          <span className="nm">
            <bdi>{s.purchaseNumber}</bdi>
          </span>
          <span className="sb">
            <bdi>{s.supplierName}</bdi>
          </span>
        </>
      ),
    },
    {
      key: 'carrier',
      header: t('shipments.cols.carrier'),
      render: (s) => (
        <>
          <bdi>{s.carrier}</bdi>
          <span className="sb">{t(`shipments.modes.${s.mode}`)}</span>
        </>
      ),
    },
    { key: 'route', header: t('shipments.route'), render: (s) => (s.route ? <bdi>{s.route}</bdi> : '—') },
    { key: 'when', header: t('shipments.cols.when'), render: (s) => <span className={`nowrap ${s.late ? 'bad' : ''}`}>{when(s)}</span> },
    { key: 'status', header: tc('status'), render: status },
  ];

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: tc('nav.purchasing'), href: '/purchasing' }, { label: t('tabs.shipments') }]} kicker={t('shipments.kicker', { n: list.data?.counts.in_transit ?? 0 })} title={t('tabs.shipments')} />
      <PurchasingTabs current="shipments" />
      <Chips options={chips} value={filter} onChange={setFilter} label={tc('filters')} />
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Truck} title={t('shipments.empty.title')} text={t('shipments.empty.text')} />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(s) => s.id} onRow={(s) => router.push(`/purchasing/${s.purchaseId}`)} />
          </Card>
          <div className="list-cards only-phone">
            {rows.map((s) => (
              <ListCard
                key={s.id}
                href={`/purchasing/${s.purchaseId}`}
                title={<bdi>{s.carrier}</bdi>}
                amount={<bdi>{s.purchaseNumber}</bdi>}
                sub={
                  <>
                    {t(`shipments.modes.${s.mode}`)}
                    {s.route && (
                      <>
                        {' · '}
                        <bdi>{s.route}</bdi>
                      </>
                    )}
                    {' · '}
                    {s.status === 'arrived' ? t('shipments.arrivedOn', { date: dateShort(s.arriveOn) }) : s.arriveOn ? t('shipments.arrivesOn', { date: dateShort(s.arriveOn) }) : ''}
                  </>
                }
                status={status(s)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
