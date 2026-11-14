'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useMedia } from '@/lib/hooks';
import { Button, CaretRight, Card, Chips, EmptyState, Icon, ListCard, ListCards, PageHeader, Phone, Pill, Plus, Search, Sheet, Table, Users, searchFilter, type Column } from '@/components/ui';
import { AddCustomerSheet } from './AddCustomerSheet';
import { ChangeAgentSheet } from './ChangeAgentSheet';
import { ReviewPanel } from '../home/ReviewPanel';
import { STATUS_TONE } from './status';
import s from './customers.module.css';

interface CustomerRow {
  id: string;
  companyName: string;
  vatNumber: string;
  city: string | null;
  phone: string | null;
  agentId: string | null;
  agentName: string | null;
  ownedUntil: string | null;
  lastOrderAt: string | null;
  owesCents: number | null;
  lateCents: number | null;
  status: string;
  approvalId: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  mine: boolean;
}

type Filter = 'all' | 'needs_approval' | 'late' | 'free' | 'archived';

export default function CustomersPage() {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const phone = useMedia('(max-width: 767px)');
  const { canEdit, isAgent, isAdmin } = useSession();
  const { money, date, dateShort } = useFmt();
  const [filter, setFilter] = useState<Filter>((params.get('filter') as Filter) ?? 'all');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(params.get('new') === '1' || params.get('add') === '1');
  const [review, setReview] = useState<string | null>(null);
  const [peek, setPeek] = useState<CustomerRow | null>(null);
  const [moving, setMoving] = useState<CustomerRow | null>(null);
  const query = qs({ filter });
  const list = useQuery({ queryKey: ['customers', query], queryFn: () => api.get<{ items: CustomerRow[]; counts: Record<Filter, number>; ownershipMonths: number }>(`/customers${query}`) });
  const claim = useAction((id: string) => api.post(`/customers/${id}/claim`), { success: t('claimed'), errorToast: true });

  const counts = list.data?.counts;
  const months = list.data?.ownershipMonths ?? 6;
  const rows = searchFilter(list.data?.items ?? [], q, (c) => [c.companyName, c.vatNumber, c.city, c.agentName]);
  const firstRun = !list.isLoading && !list.error && counts?.all === 0 && counts?.archived === 0;
  const canAdd = canEdit('customers');
  const today = new Date().toISOString().slice(0, 10);

  const agentName = (c: CustomerRow) => (c.status === 'free_to_claim' || !c.agentName ? t('noAgent') : c.agentName);
  const ownsUntil = (c: CustomerRow) =>
    c.status === 'needs_approval' || c.status === 'draft' ? t('onApproval') : c.status === 'free_to_claim' && c.ownedUntil ? t('freeSince', { date: dateShort(c.ownedUntil) }) : c.ownedUntil ? date(c.ownedUntil) : '—';
  const lastOrder = (c: CustomerRow) => (c.lastOrderAt ? dateShort(c.lastOrderAt) : t('neverOrdered'));
  const status = (c: CustomerRow) => <Pill tone={STATUS_TONE[c.status] ?? 'info'}>{tc(`customerStatus.${c.status}`)}</Pill>;
  const open = (c: CustomerRow) => {
    if (c.status === 'needs_approval' && c.approvalId && isAdmin) return setReview(c.approvalId);
    if (phone && !isAgent) return setPeek(c);
    router.push(`/customers/${c.id}`);
  };
  const requested = (c: CustomerRow) =>
    c.requestedBy && c.requestedAt ? (c.requestedAt.slice(0, 10) === today ? t('requestedToday', { name: c.requestedBy }) : t('requestedOn', { name: c.requestedBy, date: dateShort(c.requestedAt) })) : null;

  const columns: Column<CustomerRow>[] = [
    {
      key: 'customer',
      header: t('cols.customer'),
      render: (c) => (
        <>
          <span className="nm">{c.companyName}</span>
          {requested(c) && <span className={s.requested}>{requested(c)}</span>}
        </>
      ),
    },
    { key: 'agent', header: tc('agent'), render: agentName },
    { key: 'owns', header: t('cols.ownsUntil'), render: (c) => <span className="nowrap">{ownsUntil(c)}</span> },
    { key: 'last', header: t('cols.lastOrder'), render: (c) => <span className="nowrap">{lastOrder(c)}</span> },
    { key: 'owes', header: t('cols.owes'), type: 'amount', render: (c) => (c.owesCents == null ? '—' : <bdi className={c.lateCents ? 'bad' : ''}>{money(c.owesCents)}</bdi>) },
    {
      key: 'status',
      header: tc('status'),
      type: 'status',
      render: (c) =>
        isAgent && c.status === 'free_to_claim' && !c.mine ? (
          <Button size="sm" variant="primary" onClick={(e) => (e.stopPropagation(), claim.mutate(c.id))} busy={claim.busy && claim.variables === c.id}>
            {t('claim')}
          </Button>
        ) : (
          status(c)
        ),
    },
    { key: 'go', header: '', width: 40, render: () => <Icon as={CaretRight} size="sm" className="subtle flip" /> },
  ];

  const chipKeys: Filter[] = phone ? ['all', 'needs_approval', 'late', 'free'] : ['all', 'needs_approval', 'late', 'free', 'archived'];
  const newButton = canAdd && (
    <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>
      {t('new.title')}
    </Button>
  );

  if (firstRun) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tc('nav.customers') }]} kicker={t('noneYet')} title={tc('nav.customers')} actions={newButton} />
        <Card>
          <EmptyState
            icon={Users}
            title={t('empty.firstTitle')}
            text={isAgent ? t('empty.firstTextAgent') : t('empty.firstText')}
            action={
              canAdd ? (
                <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
                  {t('new.title')}
                </Button>
              ) : undefined
            }
          />
        </Card>
        <AddCustomerSheet open={adding} onClose={() => setAdding(false)} />
      </div>
    );
  }

  const empty = (
    <EmptyState
      icon={Users}
      title={q ? t('empty.noMatch', { q }) : t('empty.title')}
      text={q ? undefined : t(`empty.filter.${filter}`)}
      action={
        canAdd && filter === 'all' && !q ? (
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            {t('new.title')}
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.customers') }]}
        kicker={isAgent ? t('kickerMine', { n: counts?.all ?? 0 }) : t('kicker', { n: counts?.all ?? 0 })}
        title={tc('nav.customers')}
        actions={
          <>
            {!phone && <Search value={q} onChange={setQ} placeholder={t('searchPlaceholder')} suggestions={rows.slice(0, 50).map((c) => ({ key: c.id, title: c.companyName, sub: [agentName(c), c.vatNumber].filter(Boolean).join(' · '), href: `/customers/${c.id}` }))} />}
            {newButton}
          </>
        }
      />
      {phone && <Search phone value={q} onChange={setQ} placeholder={t('searchPlaceholder')} />}
      <Chips value={filter} onChange={setFilter} fill={false} label={tc('filters')} options={chipKeys.map((f) => ({ value: f, label: t(`filters.${f}`), count: counts?.[f] }))} />
      <Card flush className="only-wide">
        <Table columns={columns} rows={rows} rowKey={(c) => c.id} onRow={open} picker={{ id: 'customers', locked: ['customer', 'owes', 'status'], priority: ['agent', 'owns', 'last'] }} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} errorTitle={t('couldntLoad')} empty={empty} />
        {rows.length > 0 && <div className={s.foot2}>{t('rule', { n: months })}</div>}
      </Card>
      <div className="only-phone">
        <ListCards loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} errorTitle={t('couldntLoad')} empty={rows.length === 0 ? <Card>{empty}</Card> : undefined}>
          {rows.map((c) => (
            <ListCard
              key={c.id}
              onClick={() => open(c)}
              title={c.companyName}
              amount={c.owesCents == null ? '' : money(c.owesCents)}
              sub={
                <>
                  {agentName(c)} · {c.lastOrderAt ? t('lastOrderOn', { date: dateShort(c.lastOrderAt) }) : t('neverOrdered')}
                </>
              }
              status={status(c)}
            />
          ))}
        </ListCards>
      </div>

      <AddCustomerSheet open={adding} onClose={() => setAdding(false)} />
      <ReviewPanel id={review} onClose={() => setReview(null)} />
      <ChangeAgentSheet customer={moving && { id: moving.id, companyName: moving.companyName, agentId: moving.status === 'free_to_claim' ? null : moving.agentId, agentName: moving.status === 'free_to_claim' ? null : moving.agentName, months }} onClose={() => setMoving(null)} />
      <Sheet open={!!peek} onClose={() => setPeek(null)} title={peek?.companyName ?? ''}>
        {peek && (
          <>
            <div className={s.peek}>
              <div className={s.kv}>
                <span>{tc('agent')}</span>
                <span>{agentName(peek)}</span>
              </div>
              <div className={s.kv}>
                <span>{peek.status === 'free_to_claim' ? t('cols.lastOrder') : t('cols.ownsUntil')}</span>
                <span>{peek.status === 'free_to_claim' ? `${lastOrder(peek)} · ${t('freeSince', { date: dateShort(peek.ownedUntil) }).toLowerCase()}` : ownsUntil(peek)}</span>
              </div>
              <div className={s.kv}>
                <span>{t('cols.owes')}</span>
                <bdi className={peek.lateCents ? s.bad : ''}>{money(peek.owesCents ?? 0)}</bdi>
              </div>
              <div className={s.kv}>
                <span>{t('cols.lastOrder')}</span>
                <span>{lastOrder(peek)}</span>
              </div>
            </div>
            <span className={s.note}>{t('ruleShort', { n: months })}</span>
            <div className={s.btns}>
              <a className={`an-btn secondary keep ${peek.phone ? '' : 'disabled'}`} href={peek.phone ? `tel:${peek.phone}` : undefined} aria-disabled={!peek.phone || undefined}>
                <Icon as={Phone} size="sm" />
                {tc('call')}
              </a>
              {isAdmin && (
                <Button
                  onClick={() => {
                    setMoving(peek);
                    setPeek(null);
                  }}
                >
                  {t('changeAgent')}
                </Button>
              )}
            </div>
            <Button onClick={() => router.push(`/customers/${peek.id}`)}>{t('openCard')}</Button>
          </>
        )}
      </Sheet>
    </div>
  );
}
