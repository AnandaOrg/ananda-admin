'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Bank, Banner, Button, Card, DownloadSimple, EmptyState, ErrorState, KpiTile, ListCard, PageHeader, PageSkeleton, Receipt, Table, type Column } from '@/components/ui';
import { PeriodPill, periodQuery, usePeriodLine, type PeriodValue } from '../_components/period';
import { useColumnPicker } from '../_components/columns';
import { BankBalanceSheet, type CashOnHand } from '../_components/bank-balance-sheet';
import css from '../money.module.css';

interface MonthRow {
  month: string;
  netCents: number;
  purchaseCostCents: number;
  commissionCents: number;
  dealProfitCents: number;
  expensesCents: number;
  operatingProfitCents: number;
  deals: number;
  hasData: boolean;
  total?: boolean;
}

interface Pnl {
  period: { from: string; to: string };
  totals: Omit<MonthRow, 'month' | 'hasData'>;
  months: MonthRow[];
  cash: CashOnHand;
}

/** FR-MON-2 Monthly P&L and FR-MON-4 cash on hand. `?bank=1` opens Record bank balance (Home links here). */
export default function PnlPage() {
  const t = useTranslations('money');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { canEdit } = useSession();
  const { money, month, date } = useFmt();
  const periodLine = usePeriodLine();
  const [period, setPeriod] = useState<PeriodValue>({ kind: 'this_year' });
  const canRecord = canEdit('pnl') || canEdit('expenses');
  const [bankOpen, setBankOpen] = useState(false);
  useEffect(() => {
    if (params.get('bank') === '1' && canRecord) setBankOpen(true);
  }, [params, canRecord]);
  const closeBank = () => {
    setBankOpen(false);
    if (params.get('bank')) router.replace(pathname);
  };

  const query = qs(periodQuery(period));
  const q = useQuery({ queryKey: ['money', 'pnl', query], queryFn: () => api.get<Pnl>(`/money/pnl${query}`) });

  const amount = (c: number, strong?: boolean) => <bdi className={`${c < 0 ? 'bad' : ''} ${strong ? 'strong' : ''}`}>{money(c)}</bdi>;
  const columns: Column<MonthRow>[] = [
    { key: 'month', header: t('cols.month'), render: (m) => (m.total ? <span className="nm">{t('pnl.total')}</span> : <span className="nowrap">{month(m.month)}</span>) },
    { key: 'net', header: t('cols.netSales'), type: 'amount', render: (m) => amount(m.netCents) },
    { key: 'cost', header: t('cols.purchaseCost'), type: 'amount', render: (m) => amount(m.purchaseCostCents) },
    { key: 'commission', header: t('cols.commission'), type: 'amount', render: (m) => amount(m.commissionCents) },
    { key: 'dealProfit', header: t('cols.dealProfit'), type: 'amount', render: (m) => amount(m.dealProfitCents) },
    { key: 'expenses', header: t('cols.expensesExclVat'), type: 'amount', render: (m) => amount(m.expensesCents) },
    { key: 'operating', header: t('cols.operatingProfit'), type: 'amount', render: (m) => amount(m.operatingProfitCents, true) },
  ];
  const pick = useColumnPicker('monthly-pnl', columns, { locked: ['month', 'operating'], defaults: ['net', 'dealProfit', 'expenses'] });

  if (q.isLoading) return <PageSkeleton />;
  const d = q.data;
  const cash = d?.cash;
  const stale = !cash?.asOf || (cash.daysOld ?? 0) > 7;
  const rows: MonthRow[] = d ? [...d.months, { ...d.totals, month: 'total', hasData: true, total: true }] : [];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.pnl') }]}
        kicker={d ? periodLine(d.period) : undefined}
        title={tc('nav.pnl')}
        actions={
          <>
            <PeriodPill value={period} onChange={setPeriod} options={['this_year', 'last_12_months', 'last_year', 'custom']} />
            <a className="an-btn secondary sm" href={`/api/money/pnl/export.csv${query}`}>
              <DownloadSimple className="an-ic sm" aria-hidden />
              {tc('exportCsv')}
            </a>
            {canRecord && (
              <Button size="sm" variant="primary" icon={Bank} onClick={() => setBankOpen(true)}>
                {t('bank.record')}
              </Button>
            )}
          </>
        }
      />
      {q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : (
        d && (
          <>
            <div className="kpis">
              <KpiTile label={t('pnl.netSales')} value={money(d.totals.netCents, true)} sub={t('dealsCount', { n: d.totals.deals })} link={{ href: '/money/deal-profit', label: t('pnl.open') }} />
              <KpiTile label={t('pnl.dealProfit')} value={money(d.totals.dealProfitCents, true)} valueTone={d.totals.dealProfitCents < 0 ? 'bad' : undefined} sub={t('pnl.dealProfitSub')} />
              <KpiTile label={t('pnl.expenses')} value={money(d.totals.expensesCents, true)} sub={t('pnl.expensesSub')} link={{ href: '/money/expenses', label: t('pnl.open') }} />
              <KpiTile label={t('pnl.operatingProfit')} value={money(d.totals.operatingProfitCents, true)} valueTone={d.totals.operatingProfitCents >= 0 ? 'good' : 'bad'} sub={t('pnl.operatingSub')} />
            </div>

            {stale && (
              <Banner tone="bad" sub={t('bank.missingSub')} action={canRecord ? { label: t('bank.record'), onClick: () => setBankOpen(true) } : undefined}>
                {cash?.asOf ? t('bank.stale', { n: cash.daysOld ?? 0 }) : t('bank.none')}
              </Banner>
            )}

            <Card title={t('bank.cashOnHand')} action={canRecord && !stale ? <Button size="sm" onClick={() => setBankOpen(true)}>{t('bank.record')}</Button> : undefined}>
              <div className={css.cash}>
                <span className="title-1">
                  <bdi>{money(cash?.cents ?? 0)}</bdi>
                </span>
                {cash?.asOf && <span className="muted body-sm">{t('bank.asOf', { date: date(cash.asOf) })}</span>}
              </div>
              {(cash?.accounts.length ?? 0) > 1 && (
                <div className="an-tot">
                  {cash!.accounts.map((a) => (
                    <div key={a.account}>
                      <span>
                        {a.account} · {date(a.balanceOn)}
                      </span>
                      <bdi>{money(a.balanceCents)}</bdi>
                    </div>
                  ))}
                </div>
              )}
              {cash?.accounts.length === 1 && <span className="muted body-sm">{cash.accounts[0].account}</span>}
            </Card>

            <div className="row between">
              <h2 className="title-3" style={{ margin: 0 }}>
                {t('pnl.byMonth')}
              </h2>
              {pick.button}
            </div>
            {d.months.length === 0 ? (
              <Card>
                <EmptyState icon={Receipt} title={t('empty.pnlTitle')} text={t('empty.pnlText')} />
              </Card>
            ) : (
              <>
                <Card flush className="only-wide">
                  <Table columns={pick.visible} rows={rows} rowKey={(m) => m.month} rowClass={(m) => (m.total ? css.totalRow : !m.hasData ? css.noData : '')} />
                </Card>
                <div className="list-cards only-phone">
                  {rows.map((m) => (
                    <ListCard
                      key={m.month}
                      title={m.total ? t('pnl.total') : <span className={!m.hasData ? 'subtle' : undefined}>{month(m.month)}</span>}
                      amount={<span className={m.operatingProfitCents < 0 ? 'bad' : !m.hasData ? 'subtle' : undefined}>{money(m.operatingProfitCents)}</span>}
                      sub={t('pnl.phoneSub', { profit: money(m.dealProfitCents), expenses: money(m.expensesCents) })}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )
      )}
      <BankBalanceSheet open={bankOpen} onClose={closeBank} cash={cash} />
    </div>
  );
}
