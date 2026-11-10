'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, type OrderStatus } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import {
  Button,
  Card,
  Chips,
  DownloadSimple,
  EmptyState,
  ErrorState,
  ListCard,
  OrderStatusPill,
  PageHeader,
  PageSkeleton,
  Plus,
  Search,
  SelectPill,
  ShoppingCart,
  Table,
  Users,
  CalendarBlank,
  SlidersHorizontal,
  type Column,
} from '@/components/ui';

export interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  createdAt: string;
  totalCents: number;
  totalCartons: number;
  customerName: string | null;
  agentName: string;
  daysLate: number;
  pendingCorrection: boolean;
}

type Filter = 'all' | 'needs_action' | 'late' | 'drafts' | 'closed';

export default function SalesPage() {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { canEdit, isAgent } = useSession();
  const { money, date, dateShort, num } = useFmt();
  const [filter, setFilter] = useState<Filter>((params.get('filter') as Filter) ?? 'all');
  const [q, setQ] = useState('');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [period, setPeriod] = useState<'any' | '30' | '90' | 'year'>('any');
  const [flavour, setFlavour] = useState<string | null>(null);

  const from = period === 'any' ? undefined : period === 'year' ? `${new Date().getFullYear()}-01-01` : new Date(Date.now() - Number(period) * 86_400_000).toISOString().slice(0, 10);
  const query = qs({ filter, q, agentId, from, flavour });
  const list = useQuery({ queryKey: ['orders', query], queryFn: () => api.get<{ items: OrderRow[]; counts: Record<Filter, number> }>(`/orders${query}`) });
  const agents = useQuery({ queryKey: ['agents-list'], queryFn: () => api.get<{ id: string; name: string }[]>('/customers/agents'), enabled: !isAgent });

  const counts = list.data?.counts;
  const chips = (['all', 'needs_action', 'late', 'drafts', 'closed'] as Filter[]).map((f) => ({ value: f, label: t(`filters.${f}`), count: counts?.[f] }));
  const rows = list.data?.items ?? [];

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
    ...(isAgent ? [] : [{ key: 'agent', header: t('cols.agent'), render: (o: OrderRow) => o.agentName }]),
    { key: 'created', header: t('cols.created'), render: (o) => <span className="nowrap">{date(o.createdAt)}</span>, className: 'only-wide-col' },
    { key: 'cartons', header: tc('cartons'), type: 'count', render: (o) => num(o.totalCartons) },
    { key: 'total', header: tc('totalInclVat'), type: 'amount', render: (o) => <bdi>{money(o.totalCents)}</bdi> },
    { key: 'status', header: tc('status'), render: (o) => <OrderStatusPill status={o.status} daysLate={o.daysLate} /> },
  ];

  if (list.isLoading) return <PageSkeleton />;

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.sales') }]}
        kicker={t('kicker', { n: counts?.all ?? 0 })}
        title={tc('nav.sales')}
        actions={
          <>
            <a className="an-btn secondary sm" href={`/api/orders/export.csv${query}`}>
              <DownloadSimple className="an-ic sm" aria-hidden />
              {tc('exportCsv')}
            </a>
            {canEdit('sales') && (
              <Link href="/sales/new" className="an-btn primary sm">
                <Plus className="an-ic sm" aria-hidden />
                {tc('newSale')}
              </Link>
            )}
          </>
        }
      />
      <Chips options={chips} value={filter} onChange={setFilter} label={tc('filters')} />
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder={t('searchPlaceholder')} />
        {!isAgent && (
          <SelectPill
            icon={Users}
            label={tc('agent')}
            value={agents.data?.find((a) => a.id === agentId)?.name ?? tc('anyAgent')}
            items={[{ key: 'any', label: tc('anyAgent'), selected: !agentId, onSelect: () => setAgentId(null) }, ...(agents.data ?? []).map((a) => ({ key: a.id, label: a.name, selected: a.id === agentId, onSelect: () => setAgentId(a.id) }))]}
          />
        )}
        <SelectPill
          icon={CalendarBlank}
          label={t('created')}
          value={t(`period.${period}`)}
          items={(['any', '30', '90', 'year'] as const).map((p) => ({ key: p, label: t(`period.${p}`), selected: p === period, onSelect: () => setPeriod(p) }))}
        />
        <SelectPill
          icon={SlidersHorizontal}
          label={tc('flavour')}
          value={flavour ? flavour.toUpperCase() : t('anyFlavour')}
          items={[{ key: 'any', label: t('anyFlavour'), selected: !flavour, onSelect: () => setFlavour(null) }, ...FLAVOURS.map((f) => ({ key: f, label: f.toUpperCase(), selected: f === flavour, onSelect: () => setFlavour(f) }))]}
        />
      </div>
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={ShoppingCart}
            title={t('empty.title')}
            text={t('empty.text')}
            action={
              canEdit('sales') ? (
                <Button variant="primary" icon={Plus} onClick={() => router.push('/sales/new')}>
                  {tc('newSale')}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(o) => o.id} onRow={(o) => router.push(`/sales/${o.id}`)} />
          </Card>
          <div className="list-cards only-phone">
            {rows.map((o) => (
              <ListCard
                key={o.id}
                href={`/sales/${o.id}`}
                title={o.customerName ?? t('noCustomer')}
                amount={money(o.totalCents)}
                sub={
                  <>
                    <bdi>{o.number}</bdi> · {dateShort(o.createdAt)}
                    {!isAgent && ` · ${o.agentName}`}
                  </>
                }
                status={<OrderStatusPill status={o.status} daysLate={o.daysLate} />}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
