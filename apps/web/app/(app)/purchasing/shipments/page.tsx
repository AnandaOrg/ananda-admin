'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { StatusTone } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, EmptyState, ErrorState, ListCard, PageHeader, PageSkeleton, Pill, Plus, Table, Truck, type Column } from '@/components/ui';
import { PurchasingTabs, TableFoot, chevronColumn } from '../_components/PurchasingTabs';
import { NewPurchaseSheet } from '../_components/NewPurchaseSheet';
import type { PurchaseStatus, Shipment } from '../_lib/types';

type Row = Shipment & { purchaseNumber: string; purchaseStatus: PurchaseStatus; supplierName: string; expectedOn: string; late: boolean };

/** FR-PUR-5: goods coming in — purchase, carrier and mode, route, when, status. */
export default function ShipmentsPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const router = useRouter();
  const { canEdit, readOnly } = useSession();
  const { dateShort } = useFmt();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['purchases', 'shipments'], queryFn: () => api.get<{ items: Row[] }>('/purchases/shipments') });
  const editable = canEdit('purchasing') && !readOnly;

  if (list.isLoading) return <PageSkeleton />;
  const rows = list.data?.items ?? [];
  const when = (s: Row) => (s.status === 'arrived' ? t('shipments.arrivedOn', { date: dateShort(s.arriveOn) }) : s.late ? t('shipments.expectedLate', { date: dateShort(s.expectedOn) }) : t('shipments.expectedOn', { date: dateShort(s.expectedOn) }));
  const status = (s: Row): [StatusTone, string] => (s.status === 'arrived' ? ['good', t('shipments.status.arrived')] : s.late ? ['bad', t('shipments.late')] : s.status === 'booked' ? ['mute', t('shipments.status.booked')] : ['info', t('shipments.status.in_transit')]);
  const pill = (s: Row) => {
    const [tone, label] = status(s);
    return <Pill tone={tone}>{label}</Pill>;
  };

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
    { key: 'carrier', header: t('shipments.cols.carrier'), render: (s) => <><bdi>{s.carrier}</bdi> · {t(`shipments.by.${s.mode}`)}</> },
    { key: 'route', header: t('shipments.route'), render: (s) => (s.route ? <bdi>{s.route}</bdi> : '—') },
    { key: 'when', header: t('shipments.cols.when'), render: (s) => <span className="nowrap">{when(s)}</span> },
    { key: 'status', header: tc('status'), render: pill },
    chevronColumn<Row>(),
  ];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.purchasing'), href: '/purchasing' }, { label: t('tabs.shipments') }]}
        kicker={t('shipments.kicker')}
        title={tc('nav.purchasing')}
        actions={
          editable ? (
            <span className="only-wide">
              <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                {t('new.title')}
              </Button>
            </span>
          ) : undefined
        }
      />
      <PurchasingTabs current="shipments" />
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
            <TableFoot>{t('shipments.foot')}</TableFoot>
          </Card>
          <div className="list-cards only-phone">
            {rows.map((s) => (
              <ListCard
                key={s.id}
                href={`/purchasing/${s.purchaseId}`}
                title={<bdi>{s.purchaseNumber}</bdi>}
                amount={<bdi>{s.route ?? ''}</bdi>}
                sub={
                  <>
                    <bdi>{s.carrier}</bdi> · {t(`shipments.by.${s.mode}`)} · {when(s)}
                  </>
                }
                status={pill(s)}
              />
            ))}
          </div>
        </>
      )}
      {editable && <NewPurchaseSheet open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}
