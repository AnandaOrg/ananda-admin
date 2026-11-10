'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { Flavour } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, Chips, DownloadSimple, EmptyState, ErrorState, KpiTile, ListCard, PageHeader, PageSkeleton, Plus, Search, Table, Truck, type Column } from '@/components/ui';
import { PurchasingTabs } from './_components/PurchasingTabs';
import { NewPurchaseSheet } from './_components/NewPurchaseSheet';
import { PurchaseStatusPill } from './_components/PurchaseStatus';
import type { PurchaseFilter, PurchaseList, PurchaseRow } from './_lib/types';

/** FR-PUR-1: purchases with tiles, filter chips (Home links to ?filter=late) and ?new=1. */
export default function PurchasesPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { canEdit, readOnly } = useSession();
  const { money, num, date, dateShort } = useFmt();
  const initial = params.get('filter') as PurchaseFilter | null;
  const [filter, setFilter] = useState<PurchaseFilter>(initial && ['all', 'open', 'late', 'received'].includes(initial) ? initial : 'all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(params.get('new') === '1');
  const query = qs({ filter, q });
  const list = useQuery({ queryKey: ['purchases', query], queryFn: () => api.get<PurchaseList>(`/purchases${query}`) });
  const editable = canEdit('purchasing') && !readOnly;

  const closeNew = () => {
    setCreating(false);
    if (params.get('new')) router.replace('/purchasing');
  };

  if (list.isLoading) return <PageSkeleton />;
  const d = list.data;
  const rows = d?.items ?? [];
  const chips = (['all', 'open', 'late', 'received'] as PurchaseFilter[]).map((f) => ({ value: f, label: t(`filters.${f}`), count: d?.counts[f] }));

  const columns: Column<PurchaseRow>[] = [
    {
      key: 'purchase',
      header: t('cols.purchase'),
      render: (p) => (
        <>
          <span className="nm">
            <bdi>{p.number}</bdi>
          </span>
          <span className="sb">
            <bdi>{p.supplierName}</bdi>
          </span>
        </>
      ),
    },
    { key: 'ordered', header: t('cols.ordered'), render: (p) => <span className="nowrap">{date(p.orderedOn)}</span> },
    {
      key: 'expected',
      header: t('cols.expected'),
      render: (p) => (p.arrivedOn ? <span className="nowrap muted">{t('arrived', { date: date(p.arrivedOn) })}</span> : <span className={`nowrap ${p.daysLate > 0 ? 'bad' : ''}`}>{date(p.expectedOn)}</span>),
    },
    { key: 'units', header: tc('units'), type: 'count', render: (p) => num(p.unitsReceived ?? p.totalUnits) },
    { key: 'toPay', header: t('cols.toPay'), type: 'amount', render: (p) => <bdi>{money(p.stillToPayCents)}</bdi> },
    { key: 'status', header: tc('status'), render: (p) => <PurchaseStatusPill status={p.status} daysLate={p.daysLate} invoiceMissing={!p.supplierInvoiceReceived} /> },
  ];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.purchasing') }]}
        kicker={t('kicker', { n: d?.counts.all ?? 0 })}
        title={tc('nav.purchasing')}
        actions={
          <>
            <a className="an-btn secondary sm" href={`/api/purchases/export.csv${query}`}>
              <DownloadSimple className="an-ic sm" aria-hidden />
              {tc('exportCsv')}
            </a>
            {editable && (
              <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                {t('new.title')}
              </Button>
            )}
          </>
        }
      />
      <PurchasingTabs current="purchases" />
      {d && (
        <div className="kpis" style={{ ['--n' as string]: 3 }}>
          <KpiTile label={t('tiles.onTheWay')} value={t('tiles.units', { n: num(d.tiles.onTheWayUnits) })} sub={t('tiles.cartons', { n: num(d.tiles.onTheWayCartons) })} />
          <KpiTile label={t('tiles.toPay')} value={money(d.tiles.toPaySuppliersCents, true)} sub={d.tiles.notInvoicedCents > 0 ? t('tiles.notInvoiced', { amount: money(d.tiles.notInvoicedCents, true) }) : undefined} link={{ href: '/purchasing/payables', label: t('tabs.payables') }} />
          <KpiTile
            label={t('tiles.late')}
            value={num(d.tiles.late)}
            valueTone={d.tiles.late > 0 ? 'bad' : undefined}
            sub={d.tiles.late > 0 ? t('tiles.oldestLate', { n: d.tiles.oldestLateDays }) : t('tiles.noneLate')}
            subTone={d.tiles.late > 0 ? 'bad' : undefined}
            onClick={d.tiles.late > 0 ? () => setFilter('late') : undefined}
          />
        </div>
      )}
      <Chips options={chips} value={filter} onChange={setFilter} label={tc('filters')} />
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder={t('searchPlaceholder')} />
      </div>
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Truck}
            title={filter === 'late' ? t('empty.lateTitle') : t('empty.title')}
            text={filter === 'late' ? t('empty.lateText') : t('empty.text')}
            action={
              editable && filter !== 'late' ? (
                <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                  {t('new.title')}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(p) => p.id} onRow={(p) => router.push(`/purchasing/${p.id}`)} />
          </Card>
          <div className="list-cards only-phone">
            {rows.map((p) => (
              <ListCard
                key={p.id}
                href={`/purchasing/${p.id}`}
                title={<bdi>{p.supplierName}</bdi>}
                amount={money(p.stillToPayCents)}
                sub={
                  <>
                    <bdi>{p.number}</bdi> · {t('unitsShort', { n: num(p.unitsReceived ?? p.totalUnits) })} · {p.arrivedOn ? t('arrived', { date: dateShort(p.arrivedOn) }) : t('expectedShort', { date: dateShort(p.expectedOn) })}
                  </>
                }
                status={<PurchaseStatusPill status={p.status} daysLate={p.daysLate} invoiceMissing={!p.supplierInvoiceReceived} />}
              />
            ))}
          </div>
        </>
      )}
      {editable && <NewPurchaseSheet open={creating} onClose={closeNew} flavour={params.get('flavour') as Flavour | null} />}
    </div>
  );
}
