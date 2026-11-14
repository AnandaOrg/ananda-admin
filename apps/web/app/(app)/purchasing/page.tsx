'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { Flavour } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, EmptyState, ErrorState, KpiTile, ListCard, PageHeader, PageSkeleton, Plus, Search, ShoppingCart, Table, type Column } from '@/components/ui';
import { PurchasingTabs, TableFoot, chevronColumn } from './_components/PurchasingTabs';
import { NewPurchaseSheet } from './_components/NewPurchaseSheet';
import { PurchaseStatusPill } from './_components/PurchaseStatus';
import { SupplierSheet } from './suppliers/SupplierSheet';
import type { PurchaseFilter, PurchaseList, PurchaseRow } from './_lib/types';

/** FR-PUR-1: purchases with tiles; Home links to ?filter=late and ?new=1. */
export default function PurchasesPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { canEdit, readOnly } = useSession();
  const { money, num, date, dateShort } = useFmt();
  const filter = (params.get('filter') === 'late' ? 'late' : 'all') as PurchaseFilter;
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [addingSupplier, setAddingSupplier] = useState(false);
  const query = qs({ filter: filter === 'all' ? undefined : filter, q: q.trim() || undefined });
  const list = useQuery({ queryKey: ['purchases', query], queryFn: () => api.get<PurchaseList>(`/purchases${query}`), placeholderData: (prev) => prev });
  const editable = canEdit('purchasing') && !readOnly;

  const closeNew = () => {
    setCreating(false);
    if (params.get('new')) router.replace('/purchasing');
  };

  if (list.isLoading) return <PageSkeleton />;
  const d = list.data;
  const rows = d?.items ?? [];
  const tiles = d?.tiles;
  const firstTime = !!d && d.counts.all === 0 && !q && filter === 'all';

  const newBtn = editable && (
    <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
      {t('new.title')}
    </Button>
  );
  const sheets = editable && (
    <>
      <NewPurchaseSheet open={creating} onClose={closeNew} flavour={params.get('flavour') as Flavour | null} nextNumber={d?.nextNumber} />
      <SupplierSheet open={addingSupplier} supplier={null} all={[]} onClose={() => setAddingSupplier(false)} />
    </>
  );

  if (firstTime) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tc('nav.purchasing') }]} kicker={t('empty.kicker')} title={tc('nav.purchasing')} actions={newBtn} />
        <Card>
          <EmptyState
            icon={ShoppingCart}
            title={t('empty.title')}
            text={t('empty.text')}
            action={
              editable ? (
                <span className="row wrap" style={{ justifyContent: 'center' }}>
                  <Button icon={Plus} onClick={() => setAddingSupplier(true)}>
                    {t('empty.addSupplier')}
                  </Button>
                  <Button variant="primary" icon={ShoppingCart} onClick={() => setCreating(true)}>
                    {t('new.title')}
                  </Button>
                </span>
              ) : undefined
            }
          />
        </Card>
        {sheets}
      </div>
    );
  }

  const expected = (p: PurchaseRow) => (p.arrivedOn ? t('receivedOn', { date: dateShort(p.arrivedOn) }) : date(p.expectedOn));
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
    { key: 'expected', header: t('cols.expected'), render: (p) => <span className={`nowrap ${p.daysLate > 0 ? 'bad' : ''}`}>{expected(p)}</span> },
    { key: 'units', header: tc('units'), type: 'count', render: (p) => num(p.unitsReceived ?? p.totalUnits) },
    { key: 'toPay', header: t('cols.toPay'), type: 'amount', render: (p) => <bdi>{money(p.stillToPayCents)}</bdi> },
    { key: 'status', header: tc('status'), render: (p) => <PurchaseStatusPill p={p} /> },
    chevronColumn<PurchaseRow>(),
  ];

  const toPaySub = tiles && (tiles.toPayNumbers.length ? tiles.toPayNumbers.join(', ') : t('tiles.allPaid'));
  const lateSub = tiles && (tiles.late > 0 ? t('tiles.lateSub', { number: tiles.oldestLateNumber ?? '', n: tiles.oldestLateDays }) : t('tiles.allOnTime'));
  const openLate = tiles?.oldestLateId ? () => router.push(`/purchasing/${tiles.oldestLateId}`) : undefined;

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.purchasing') }]}
        kicker={t('kicker', { n: d?.counts.all ?? 0, s: d?.approvedSuppliers ?? 0 })}
        title={tc('nav.purchasing')}
        actions={
          <>
            <div className="only-wide" style={{ width: 240 }}>
              <Search value={q} onChange={setQ} placeholder={t('searchPlaceholder')} />
            </div>
            <span className="only-wide">{newBtn}</span>
          </>
        }
      />
      <PurchasingTabs current="purchases" />
      {tiles && (
        <>
          <div className="kpis only-wide" style={{ ['--n' as string]: 3 }}>
            <KpiTile label={t('tiles.onTheWay')} value={num(tiles.onTheWayUnits)} sub={tiles.onTheWayUnits ? t('tiles.unitsCartons', { n: num(tiles.onTheWayCartons) }) : t('tiles.nothingOnTheWay')} />
            <KpiTile label={t('tiles.toPay')} value={money(tiles.toPaySuppliersCents)} sub={<bdi>{toPaySub}</bdi>} />
            <KpiTile label={t('tiles.late')} value={num(tiles.late)} valueTone={tiles.late > 0 ? 'bad' : undefined} sub={<bdi>{lateSub}</bdi>} onClick={openLate} />
          </div>
          <div className="kpis only-phone">
            <KpiTile label={t('tiles.onTheWay')} value={num(tiles.onTheWayUnits)} sub={tiles.onTheWayUnits ? t('tiles.unitsCartons', { n: num(tiles.onTheWayCartons) }) : t('tiles.nothingOnTheWay')} />
            <KpiTile label={t('tiles.toPayShort')} value={<span style={{ color: tiles.toPaySuppliersCents > 0 ? 'var(--warn)' : undefined }}>{money(tiles.toPaySuppliersCents, true)}</span>} sub={<bdi>{toPaySub}</bdi>} onClick={() => router.push('/purchasing/payables')} />
          </div>
        </>
      )}
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={ShoppingCart} title={q ? t('empty.searchTitle') : t('empty.lateTitle')} text={q ? t('empty.searchText', { q }) : t('empty.lateText')} />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(p) => p.id} onRow={(p) => router.push(`/purchasing/${p.id}`)} />
            <TableFoot>{t('foot')}</TableFoot>
          </Card>
          <div className="list-cards only-phone">
            {rows.map((p) => (
              <ListCard
                key={p.id}
                href={`/purchasing/${p.id}`}
                title={<bdi>{p.number}</bdi>}
                amount={money(p.stillToPayCents)}
                sub={
                  <>
                    {date(p.orderedOn)} · {t('unitsShort', { n: num(p.unitsReceived ?? p.totalUnits) })}
                  </>
                }
                status={<PurchaseStatusPill p={p} />}
              />
            ))}
          </div>
        </>
      )}
      {editable && (
        <div className="only-phone">
          <Button variant="primary" block icon={Plus} onClick={() => setCreating(true)}>
            {t('new.title')}
          </Button>
        </div>
      )}
      {sheets}
    </div>
  );
}
