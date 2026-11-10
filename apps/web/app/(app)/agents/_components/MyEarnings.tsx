'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { Card, EmptyState, ErrorState, KpiTile, ListCard, Money, PageHeader, PageSkeleton, Pill, Table, type Column } from '@/components/ui';
import { COMMISSION_TONE, entryHref, type CommissionEntry, type Earnings } from './types';

interface MyRequest {
  id: string;
  type: 'new_customer' | 'special_price' | 'correction';
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  createdAt: string;
  decidedAt: string | null;
  declineReason: string | null;
  declineMessage: string | null;
  customerName: string | null;
  orderNumber: string | null;
  orderId: string | null;
  customerId: string | null;
}

const REQUEST_TONE = { pending: 'warn', approved: 'good', declined: 'bad', withdrawn: 'mute' } as const;

/** The agent's own view (FR-AGT-5): same words and figures as the admin view, own data only. */
export function MyEarnings() {
  const t = useTranslations('agents');
  const tc = useTranslations('common');
  const router = useRouter();
  const { money, date, dateShort, num } = useFmt();
  const q = useQuery({ queryKey: ['agents', 'me'], queryFn: () => api.get<Earnings>('/agents/me/earnings') });
  const reqs = useQuery({ queryKey: ['approvals', 'mine'], queryFn: () => api.get<MyRequest[]>('/approvals/mine') });

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { totals, entries } = q.data;

  const status = (e: CommissionEntry) => <Pill tone={COMMISSION_TONE[e.status]}>{t(`earnings.status_${e.status}`)}</Pill>;
  const when = (e: CommissionEntry) => e.paidAt ?? e.sentAt ?? e.readyAt ?? e.createdAt;
  const columns: Column<CommissionEntry>[] = [
    {
      key: 'order',
      header: t('earnings.order'),
      render: (e) => (
        <>
          <span className="nm">{e.orderId ? (e.customerName ?? '—') : (e.eventName ?? '—')}</span>
          <span className="sb">
            {e.orderId ? <bdi>{e.orderNumber}</bdi> : t('earnings.eventSale')}
            {e.orderId && e.note && ` · ${e.note}`}
          </span>
        </>
      ),
    },
    { key: 'date', header: t('earnings.date'), render: (e) => <span className="nowrap">{date(when(e))}</span> },
    { key: 'units', header: t('earnings.units'), type: 'count', render: (e) => num(e.units) },
    { key: 'amount', header: t('earnings.commission'), type: 'amount', render: (e) => <bdi className={e.amountCents < 0 ? 'bad' : ''}>{money(e.amountCents)}</bdi> },
    { key: 'status', header: t('earnings.status'), render: status },
  ];

  const requests = reqs.data ?? [];
  const reqAbout = (r: MyRequest) => r.customerName ?? r.orderNumber ?? '—';
  const reqDecision = (r: MyRequest) => (
    <span className="stack tight" style={{ gap: 2, justifyItems: 'start' }}>
      <Pill tone={REQUEST_TONE[r.status]}>{t(`requests.statuses.${r.status}`)}</Pill>
      {r.status === 'declined' && r.declineReason && (
        <span className="caption muted">
          {t('requests.declinedBecause', { reason: tc.has(`reasons.decline.${r.declineReason}`) ? tc(`reasons.decline.${r.declineReason}`) : r.declineReason })}
          {r.declineMessage && ` · ${r.declineMessage}`}
        </span>
      )}
    </span>
  );
  const reqCols: Column<MyRequest>[] = [
    { key: 'type', header: t('requests.type'), render: (r) => t(`requests.types.${r.type}`) },
    {
      key: 'about',
      header: t('requests.about'),
      render: (r) => (
        <>
          <span className="nm">{reqAbout(r)}</span>
          {r.orderNumber && r.customerName && (
            <span className="sb">
              <bdi>{r.orderNumber}</bdi>
            </span>
          )}
        </>
      ),
    },
    { key: 'date', header: t('requests.date'), render: (r) => <span className="nowrap">{date(r.createdAt)}</span> },
    { key: 'decision', header: t('requests.decision'), render: reqDecision },
  ];
  const openReq = (r: MyRequest) => (r.orderId ? router.push(`/sales/${r.orderId}`) : r.customerId ? router.push(`/customers/${r.customerId}`) : undefined);

  return (
    <div className="page">
      <PageHeader crumbs={[{ label: t('earnings.title') }]} kicker={t('earnings.kicker')} title={t('earnings.title')} />
      <div className="kpis">
        <KpiTile label={t('tiles.ready')} value={money(totals.readyCents, true)} sub={t('earnings.readySub')} />
        <KpiTile label={t('tiles.coming')} value={money(totals.comingCents, true)} sub={t('tiles.comingSub')} />
        <KpiTile label={t('earnings.sent')} value={money(totals.sentCents, true)} sub={t('earnings.sentSub')} />
        <KpiTile label={t('earnings.paid')} value={money(totals.paidThisYearCents, true)} />
      </div>

      <Card flush title={t('earnings.entriesTitle')}>
        {entries.length === 0 ? (
          <EmptyState icon={Money} title={t('earnings.emptyTitle')} text={t('earnings.emptyText')} />
        ) : (
          <>
            <div className="only-wide">
              <Table columns={columns} rows={entries} rowKey={(e) => e.id} onRow={(e) => { const h = entryHref(e); if (h) router.push(h); }} />
            </div>
            <div className="list-cards only-phone" style={{ padding: 'var(--space-3)' }}>
              {entries.map((e) => (
                <ListCard
                  key={e.id}
                  href={entryHref(e)}
                  title={e.orderId ? (e.customerName ?? e.orderNumber) : (e.eventName ?? t('earnings.eventSale'))}
                  amount={money(e.amountCents)}
                  sub={
                    <>
                      {e.orderId ? <bdi>{e.orderNumber}</bdi> : t('earnings.eventSale')} · {tc('unitsCount', { n: num(e.units) })} · {dateShort(when(e))}
                    </>
                  }
                  status={status(e)}
                />
              ))}
            </div>
          </>
        )}
      </Card>

      <Card flush title={t('requests.title')}>
        {reqs.error ? (
          <div style={{ padding: 'var(--space-3)' }}>
            <ErrorState error={reqs.error} retry={() => reqs.refetch()} />
          </div>
        ) : requests.length === 0 ? (
          <EmptyState title={t('requests.title')} text={t('requests.empty')} />
        ) : (
          <>
            <div className="only-wide">
              <Table columns={reqCols} rows={requests} rowKey={(r) => r.id} onRow={openReq} />
            </div>
            <div className="list-cards only-phone" style={{ padding: 'var(--space-3)' }}>
              {requests.map((r) => (
                <ListCard key={r.id} onClick={() => openReq(r)} title={reqAbout(r)} sub={`${t(`requests.types.${r.type}`)} · ${dateShort(r.createdAt)}`} status={reqDecision(r)} />
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
