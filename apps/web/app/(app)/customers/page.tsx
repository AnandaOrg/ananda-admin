'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { Button, Card, Chips, EmptyState, ErrorState, ListCard, PageHeader, PageSkeleton, Pill, Plus, Search, Table, UserPlus, Users, type Column } from '@/components/ui';
import { NewCustomerSheet } from './NewCustomerSheet';
import { STATUS_TONE } from './status';

interface CustomerRow {
  id: string;
  companyName: string;
  vatNumber: string;
  city: string | null;
  agentName: string | null;
  ownedUntil: string | null;
  lastOrderAt: string | null;
  owesCents: number | null;
  lateCents: number | null;
  status: string;
  mine: boolean;
}

type Filter = 'all' | 'needs_approval' | 'late' | 'free' | 'archived';


export default function CustomersPage() {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { canEdit, isAgent } = useSession();
  const { money, date } = useFmt();
  const [filter, setFilter] = useState<Filter>((params.get('filter') as Filter) ?? 'all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(params.get('new') === '1');
  const query = qs({ filter, q });
  const list = useQuery({ queryKey: ['customers', query], queryFn: () => api.get<{ items: CustomerRow[]; counts: Record<Filter, number> }>(`/customers${query}`) });
  const claim = useAction((id: string) => api.post(`/customers/${id}/claim`), { success: t('claimed') });

  if (list.isLoading) return <PageSkeleton />;
  const counts = list.data?.counts;
  const rows = list.data?.items ?? [];
  const owes = (c: CustomerRow) => (c.owesCents == null ? '—' : <bdi className={c.lateCents ? 'bad' : ''}>{money(c.owesCents)}</bdi>);
  const status = (c: CustomerRow) => <Pill tone={STATUS_TONE[c.status] ?? 'info'}>{tc(`customerStatus.${c.status}`)}</Pill>;

  const columns: Column<CustomerRow>[] = [
    {
      key: 'c',
      header: t('cols.customer'),
      render: (c) => (
        <>
          <span className="nm">{c.companyName}</span>
          <span className="sb">
            <bdi>{c.vatNumber}</bdi>
            {c.city && ` · ${c.city}`}
          </span>
        </>
      ),
    },
    { key: 'a', header: tc('agent'), render: (c) => c.agentName ?? '—' },
    { key: 'o', header: t('cols.ownsUntil'), render: (c) => <span className="nowrap">{c.ownedUntil ? date(c.ownedUntil) : '—'}</span> },
    { key: 'l', header: t('cols.lastOrder'), render: (c) => <span className="nowrap">{c.lastOrderAt ? date(c.lastOrderAt) : '—'}</span> },
    { key: 'w', header: t('cols.owes'), type: 'amount', render: owes },
    {
      key: 's',
      header: tc('status'),
      render: (c) =>
        isAgent && c.status === 'free_to_claim' && !c.mine ? (
          <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); claim.mutate(c.id); }} busy={claim.isPending && claim.variables === c.id}>
            {t('claim')}
          </Button>
        ) : (
          status(c)
        ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.customers') }]}
        kicker={t('kicker', { n: counts?.all ?? 0 })}
        title={tc('nav.customers')}
        actions={
          canEdit('customers') && (
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              {t('new.title')}
            </Button>
          )
        }
      />
      <Chips
        value={filter}
        onChange={setFilter}
        label={tc('filters')}
        options={(['all', 'needs_approval', 'late', 'free', 'archived'] as Filter[]).map((f) => ({ value: f, label: t(`filters.${f}`), count: counts?.[f] }))}
      />
      <Search value={q} onChange={setQ} placeholder={t('searchPlaceholder')} />
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title={t('empty.title')} text={t('empty.text')} action={canEdit('customers') ? <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>{t('new.title')}</Button> : undefined} />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(c) => c.id} onRow={(c) => router.push(`/customers/${c.id}`)} />
          </Card>
          <div className="list-cards only-phone">
            {rows.map((c) => (
              <ListCard key={c.id} href={`/customers/${c.id}`} title={c.companyName} amount={c.owesCents == null ? '' : money(c.owesCents)} sub={[c.city, c.agentName, c.lastOrderAt ? date(c.lastOrderAt) : null].filter(Boolean).join(' · ')} status={status(c)} />
            ))}
          </div>
        </>
      )}
      {claim.errorText && <p className="an-help error">{claim.errorText}</p>}
      <NewCustomerSheet open={adding} onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); router.push(`/customers/${id}`); }} />
    </div>
  );
}
