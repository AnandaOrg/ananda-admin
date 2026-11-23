'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, UNITS_PER_CARTON, isoDate, type OrderStatus } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import {
  Button,
  CaretRight,
  Card,
  Chips,
  DownloadSimple,
  EmptyState,
  Icon,
  List,
  ListCard,
  ListCards,
  PageHeader,
  Plus,
  Search,
  Sheet,
  SlidersHorizontal,
  TABLE_PICKERS,
  Table,
  UserPlus,
  type Column,
} from '@/components/ui';
import { NewSaleSheet } from './NewSaleSheet';
import { PickChips, SalesStatus, SumBox } from './ui';

export interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  createdAt: string;
  totalCents: number;
  totalCartons: number;
  customerName: string | null;
  brokerName: string;
  daysLate: number;
  pendingCorrection: boolean;
  houseSale?: boolean;
}

type Filter = 'all' | 'needs_action' | 'late' | 'drafts' | 'closed';
type Period = 'any' | 'month' | '3m' | 'year';

/** Orders that are settled or with the warehouse open a quick view; the rest open the full order. */
const PEEK: OrderStatus[] = ['invoiced', 'cancelled', 'at_warehouse'];

function fromDate(p: Period): string | undefined {
  const now = new Date();
  if (p === 'month') return isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  if (p === '3m') return isoDate(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()));
  if (p === 'year') return `${now.getFullYear()}-01-01`;
  return undefined;
}

