'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '@ananda/shared';
import { api, errorText, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import {
  Banner,
  Button,
  CaretDown,
  Card,
  Chips,
  DownloadSimple,
  EmptyState,
  ErrorState,
  KpiTile,
  MenuButton,
  PageHeader,
  PageSkeleton,
  Phone,
  Pill,
  SelectPill,
  Users,
} from '@/components/ui';
import { EmailDraft, type Draft } from '@/components/EmailDraft';

interface Row {
  orderId: string;
  number: string;
  status: OrderStatus;
  paymentDueOn: string | null;
  outstandingCents: number;
  customerId: string;
  customerName: string;
  phone: string;
  email: string;
  agentName: string;
  daysLate: number;
  lastReminderAt: string | null;
}
interface Data {
  tiles: { lateCents: number; lateCount: number; dueWeekCents: number; dueWeekCount: number; allCents: number; allCount: number; oldestLateDays: number };
  items: Row[];
}
type Filter = 'late' | 'week' | 'all';

/** Reminder editor opened under its row; Send or Discard (FR-COLL-3). */
function ReminderEditor({ row, onDone }: { row: Row; onDone: () => void }) {
  const t = useTranslations('collections');
  const tc = useTranslations('common');
  const draft = useQuery({ queryKey: ['collections', 'draft', row.orderId], queryFn: () => api.get<{ to: string; subject: string; message: string }>(`/collections/${row.orderId}/reminder`), staleTime: Infinity });
  const [value, setValue] = useState<Draft | null>(null);
  const v = value ?? (draft.data ? { subject: draft.data.subject, body: draft.data.message } : null);
  const send = useAction(() => api.post(`/collections/${row.orderId}/reminder`, { subject: v!.subject, message: v!.body }), { success: t('reminderSent', { name: row.customerName }), onDone });
  if (draft.error) return <Banner tone="bad">{errorText(draft.error)}</Banner>;
  if (!v) return <p className="muted">{tc('loading')}</p>;
  return (
    <div className="stack" style={{ padding: 'var(--space-3) 0' }}>
      <EmailDraft value={v} onChange={setValue} to={draft.data?.to} showTone={false} />
      <p className="caption muted">{t('agentCopied', { agent: row.agentName })}</p>
      {send.errorText && <Banner tone="bad">{send.errorText}</Banner>}
      <div className="row end">
        <Button size="sm" onClick={onDone}>
          {tc('discard')}
        </Button>
        <Button size="sm" variant="primary" busy={send.isPending} onClick={() => send.mutate(undefined)}>
          {tc('send')}
        </Button>
      </div>
    </div>
  );
}

export default function CollectionsPage() {
  const t = useTranslations('collections');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const { isAgent } = useSession();
  const { money, date } = useFmt();
  const [filter, setFilter] = useState<Filter>((params.get('filter') as Filter) ?? 'all');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const query = qs({ filter, agentId });
  const q = useQuery({ queryKey: ['collections', query], queryFn: () => api.get<Data>(`/collections${query}`) });
  const agents = useQuery({ queryKey: ['agents-list'], queryFn: () => api.get<{ id: string; name: string }[]>('/customers/agents'), enabled: !isAgent });

  if (q.isLoading) return <PageSkeleton />;
  if (!q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { tiles, items } = q.data;

  const late = (r: Row) => (r.daysLate > 0 ? <Pill tone="bad">{tc('daysLate', { n: r.daysLate })}</Pill> : r.paymentDueOn ? <span className="muted nowrap">{t('dueOn', { date: date(r.paymentDueOn) })}</span> : '—');

  // Agents use one "Get in touch" button with Call, E-mail and Remind (design decision).
  const actions = (r: Row) =>
    isAgent ? (
      <MenuButton
        items={[
          { key: 'call', label: tc('call'), href: `tel:${r.phone}` },
          { key: 'email', label: tc('email'), href: `mailto:${r.email}` },
          { key: 'remind', label: t('remind'), onSelect: () => setOpen(r.orderId) },
        ]}
        trigger={({ open: o, toggle, ref }) => (
          <button ref={ref} type="button" className="an-btn secondary sm" aria-expanded={o} onClick={toggle}>
            {t('getInTouch')} <CaretDown className="an-ic sm" aria-hidden />
          </button>
        )}
      />
    ) : (
      <span className="row">
        <a className="an-btn secondary sm" href={`tel:${r.phone}`}>
          <Phone className="an-ic sm" aria-hidden /> {tc('call')}
        </a>
        <Button size="sm" variant={open === r.orderId ? 'primary' : 'secondary'} onClick={() => setOpen(open === r.orderId ? null : r.orderId)}>
          {t('remind')}
        </Button>
      </span>
    );

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.collections') }]}
        kicker={t('kicker')}
        title={tc('nav.collections')}
        actions={
          <>
            {!isAgent && (
              <SelectPill
                icon={Users}
                label={tc('agent')}
                value={agents.data?.find((a) => a.id === agentId)?.name ?? tc('anyAgent')}
                items={[{ key: 'any', label: tc('anyAgent'), selected: !agentId, onSelect: () => setAgentId(null) }, ...(agents.data ?? []).map((a) => ({ key: a.id, label: a.name, selected: a.id === agentId, onSelect: () => setAgentId(a.id) }))]}
              />
            )}
            <a className="an-btn secondary sm" href={`/api/collections/export.csv${query}`}>
              <DownloadSimple className="an-ic sm" aria-hidden /> {tc('exportCsv')}
            </a>
          </>
        }
      />
      <div className="kpis" style={{ ['--n' as string]: 3 }}>
        <KpiTile label={t('tiles.late')} value={money(tiles.lateCents, true)} valueTone={tiles.lateCents ? 'bad' : undefined} sub={tiles.lateCount ? t('tiles.lateSub', { n: tiles.lateCount, days: tiles.oldestLateDays }) : t('tiles.nothingLate')} onClick={() => setFilter('late')} />
        <KpiTile label={t('tiles.week')} value={money(tiles.dueWeekCents, true)} sub={t('tiles.count', { n: tiles.dueWeekCount })} onClick={() => setFilter('week')} />
        <KpiTile label={t('tiles.all')} value={money(tiles.allCents, true)} sub={t('tiles.allSub', { n: tiles.allCount })} tip={t('tiles.allTip')} onClick={() => setFilter('all')} />
      </div>
      <Chips value={filter} onChange={setFilter} options={[{ value: 'late', label: t('filters.late'), count: tiles.lateCount }, { value: 'week', label: t('filters.week'), count: tiles.dueWeekCount }, { value: 'all', label: t('filters.all'), count: tiles.allCount }]} />
      {items.length === 0 ? (
        <Card>
          <EmptyState done title={t('empty.title')} text={t('empty.text')} />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <div className="tbl-wrap">
              <table className="an-tbl">
                <thead>
                  <tr>
                    <th>{t('cols.customer')}</th>
                    {!isAgent && <th>{tc('agent')}</th>}
                    <th className="amt">{tc('amount')}</th>
                    <th>{t('cols.howLate')}</th>
                    <th className="amt">
                      <span className="sr-only">{t('cols.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <Fragment key={r.orderId}>
                      <tr>
                        <td>
                          <Link href={`/customers/${r.customerId}`} className="nm">
                            {r.customerName}
                          </Link>
                          <span className="sb">
                            <Link href={`/sales/${r.orderId}`}>
                              <bdi>{r.number}</bdi>
                            </Link>
                            {r.lastReminderAt && ` · ${t('lastReminder', { date: date(r.lastReminderAt) })}`}
                          </span>
                        </td>
                        {!isAgent && <td>{r.agentName}</td>}
                        <td className="amt">
                          <bdi>{money(r.outstandingCents)}</bdi>
                        </td>
                        <td>{late(r)}</td>
                        <td className="amt">{actions(r)}</td>
                      </tr>
                      {open === r.orderId && (
                        <tr>
                          <td colSpan={isAgent ? 4 : 5}>
                            <ReminderEditor row={r} onDone={() => setOpen(null)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="list-cards only-phone">
            {items.map((r) => (
              <div key={r.orderId} className="an-card" style={{ gap: 'var(--space-2)' }}>
                <div className="row between">
                  <Link href={`/sales/${r.orderId}`} className="body-lg strong">
                    {r.customerName}
                  </Link>
                  <bdi className="body-lg tnum">{money(r.outstandingCents)}</bdi>
                </div>
                <div className="row between caption muted">
                  <span>
                    <bdi>{r.number}</bdi>
                    {!isAgent && ` · ${r.agentName}`}
                  </span>
                  {late(r)}
                </div>
                {actions(r)}
                {open === r.orderId && <ReminderEditor row={r} onDone={() => setOpen(null)} />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
