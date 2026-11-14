'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Bank, Button, Card, EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton, Pill, Plus, Receipt, Table, type Column } from '@/components/ui';
import { PurchasingTabs, TableFoot, usePurchaseSummary } from '../_components/PurchasingTabs';
import { NewPurchaseSheet } from '../_components/NewPurchaseSheet';
import { useKindLabel, useMonthName } from '../_components/PurchaseStatus';
import { RecordPaymentSheet } from '../_components/RecordPaymentSheet';
import type { Payable } from '../_lib/types';

interface PayableList {
  items: Payable[];
  tiles: { toPayCents: number; dueSoonCents: number; overdueCents: number; oldestDueOn: string | null };
  counts: { open: number; due_soon: number; overdue: number; paid: number; all: number };
  accounts: string[];
}

/** FR-PUR-4: what ANANDA owes suppliers — purchase bills, freight and excise by due date, with Record payment. */
export default function PayablesPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const { canEdit, can, readOnly } = useSession();
  const { money, date, dateShort } = useFmt();
  const monthName = useMonthName();
  const kindLabel = useKindLabel();
  const [paying, setPaying] = useState<Payable | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['payables', 'board'], queryFn: () => api.get<PayableList>('/payables?filter=board') });
  const sum = usePurchaseSummary();
  const canPay = canEdit('purchasing') && can('record_supplier_payment') && !readOnly;
  const editable = canEdit('purchasing') && !readOnly;

  if (list.isLoading) return <PageSkeleton />;
  const d = list.data;
  const rows = d?.items ?? [];
  const forLabel = (p: Payable) => kindLabel(p.kind, { paidCents: p.stillToPayCents > 0 ? p.paidCents : 0, month: p.kind === 'excise' && p.arrivedOn ? monthName(p.arrivedOn) : null });
  const action = (p: Payable) =>
    p.stillToPayCents > 0 ? (
      canPay ? (
        <Button
          size="sm"
          icon={Bank}
          onClick={(e) => {
            e.stopPropagation();
            setPaying(p);
          }}
        >
          {t('pay.title')}
        </Button>
      ) : null
    ) : (
      <Pill tone="good">{p.paidToday ? t('payables.paidToday') : t('payables.status.paid')}</Pill>
    );

  const columns: Column<Payable>[] = [
    {
      key: 'party',
      header: t('payables.cols.supplier'),
      render: (p) => (
        <>
          <span className="nm">
            <bdi>{p.party}</bdi>
          </span>
          {p.purchaseNumber && p.purchaseId && (
            <Link href={`/purchasing/${p.purchaseId}`} className="sb" onClick={(e) => e.stopPropagation()}>
              <bdi>{p.purchaseNumber}</bdi>
            </Link>
          )}
        </>
      ),
    },
    { key: 'for', header: t('payables.cols.for'), render: forLabel },
    { key: 'due', header: t('payables.cols.due'), render: (p) => (p.stillToPayCents > 0 ? <span className={`nowrap ${p.overdue ? 'bad' : ''}`}>{date(p.dueOn)}</span> : t('payables.status.paid')) },
    { key: 'amount', header: t('payables.cols.amount'), type: 'amount', render: (p) => <bdi>{money(p.stillToPayCents)}</bdi> },
    { key: 'act', header: <span className="sr-only">{t('pay.title')}</span>, type: 'amount', render: action },
  ];

  const oldest = d?.tiles.oldestDueOn;
  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.purchasing'), href: '/purchasing' }, { label: t('tabs.payables') }]}
        kicker={t('payables.kicker')}
        title={tc('nav.purchasing')}
        actions={
          editable ? (
            <span className="only-wide">
              <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                {t('new.title')}
              </Button>
            </span>
          ) : undefined
        }
      />
      <PurchasingTabs current="payables" />
      {d && (
        <>
          <div className="kpis only-wide" style={{ ['--n' as string]: 3 }}>
            <KpiTile label={t('payables.tiles.toPay')} value={money(d.tiles.toPayCents)} sub={t('payables.tiles.bills', { n: d.counts.open })} />
            <KpiTile label={t('payables.tiles.dueSoon')} value={money(d.tiles.dueSoonCents)} sub={oldest ? t('payables.tiles.oldestDue', { date: dateShort(oldest) }) : t('payables.tiles.nothingDue')} />
            <KpiTile label={t('payables.tiles.overdue')} value={money(d.tiles.overdueCents)} valueTone={d.tiles.overdueCents > 0 ? 'bad' : undefined} sub={d.counts.overdue ? t('payables.tiles.bills', { n: d.counts.overdue }) : t('payables.tiles.nothingLate')} subTone={d.counts.overdue ? 'bad' : undefined} />
          </div>
          <div className="kpis only-phone">
            <KpiTile label={t('payables.tiles.toPay')} value={money(d.tiles.toPayCents)} sub={t('payables.tiles.bills', { n: d.counts.open })} />
            <KpiTile label={t('payables.tiles.overdue')} value={money(d.tiles.overdueCents)} valueTone={d.tiles.overdueCents > 0 ? 'bad' : undefined} sub={d.counts.overdue ? t('payables.tiles.bills', { n: d.counts.overdue }) : t('payables.tiles.nothingLate')} />
          </div>
        </>
      )}
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState done={(sum.data?.counts.all ?? 0) > 0} icon={Receipt} title={t('payables.empty.clear')} text={t('payables.empty.text')} />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(p) => p.id} />
            <TableFoot>{t('payables.foot')}</TableFoot>
          </Card>
          <div className="list-cards only-phone">
            {rows.map((p) => (
              <div key={p.id} className="an-card" style={{ gap: 'var(--space-1)', padding: 'var(--space-4)' }}>
                <div className="row between">
                  <b style={{ fontWeight: 500 }}>
                    <bdi>{p.party}</bdi>
                  </b>
                  <b style={{ fontWeight: 500 }}>
                    <bdi>{money(p.stillToPayCents)}</bdi>
                  </b>
                </div>
                <div className="row between body-sm">
                  <span className="muted">
                    {forLabel(p)}
                    {p.purchaseNumber && (
                      <>
                        {' · '}
                        <bdi>{p.purchaseNumber}</bdi>
                      </>
                    )}
                  </span>
                  <span className={p.overdue ? 'bad' : 'muted'}>{p.stillToPayCents > 0 ? t('payables.dueOn', { date: date(p.dueOn) }) : t('payables.status.paid')}</span>
                </div>
                {(p.stillToPayCents > 0 ? canPay : true) && <div style={{ marginTop: 'var(--space-2)' }}>{action(p)}</div>}
              </div>
            ))}
          </div>
        </>
      )}
      {canPay && <RecordPaymentSheet payable={paying} accounts={d?.accounts} onClose={() => setPaying(null)} />}
      {editable && <NewPurchaseSheet open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}
