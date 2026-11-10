'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { isoDate } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import {
  Button,
  CalendarBlank,
  Card,
  Chips,
  ClockCounterClockwise,
  DownloadSimple,
  EmptyState,
  ErrorState,
  ListCard,
  PageHeader,
  PageSkeleton,
  Pill,
  Search,
  Select,
  SelectPill,
  Switch,
  Table,
  Users,
  type Column,
} from '@/components/ui';
import { useAuditFormat, type AuditEntry } from './_components/audit-format';
import css from './audit.module.css';

const GROUPS = {
  all: [],
  orders: ['orders'],
  payments: ['payments'],
  documents: ['documents'],
  stock: ['stock'],
  customers: ['customers'],
  commission: ['commission'],
  users_access: ['users_access'],
  security: ['security'],
  other: ['purchasing', 'settings', 'expenses', 'events'],
} as const;
type GroupKey = keyof typeof GROUPS;
type PeriodKey = 'any' | 'today' | 'last_7' | 'this_month' | 'last_month' | 'this_year' | 'last_year';

function periodParams(p: PeriodKey) {
  if (p === 'any') return {};
  if (p === 'today') return { period: 'custom', from: isoDate(), to: isoDate() };
  if (p === 'last_7') return { period: 'custom', from: isoDate(new Date(Date.now() - 6 * 86_400_000)), to: isoDate() };
  return { period: p };
}

interface Page {
  items: AuditEntry[];
  total: number;
  next: string | null;
  counts: Record<string, number>;
}

/** FR-ADM-2: every change, permanent and read-only. */
export default function AuditPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { dateTime } = useFmt();
  const f = useAuditFormat();
  const [group, setGroup] = useState<GroupKey>('all');
  const [period, setPeriod] = useState<PeriodKey>('any');
  const [actorId, setActorId] = useState<string | null>(null);
  const [moneyOnly, setMoneyOnly] = useState(false);
  const [term, setTerm] = useState('');

  const params = { category: GROUPS[group].join(',') || undefined, ...periodParams(period), actorId, money: moneyOnly ? '1' : undefined, q: term.trim() || undefined };
  const query = qs(params);
  const people = useQuery({ queryKey: ['audit', 'people'], queryFn: () => api.get<{ id: string; name: string }[]>('/audit/people') });
  const list = useInfiniteQuery({
    queryKey: ['audit', query],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Page>(`/audit${qs({ ...params, before: pageParam, limit: 100 })}`),
    getNextPageParam: (last) => last.next,
  });

  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const first = list.data?.pages[0];
  const counts = first?.counts ?? {};
  const groupCount = (g: GroupKey) => (g === 'all' ? Object.values(counts).reduce((s, n) => s + n, 0) : GROUPS[g].reduce((s, c) => s + (counts[c] ?? 0), 0));
  const groupOptions = (Object.keys(GROUPS) as GroupKey[]).map((g) => ({ value: g, label: t(`audit.groups.${g}`), count: groupCount(g) }));

  const columns: Column<AuditEntry>[] = [
    { key: 'time', header: t('audit.cols.time'), render: (e) => <span className={css.timeCell}>{dateTime(e.at)}</span> },
    { key: 'person', header: t('audit.cols.person'), render: (e) => e.actorName ?? t('audit.system') },
    {
      key: 'action',
      header: t('audit.cols.action'),
      render: (e) => (
        <>
          <span className="nm">{f.action(e)}</span>
          <span className="sb">
            {f.category(e.category)}
            {e.money && ` · ${t('audit.moneyTag')}`}
          </span>
        </>
      ),
    },
    {
      key: 'record',
      header: t('audit.cols.record'),
      render: (e) => (
        <>
          <bdi>{f.record(e)}</bdi>
          {e.recordType && <span className="sb">{t.has(`audit.recordTypes.${e.recordType}`) ? t(`audit.recordTypes.${e.recordType}`) : e.recordType}</span>}
        </>
      ),
    },
    { key: 'change', header: t('audit.cols.change'), render: (e) => f.changes(e) },
  ];

  if (list.isLoading && !list.data) return <PageSkeleton />;

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.audit') }]}
        kicker={t('audit.kicker', { n: first?.total ?? 0 })}
        title={tc('nav.audit')}
        actions={
          <a className="an-btn secondary sm" href={`/api/audit/export.csv${query}`}>
            <DownloadSimple className="an-ic sm" aria-hidden />
            {tc('exportCsv')}
          </a>
        }
      />
      <div className={css.chipsWide}>
        <Chips label={t('audit.category')} value={group} onChange={setGroup} options={groupOptions} />
      </div>
      <div className={css.chipsNarrow}>
        <Select label={t('audit.category')} value={group} onChange={(e) => setGroup(e.target.value as GroupKey)} options={groupOptions.map((o) => ({ value: o.value, label: `${o.label} · ${o.count}` }))} />
      </div>
      <div className="toolbar">
        <Search value={term} onChange={setTerm} placeholder={t('audit.search')} />
        <SelectPill
          icon={Users}
          label={t('audit.cols.person')}
          value={people.data?.find((p) => p.id === actorId)?.name ?? t('audit.anyone')}
          items={[{ key: 'any', label: t('audit.anyone'), selected: !actorId, onSelect: () => setActorId(null) }, ...(people.data ?? []).map((p) => ({ key: p.id, label: p.name, selected: p.id === actorId, onSelect: () => setActorId(p.id) }))]}
        />
        <SelectPill
          icon={CalendarBlank}
          label={t('audit.period')}
          value={t(`audit.periods.${period}`)}
          items={(['any', 'today', 'last_7', 'this_month', 'last_month', 'this_year', 'last_year'] as PeriodKey[]).map((p) => ({ key: p, label: t(`audit.periods.${p}`), selected: p === period, onSelect: () => setPeriod(p) }))}
        />
        <Switch checked={moneyOnly} onChange={setMoneyOnly} label={t('audit.moneyOnly')} />
      </div>
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClockCounterClockwise}
            title={t('audit.emptyTitle')}
            text={t('audit.emptyText')}
            action={
              <Button
                onClick={() => {
                  setGroup('all');
                  setPeriod('any');
                  setActorId(null);
                  setMoneyOnly(false);
                  setTerm('');
                }}
              >
                {t('audit.clearFilters')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(e) => e.id} />
          </Card>
          <div className="list-cards only-phone">
            {rows.map((e) => (
              <ListCard
                key={e.id}
                title={f.action(e)}
                amount={<span className="body-sm muted">{dateTime(e.at)}</span>}
                sub={
                  <>
                    {e.actorName ?? t('audit.system')} · <bdi>{f.record(e)}</bdi>
                    {f.changesText(e) && (
                      <>
                        <br />
                        {f.changesText(e)}
                      </>
                    )}
                  </>
                }
                status={e.money ? <Pill tone="info">{t('audit.moneyTag')}</Pill> : undefined}
              />
            ))}
          </div>
          {list.hasNextPage && (
            <div className={css.more}>
              <Button busy={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                {t('audit.loadMore')}
              </Button>
            </div>
          )}
          <p className="muted body-sm">{t('audit.permanent')}</p>
        </>
      )}
    </div>
  );
}
