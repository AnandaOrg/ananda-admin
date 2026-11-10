'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Card, CheckCircle, Chips, EmptyState, ErrorState, FileText, Icon, ListCard, OrderStatusPill, PageHeader, PageSkeleton, Table, type Column } from '@/components/ui';
import { noteUrl, type DeliveredRow } from '../_components/types';

type Period = 'this_month' | 'last_month' | 'all';

/** Delivered orders with the date and a signed-note marker (FR-WH-5). */
export default function DeliveredPage() {
  const t = useTranslations('warehouse');
  const tc = useTranslations('common');
  const router = useRouter();
  const { isWarehouse } = useSession();
  const { date, dateShort, num } = useFmt();
  const [period, setPeriod] = useState<Period>('this_month');
  const list = useQuery({ queryKey: ['warehouse', 'delivered', period], queryFn: () => api.get<DeliveredRow[]>(`/warehouse/delivered${qs({ period })}`) });
  const rows = list.data ?? [];

  const marker = (r: DeliveredRow) =>
    r.signedNoteId ? (
      <a className="link row nowrap" href={noteUrl(r.signedNoteId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        <Icon as={FileText} size="sm" />
        {t('viewNote')}
      </a>
    ) : (
      <span className="subtle">{t('noNote')}</span>
    );

  const columns: Column<DeliveredRow>[] = [
    {
      key: 'to',
      header: t('cols.deliversTo'),
      render: (r) => (
        <>
          <span className="nm">{r.customerName}</span>
          <span className="sb">
            <bdi>{r.number}</bdi>
            {r.city && ` · ${r.city}`}
          </span>
        </>
      ),
    },
    { key: 'date', header: t('cols.delivered'), render: (r) => <span className="nowrap">{date(r.deliveredAt)}</span> },
    { key: 'cartons', header: t('cols.cartons'), type: 'count', render: (r) => num(r.deliveredCartons) },
    { key: 'status', header: t('cols.status'), render: (r) => <OrderStatusPill status={r.status} /> },
    { key: 'note', header: t('cols.signedNote'), render: marker },
  ];

  if (list.isLoading) return <PageSkeleton />;

  return (
    <div className="page">
      <PageHeader crumbs={isWarehouse ? undefined : [{ label: tc('nav.warehouse'), href: '/warehouse' }, { label: t('deliveredPage.title') }]} kicker={t('deliveredPage.kicker', { n: rows.length })} title={t('deliveredPage.title')} />
      <Chips
        label={tc('filters')}
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'this_month', label: t('deliveredPage.thisMonth') },
          { value: 'last_month', label: t('deliveredPage.lastMonth') },
          { value: 'all', label: t('deliveredPage.all') },
        ]}
      />
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={CheckCircle} title={t('deliveredPage.empty.title')} text={t('deliveredPage.empty.text')} />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(r) => r.id} onRow={isWarehouse ? undefined : (r) => router.push(`/sales/${r.id}`)} />
          </Card>
          <div className="list-cards only-phone">
            {rows.map((r) => (
              <ListCard
                key={r.id}
                href={r.signedNoteId ? noteUrl(r.signedNoteId) : undefined}
                title={r.customerName}
                amount={t('tiles.toShipSub', { n: r.deliveredCartons })}
                sub={
                  <>
                    <bdi>{r.number}</bdi> · {t('deliveredPage.deliveredOn', { date: dateShort(r.deliveredAt) })} · {r.signedNoteId ? t('viewNote') : t('noNote')}
                  </>
                }
                status={<OrderStatusPill status={r.status} />}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