/** Sales & orders (10 Nov prototype): customer first, one order number, one plain status, quick chips. */
export function SalesList({ newSale = false }: { newSale?: boolean }) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { canEdit, isBroker } = useSession();
  const { money, date, num } = useFmt();
  const [filter, setFilter] = useState<Filter>((params.get('filter') as Filter) ?? 'all');
  const [q, setQ] = useState('');
  const [brokerId, setBrokerId] = useState<string>('');
  const [period, setPeriod] = useState<Period>('any');
  const [flavour, setFlavour] = useState<string>('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [peek, setPeek] = useState<OrderRow | null>(null);
  const [saleOpen, setSaleOpen] = useState(newSale);

  const query = qs({ filter, q, brokerId, from: fromDate(period), flavour });
  const list = useQuery({ queryKey: ['orders', query], queryFn: () => api.get<{ items: OrderRow[]; counts: Record<Filter, number> }>(`/orders${query}`) });
  // Totals without any filter: tells a new account (no orders at all) from an empty filter.
  const all = useQuery({ queryKey: ['orders', 'count'], queryFn: () => api.get<{ counts: Record<Filter, number> }>('/orders?filter=drafts'), select: (d) => d.counts });
  const brokers = useQuery({ queryKey: ['brokers-list'], queryFn: () => api.get<{ id: string; name: string }[]>('/customers/brokers'), enabled: !isBroker });

  const counts = list.data?.counts;
  const rows = list.data?.items ?? [];
  const extra = [brokerId, period !== 'any' ? period : '', flavour].filter(Boolean).length;
  const newAccount = all.data?.all === 0;
  const sell = canEdit('sales');

  const chips = (['all', 'needs_action', 'late', 'drafts', 'closed'] as Filter[]).map((f) => ({ value: f, label: t(`filters.${f}`), count: f === 'closed' ? undefined : counts?.[f] }));
  const open = (o: OrderRow) => (PEEK.includes(o.status) ? setPeek(o) : router.push(`/sales/${o.id}`));
  const closeSale = () => {
    setSaleOpen(false);
    if (newSale) router.replace('/sales');
  };

  const columns: Column<OrderRow>[] = [
    {
      key: 'customer',
      header: t('cols.customer'),
      render: (o) => (
        <>
          <span className="nm">{o.customerName ?? t('noCustomer')}</span>
          <span className="sb">
            <bdi>{o.number}</bdi>
          </span>
        </>
      ),
    },
    ...(isBroker ? [] : [{ key: 'broker', header: t('cols.broker'), render: (o: OrderRow) => (o.houseSale ? t('noBroker') : o.brokerName) } as Column<OrderRow>]),
    { key: isBroker ? 'ordered' : 'created', header: isBroker ? t('cols.ordered') : t('cols.created'), type: 'date', render: (o) => date(o.createdAt) },
    ...(isBroker ? [{ key: 'units', header: tc('units'), type: 'count', render: (o: OrderRow) => num(o.totalCartons * UNITS_PER_CARTON) } as Column<OrderRow>] : []),
    { key: 'total', header: t('cols.total'), type: 'amount', render: (o) => <bdi>{money(o.totalCents)}</bdi> },
    { key: 'status', header: t('cols.status'), type: 'status', render: (o) => <SalesStatus status={o.status} daysLate={o.daysLate} /> },
    {
      key: 'go',
      header: '',
      width: 48,
      render: () => (
        <span className="sales-chev" aria-hidden>
          <Icon as={CaretRight} size="sm" />
        </span>
      ),
    },
  ];

  const newSaleBtn = sell && (
    <Button variant="primary" size="sm" icon={Plus} onClick={() => setSaleOpen(true)}>
      {tc('newSale')}
    </Button>
  );
  const sheets = (
    <>
      <NewSaleSheet
        open={saleOpen}
        onClose={closeSale}
        customerId={params.get('customer')}
        onDone={() => {
          setFilter('all');
        }}
      />
      {peek && (
        <Sheet open onClose={() => setPeek(null)} title={peek.customerName ?? t('noCustomer')} sub={[peek.number, date(peek.createdAt), ...(isBroker ? [] : [peek.houseSale ? t('noBroker') : peek.brokerName])].join(' · ')}>
          <SumBox
            rows={[
              [t('peek.status'), <SalesStatus key="s" status={peek.status} daysLate={peek.daysLate} />],
              [t('peek.total'), money(peek.totalCents)],
            ]}
          />
          <Button variant="primary" block keep onClick={() => router.push(`/sales/${peek.id}`)}>
            {t('peek.open')}
          </Button>
        </Sheet>
      )}
      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={t('filterSheet.title')}
        footer={
          <>
            <Button
              keep
              onClick={() => {
                setBrokerId('');
                setPeriod('any');
                setFlavour('');
              }}
            >
              {t('filterSheet.clear')}
            </Button>
            <Button variant="primary" keep onClick={() => setFiltersOpen(false)}>
              {t('filterSheet.show', { n: rows.length })}
            </Button>
          </>
        }
      >
        {!isBroker && (
          <>
            <span className="sgrp">{t('filterSheet.broker')}</span>
            <PickChips label={t('filterSheet.broker')} value={brokerId} onChange={setBrokerId} options={[{ value: '', label: t('filterSheet.allBrokers') }, ...(brokers.data ?? []).map((a) => ({ value: a.id, label: a.name }))]} />
          </>
        )}
        <span className="sgrp">{t('filterSheet.created')}</span>
        <PickChips label={t('filterSheet.created')} value={period} onChange={(p) => setPeriod(p as Period)} options={(['any', 'month', '3m', 'year'] as Period[]).map((p) => ({ value: p, label: t(`period.${p}`) }))} />
        <span className="sgrp">{t('filterSheet.flavour')}</span>
        <PickChips label={t('filterSheet.flavour')} value={flavour} onChange={setFlavour} options={[{ value: '', label: t('filterSheet.any') }, ...FLAVOURS.map((f) => ({ value: f, label: f.toUpperCase() }))]} />
      </Sheet>
    </>
  );

  // A new account: no orders at all. One empty card with the two ways to start.
  if (newAccount) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tc('nav.sales') }]} kicker={t('kickerEmpty')} title={<span>{tc('nav.sales')}</span>} actions={newSaleBtn} />
        <Card>
          <EmptyState
            icon={List}
            title={t('empty.title')}
            text={isBroker ? t('empty.textBroker') : t('empty.text')}
            action={
              <div className="row wrap" style={{ justifyContent: 'center', gap: 'var(--space-2)' }}>
                {canEdit('customers') && (
                  <Link href="/customers?add=1" className="an-btn secondary sm">
                    <Icon as={UserPlus} size="sm" />
                    {t('empty.addCustomer')}
                  </Link>
                )}
                {newSaleBtn}
              </div>
            }
          />
        </Card>
        {sheets}
      </div>
    );
  }

  const filtersBtn = (label: string) => (
    <Button size="sm" icon={SlidersHorizontal} keep onClick={() => setFiltersOpen(true)} className={extra ? 'on' : ''}>
      {extra ? t('filtersOn', { n: extra }) : label}
    </Button>
  );
  const empty = <EmptyState title={t('empty.noneTitle')} text={t('empty.noneText')} />;

  return (
    <div className="page">
      <div className="only-wide">
        <PageHeader
          crumbs={[{ label: tc('nav.sales') }]}
          kicker={counts ? (isBroker ? t('kickerOwn', { n: all.data?.all ?? counts.all }) : t('kicker', { n: all.data?.all ?? counts.all })) : ' '}
          title={tc('nav.sales')}
          actions={
            <>
              <div className="sales-head-search">
                <Search value={q} onChange={setQ} placeholder={t('searchPlaceholder')} />
              </div>
              <a className="an-btn secondary sm" href={`/api/orders/export.csv${query}`}>
                <Icon as={DownloadSimple} size="sm" />
                {tc('exportCsv')}
              </a>
              {newSaleBtn}
            </>
          }
        />
      </div>
      <div className="only-phone">
        <PageHeader title={t('phoneTitle')} />
      </div>
      <div className="only-phone sales-phone-tools">
        <Search value={q} onChange={setQ} placeholder={t('searchPhone')} phone />
        {filtersBtn(t('filtersBtn'))}
      </div>
      <div className="sales-chiprow">
        <Chips fill={false} options={chips} value={filter} onChange={setFilter} label={tc('filters')} />
        <span className="only-wide" style={{ marginInlineStart: 'auto' }}>
          {filtersBtn(t('moreFilters'))}
        </span>
      </div>
      <Card flush className="only-wide">
        <Table columns={columns} rows={rows} rowKey={(o) => o.id} onRow={open} picker={isBroker ? TABLE_PICKERS.brokerOrders : TABLE_PICKERS.salesOrders} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} errorTitle={t('load.error')} empty={empty} />
      </Card>
      <div className="only-phone">
        <ListCards loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} errorTitle={t('load.error')} empty={<Card>{empty}</Card>}>
          {rows.map((o) => (
            <ListCard
              key={o.id}
              href={`/sales/${o.id}`}
              title={o.customerName ?? t('noCustomer')}
              amount={money(o.totalCents)}
              sub={
                <>
                  <span className="sales-card-line">
                    <bdi>{o.number}</bdi> · {date(o.createdAt)}
                  </span>
                  {!isBroker && <span className="sales-card-line">{o.houseSale ? t('noBroker') : o.brokerName}</span>}
                </>
              }
              status={<SalesStatus status={o.status} daysLate={o.daysLate} />}
            />
          ))}
        </ListCards>
      </div>
      {sheets}
    </div>
  );
}
