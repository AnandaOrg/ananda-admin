'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { isoDate } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, Chips, DownloadSimple, EmptyState, ErrorState, KpiTile, ListCard, PageHeader, PageSkeleton, Receipt, SelectPill, SlidersHorizontal, Table, type Column } from '@/components/ui';
import { PurchasingTabs } from '../_components/PurchasingTabs';
import { PayableStatusPill, useKindLabel } from '../_components/PurchaseStatus';
import { RecordPaymentSheet } from '../_components/RecordPaymentSheet';
import type { Payable, PayableKind } from '../_lib/types';

type Filter = 'open' | 'due_soon' | 'overdue' | 'paid' | 'all';
interface PayableList {
  items: Payable[];
  tiles: { toPayCents: number; dueSoonCents: number; overdueCents: number };
  counts: Record<Filter, number>;
  accounts: string[];
}

/** FR-PUR-4: supplier invoices, freight and excise by due date, with Record payment. */
export default function PayablesPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const { canEdit, can, readOnly } = useSession();
  const { money, date, dateShort } = useFmt();
  const kindLabel = useKindLabel();
  const initial = params.get('filter') as Filter | null;
  const [filter, setFilter] = useState<Filter>(initial && ['open', 'due_soon', 'overdue', 'paid', 'all'].includes(initial) ? initial : 'open');
  const [kind, setKind] = useState<PayableKind | null>(null);
  const [paying, setPaying] = useState<Payable | null>(null);
  const query = qs({ filter, kind });
  const list = useQuery({ queryKey: ['payables', query], queryFn: () => api.get<PayableList>(`/payables${query}`) });
  const canPay = canEdit('purchasing') && can('record_supplier_payment') && !readOnly;
  const today = isoDate();

  if (list.isLoading) return <PageSkeleton />;
  const d = list.data;
  const rows = d?.items ?? [];
  const chips = (['open', 'due_soon', 'overdue', 'paid', 'all'] as Filter[]).map((f) => ({ value: f, label: t(`payables.filters.${f}`), count: d?.counts[f] }));

  const columns: Column<Payable>[] = [
    { key: 'due', header: t('payables.cols.due'), render: (p) => <span className={`nowrap ${p.overdue ? 'bad' : ''}`}>{date(p.dueOn)}</span> },
    {
      key: 'party',
      header: t('payables.cols.party'),
      render: (p) => (
        <>
          <span className="nm">
            <bdi>{p.party}</bdi>
          </span>
          <span className="sb">
            {kindLabel(p.kind)}
            {p.invoiceNumber && (
              <>
                {' · '}
                <bdi>{p.invoiceNumber}</bdi>
              </>
            )}
          </span>
        </>
      ),
    },
    {
      key: 'purchase',
      header: t('cols.purchase'),
      render: (p) =>
        p.purchaseId ? (
          <Link href={`/purchasing/${p.purchaseId}`} className="link" onClick={(e) => e.stopPropagation()}>
            <bdi>{p.purchaseNumber}</bdi>
          </Link>
        ) : (
          '—'
        ),
    },
    { key: 'amount', header: t('payables.cols.amount'), type: 'amount', render: (p) => <bdi>{money(p.amountCents)}</bdi> },
    { key: 'left', header: t('pay.stillToPay'), type: 'amount', render: (p) => <bdi>{money(p.stillToPayCents)}</bdi> },
    { key: 'status', header: tc('status'), render: (p) => <PayableStatusPill p={p} today={today} /> },
    ...(canPay
      ? [
          {
            key: 'act',
            header: <span className="sr-only">{t('pay.title')}</span>,
            type: 'amount' as const,
            render: (p: Payable) =>
              p.stillToPayCents > 0 ? (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPaying(p);
                  }}
                >
                  {t('pay.title')}
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.purchasing'), href: '/purchasing' }, { label: t('tabs.payables') }]}
        kicker={t('payables.kicker', { n: d?.counts.open ?? 0 })}
        title={t('tabs.payables')}
        actions={
          <a className="an-btn secondary sm" href={`/api/payables/export.csv${query}`}>
            <DownloadSimple className="an-ic sm" aria-hidden />
            {tc('exportCsv')}
          </a>
        }
      />
      <PurchasingTabs current="payables" />
      {d && (
        <div className="kpis" style={{ ['--n' as string]: 3 }}>
          <KpiTile label={t('payables.tiles.toPay')} value={money(d.tiles.toPayCents, true)} sub={t('payables.tiles.bills', { n: d.counts.open })} onClick={() => setFilter('open')} />
          <KpiTile label={t('payables.tiles.dueSoon')} value={money(d.tiles.dueSoonCents, true)} sub={t('payables.tiles.bills', { n: d.counts.due_soon })} onClick={() => setFilter('due_soon')} />
          <KpiTile label={t('payables.tiles.overdue')} value={money(d.tiles.overdueCents, true)} valueTone={d.tiles.overdueCents > 0 ? 'bad' : undefined} sub={t('payables.tiles.bills', { n: d.counts.overdue })} subTone={d.counts.overdue > 0 ? 'bad' : undefined} onClick={() => setFilter('overdue')} />
        </div>
      )}
      <Chips options={chips} value={filter} onChange={setFilter} label={tc('filters')} />
      <div className="toolbar">
        <SelectPill
          icon={SlidersHorizontal}
          label={t('payables.kindLabel')}
          value={kind ? kindLabel(kind) : t('payables.anyKind')}
          items={[
            { key: 'any', label: t('payables.anyKind'), selected: !kind, onSelect: () => setKind(null) },
            ...(['supplier_invoice', 'freight', 'excise'] as PayableKind[]).map((k) => ({ key: k, label: kindLabel(k), selected: k === kind, onSelect: () => setKind(k) })),
          ]}
        />
      </div>
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState done={filter !== 'paid' && filter !== 'all'} icon={Receipt} title={t(`payables.empty.${filter === 'paid' || filter === 'all' ? 'none' : 'clear'}`)} text={filter !== 'paid' && filter !== 'all' ? t('payables.empty.text') : undefined} action={filter !== 'all' ? <Button onClick={() => setFilter('all')}>{t('payables.showAll')}</Button> : undefined} />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(p) => p.id} onRow={canPay ? (p) => p.stillToPayCents > 0 && setPaying(p) : undefined} rowClass={(p) => (p.stillToPayCents === 0 ? 'muted' : '')} />
          </Card>
          <div className="list-cards only-phone">
            {rows.map((p) => (
              <ListCard
                key={p.id}
                onClick={canPay && p.stillToPayCents > 0 ? () => setPaying(p) : undefined}
                href={!canPay || p.stillToPayCents === 0 ? (p.purchaseId ? `/purchasing/${p.purchaseId}` : undefined) : undefined}
                title={<bdi>{p.party}</bdi>}
                amount={money(p.stillToPayCents > 0 ? p.stillToPayCents : p.amountCents)}
                sub={
                  <>
                    {kindLabel(p.kind)} · {t('payables.dueOn', { date: dateShort(p.dueOn) })}
                    {p.purchaseNumber && (
                      <>
                        {' · '}
                        <bdi>{p.purchaseNumber}</bdi>
                      </>
                    )}
                  </>
                }
                status={<PayableStatusPill p={p} today={today} />}
              />
            ))}
          </div>
        </>
      )}
      {canPay && <RecordPaymentSheet payable={paying} accounts={d?.accounts} onClose={() => setPaying(null)} />}
    </div>
  );
}
