'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Card, CalendarDots, Chips, EmptyState, KpiTile, LoadError, PageHeader, PageState, Plus, TABLE_PICKERS, Table, type Column } from '@/components/ui';
import { MonthRangeCalendar, monthName, monthPreset, monthRangeLabel, monthShort, rangeQuery, useDayRange, type MonthPreset } from '../_components/range-calendar';
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
}

interface Pnl {
  period: { from: string; to: string };
  compare: { from: string; to: string; netCents: number };
  hasAny: boolean;
  totals: Omit<MonthRow, 'month' | 'hasData'>;
  months: MonthRow[];
  cash: CashOnHand;
}

/**
 * FR-MON-2 Monthly P&L. `?bank=1` opens Record bank balance (the Home task links here).
 * Months run oldest to newest on desktop and newest first on the phone.
 */
export default function PnlPage() {
  const t = useTranslations('money');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const locale = useLocale();
  const { canEdit, canView } = useSession();
  const { money } = useFmt();
  const [range, setRange] = useDayRange<MonthPreset>(monthPreset, 'this_year');
  const canRecord = canEdit('pnl') || canEdit('expenses');
  const [bankOpen, setBankOpen] = useState(false);
  useEffect(() => {
    if (params.get('bank') === '1' && canRecord) setBankOpen(true);
  }, [params, canRecord]);
  const closeBank = () => {
    setBankOpen(false);
    if (params.get('bank')) router.replace(pathname);
  };

  const query = qs(rangeQuery(range));
  const q = useQuery({ queryKey: ['money', 'pnl', query], queryFn: () => api.get<Pnl>(`/money/pnl${query}`), placeholderData: keepPreviousData });
  const d = q.data;

  // Signed amounts: losses in red with a minus, profit in green.
  const signed = (c: number) => <bdi className={c < 0 ? css.bad : c > 0 ? css.good : undefined}>{money(c)}</bdi>;
  const plain = (c: number) => <bdi>{money(c)}</bdi>;
  const monthCell = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    const i = y * 12 + mo - 1;
    return <span className="nowrap">{`${monthShort(i, locale)} ${String(y).slice(2)}`}</span>;
  };
  const columns: Column<MonthRow>[] = [
    { key: 'month', header: t('cols.month'), render: (m) => monthCell(m.month) },
    { key: 'net', header: t('cols.netSales'), type: 'amount', render: (m) => plain(m.netCents) },
    { key: 'cost', header: t('cols.purchaseCost'), type: 'amount', render: (m) => plain(m.purchaseCostCents) },
    { key: 'commission', header: t('cols.commission'), type: 'amount', render: (m) => plain(m.commissionCents) },
    { key: 'dealProfit', header: t('cols.dealProfit'), type: 'amount', render: (m) => <bdi className={m.dealProfitCents < 0 ? css.bad : undefined}>{money(m.dealProfitCents)}</bdi> },
    { key: 'expenses', header: t('cols.expenses'), type: 'amount', render: (m) => plain(m.expensesCents) },
    { key: 'operating', header: t('cols.operatingProfit'), type: 'amount', render: (m) => (m.hasData ? signed(m.operatingProfitCents) : plain(m.operatingProfitCents)) },
  ];

  if (!d) return <PageState query={q} />;
  const label = monthRangeLabel(range.from, range.to, locale);
  const bank = <BankBalanceSheet open={bankOpen} onClose={closeBank} cash={d.cash} />;

  // First use: no paid deal and no expense yet.
  if (!d.hasAny) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tc('nav.pnl') }]} kicker={t('pnl.empty.kicker')} title={tc('nav.pnl')} />
        <Card>
          <EmptyState
            icon={CalendarDots}
            title={t('pnl.empty.title')}
            text={t('pnl.empty.text')}
            action={
              canView('expenses') && canEdit('expenses') ? (
                <Link className="an-btn secondary" href="/money/expenses?new=1">
                  <Plus className="an-ic sm" aria-hidden />
                  {t('pnl.empty.add')}
                </Link>
              ) : undefined
            }
          />
        </Card>
        {bank}
      </div>
    );
  }

  const tot = d.totals;
  const extra = range.preset === 'custom' ? [{ value: 'custom' as MonthPreset, label: t('period.customChip', { range: label }) }] : [];
  const periodWord = range.preset === 'custom' ? t('period.inRange') : t(`period.${range.preset}`);
  const newestFirst = [...d.months].reverse();

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.pnl') }]}
        kicker={<span className="only-wide">{t('pnl.kicker', { range: monthRangeLabel(d.compare.from, d.compare.to, locale) })}</span>}
        title={tc('nav.pnl')}
        actions={
          <span className="only-wide">
            <MonthRangeCalendar value={range} onChange={setRange} />
          </span>
        }
      />

      {/* Desktop and tablet */}
      <div className="only-wide stack">
        <Chips
          fill={false}
          label={t('period.label')}
          value={range.preset}
          onChange={(v) => v !== 'custom' && setRange(monthPreset(v as Exclude<MonthPreset, 'custom'>))}
          options={[...(['this_year', 'last_12_months', 'last_year'] as const).map((p) => ({ value: p as MonthPreset, label: t(`period.${p}`) })), ...extra]}
        />
        <div className="kpis">
          <KpiTile label={t('pnl.netSales')} value={money(tot.netCents, true)} sub={t('pnl.netSub', { amount: money(d.compare.netCents, true) })} />
          <KpiTile label={t('pnl.dealProfit')} value={money(tot.dealProfitCents, true)} valueTone={tot.dealProfitCents > 0 ? 'good' : tot.dealProfitCents < 0 ? 'bad' : undefined} sub={t('pnl.dealProfitSub')} />
          <KpiTile label={t('pnl.expenses')} value={money(tot.expensesCents, true)} sub={t('pnl.expensesSub')} onClick={canView('expenses') ? () => router.push('/money/expenses') : undefined} />
          <KpiTile label={t('pnl.operatingProfit')} value={money(tot.operatingProfitCents, true)} valueTone={tot.operatingProfitCents > 0 ? 'good' : tot.operatingProfitCents < 0 ? 'bad' : undefined} sub={t('pnl.operatingSub')} />
        </div>
        <Card flush>
          {q.error ? (
            <LoadError error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <Table
              columns={columns}
              rows={d.months}
              rowKey={(m) => m.month}
              rowClass={(m) => (!m.hasData ? css.dim : '')}
              empty={<span className="muted">{t('pnl.noMonths', { range: label })}</span>}
              picker={TABLE_PICKERS.monthlyPnl}
            />
          )}
          <div className={css.foot}>{t('pnl.rule')}</div>
        </Card>
      </div>

      {/* Phone: each month is a card, newest first */}
      <div className="only-phone stack">
        <div className={css.pair}>
          <KpiTile label={t('pnl.dealProfit')} value={money(tot.dealProfitCents, true)} valueTone={tot.dealProfitCents > 0 ? 'good' : tot.dealProfitCents < 0 ? 'bad' : undefined} />
          <KpiTile label={t('pnl.operatingProfit')} value={money(tot.operatingProfitCents, true)} valueTone={tot.operatingProfitCents > 0 ? 'good' : tot.operatingProfitCents < 0 ? 'bad' : undefined} />
        </div>
        <span className={css.small}>{t('pnl.phoneNote', { period: periodWord })}</span>
        {newestFirst.map((m) => {
          const [y, mo] = m.month.split('-').map(Number);
          const last = new Date(y, mo, 0);
          const to = `${y}-${String(mo).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
          return (
            <Link key={m.month} href={canView('deal_profit') ? `/money/deal-profit?from=${m.month}&to=${to < range.to ? to : range.to}` : '/money/expenses'} className={`${css.box} ${css.cardBtn} ${!m.hasData ? css.dimBox : ''}`}>
              <div className={`${css.line} ${css.head}`}>
                <span>{monthName(y * 12 + mo - 1, locale)}</span>
                {m.hasData ? signed(m.operatingProfitCents) : plain(m.operatingProfitCents)}
              </div>
              {m.hasData ? (
                <>
                  <div className={css.line}>
                    <span>{t('cols.netSales')}</span>
                    <bdi>{money(m.netCents)}</bdi>
                  </div>
                  <div className={css.line}>
                    <span>{t('cols.dealProfit')}</span>
                    <bdi>{money(m.dealProfitCents)}</bdi>
                  </div>
                  <div className={css.line}>
                    <span>{t('cols.expenses')}</span>
                    <bdi>{money(-m.expensesCents)}</bdi>
                  </div>
                </>
              ) : (
                <span className={css.small}>{t('pnl.emptyMonth')}</span>
              )}
            </Link>
          );
        })}
      </div>
      {bank}
    </div>
  );
}
