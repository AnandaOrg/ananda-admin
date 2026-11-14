'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FLAVOURS, type Flavour } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, ChartLineUp, Chips, ColumnsSlot, EmptyState, FlavourName, Info, KpiTile, LoadError, NoAccess, PageHeader, PageState, Table, X, type Column } from '@/components/ui';
import { DayRangeCalendar, dayPreset, dayRangeLabel, rangeQuery, useDayRange, type DayPreset } from '../_components/range-calendar';
import css from '../money.module.css';

interface Figures {
  netCents: number;
  purchaseCostCents: number;
  commissionCents: number;
  profitCents: number;
}

interface Deal extends Figures {
  id: string;
  kind: 'deal' | 'credit_note';
  orderId: string;
  number: string;
  documentNumber: string | null;
  customerId: string | null;
  customerName: string | null;
  brokerId: string;
  brokerName: string;
  paidAt: string;
  units: number;
}

interface FlavourGroup extends Figures {
  key: string;
  units: number;
}

interface DealProfit {
  period: { from: string; to: string };
  summary: Figures & { grossCents: number; units: number; deals: number; costPerUnitCents: number; commissionPerUnitCents: number };
  compare: { from: string; to: string; netCents: number };
  hasAny: boolean;
  deals: Deal[];
  byFlavour: FlavourGroup[];
}

interface Group extends Figures {
  key: string;
  name: string;
  other: string[];
  deals: number;
  units: number;
  total?: boolean;
}

type Tab = 'deals' | 'customers' | 'brokers' | 'flavours';
type ChipPreset = 'this_year' | 'this_month' | 'last_month' | 'last_year';

/** FR-MON-1: deal profit, counted on the date the customer paid in full. */
export default function DealProfitPage() {
  const t = useTranslations('money');
  const { canView } = useSession();
  if (!canView('deal_profit')) {
    return (
      <div className="page">
        <NoAccess text={t('deal.noAccess')} back={{ label: t('backToOverview'), href: '/home' }} />
      </div>
    );
  }
  return <DealProfit />;
}

function DealProfit() {
  const t = useTranslations('money');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const locale = useLocale();
  const { money, num, date } = useFmt();
  const fromUrl = params.get('from');
  const toUrl = params.get('to');
  const [range, setRange] = useDayRange<DayPreset>(dayPreset, fromUrl && toUrl ? { preset: 'custom', from: fromUrl, to: toUrl } : 'this_year');
  const [tab, setTabRaw] = useState<Tab>('deals');
  const [filter, setFilter] = useState<{ by: 'customer' | 'broker'; key: string; name: string } | null>(null);
  const [how, setHow] = useState(false);
  const setTab = (v: Tab) => {
    setFilter(null);
    setTabRaw(v);
  };
  const query = qs(rangeQuery(range));
  const q = useQuery({ queryKey: ['money', 'deal-profit', query], queryFn: () => api.get<DealProfit>(`/money/deal-profit${query}`), placeholderData: keepPreviousData });

  const label = dayRangeLabel(range.from, range.to, locale);
  const pct = (p: number, n: number) => (n ? `${num((p / n) * 100, 1).replace(/[.,]0$/, '')}%` : '—');
  const profit = (c: number) => <bdi className={c > 0 ? css.good : c < 0 ? css.bad : undefined}>{money(c)}</bdi>;
  const amount = (c: number) => <bdi>{money(c)}</bdi>;

  const d = q.data;
  const deals = useMemo(() => d?.deals ?? [], [d]);
  const paidDeals = deals.filter((x) => x.kind === 'deal').length;

  // By customer / by broker: the same rows as the Deals tab, grouped (so every tab adds up the same).
  const group = (by: 'customer' | 'broker'): Group[] => {
    const m = new Map<string, Group & { o: Set<string> }>();
    for (const r of deals) {
      const key = by === 'customer' ? (r.customerId ?? 'none') : r.brokerId;
      const g = m.get(key) ?? { key, name: by === 'customer' ? (r.customerName ?? t('noCustomer')) : r.brokerName, other: [], o: new Set<string>(), deals: 0, units: 0, netCents: 0, purchaseCostCents: 0, commissionCents: 0, profitCents: 0 };
      g.o.add(by === 'customer' ? r.brokerName : (r.customerId ?? 'none'));
      if (r.kind === 'deal') g.deals += 1;
      g.units += r.units;
      g.netCents += r.netCents;
      g.purchaseCostCents += r.purchaseCostCents;
      g.commissionCents += r.commissionCents;
      g.profitCents += r.profitCents;
      m.set(key, g);
    }
    return [...m.values()].map(({ o, ...g }) => ({ ...g, other: [...o] })).sort((a, b) => b.profitCents - a.profitCents);
  };
  const sum = (rows: Figures[]) => rows.reduce((a, r) => ({ netCents: a.netCents + r.netCents, purchaseCostCents: a.purchaseCostCents + r.purchaseCostCents, commissionCents: a.commissionCents + r.commissionCents, profitCents: a.profitCents + r.profitCents }), { netCents: 0, purchaseCostCents: 0, commissionCents: 0, profitCents: 0 });
  const totalUnits = deals.reduce((a, r) => a + r.units, 0);
  const withTotal = (rows: Group[], other: (rs: Group[]) => string[]): Group[] => (rows.length > 1 ? [...rows, { key: 'total', name: t('deal.total'), other: other(rows), deals: paidDeals, units: totalUnits, ...sum(rows), total: true }] : rows);
  const customers = withTotal(group('customer'), () => []);
  const brokers = withTotal(group('broker'), () => [String(new Set(deals.map((r) => r.customerId ?? 'none')).size)]);
  const totalProfit = sum(deals).profitCents;
  const flavourRows: (FlavourGroup & { total?: boolean })[] = d && deals.length ? [...FLAVOURS.map((f) => d.byFlavour.find((g) => g.key === f) ?? { key: f, units: 0, netCents: 0, purchaseCostCents: 0, commissionCents: 0, profitCents: 0 }), { key: 'total', units: totalUnits, ...sum(deals), total: true }] : [];

  const strong = (g: { total?: boolean }, v: React.ReactNode) => (g.total ? <b>{v}</b> : v);
  const dealCols: Column<Deal>[] = [
    {
      key: 'deal',
      header: t('cols.deal'),
      render: (r) => (
        <>
          <span className="nm nowrap">{r.customerName ?? t('noCustomer')}</span>
          <span className="sb">
            <bdi>{r.number}</bdi>
            {r.kind === 'credit_note' && (
              <>
                {' · '}
                {t('creditNote')} <bdi>{r.documentNumber}</bdi>
              </>
            )}
          </span>
        </>
      ),
    },
    { key: 'broker', header: t('cols.broker'), render: (r) => r.brokerName },
    { key: 'paidOn', header: t('cols.paidOn'), render: (r) => <span className="nowrap">{date(r.paidAt)}</span> },
    { key: 'units', header: t('cols.units'), type: 'amount', render: (r) => num(r.units) },
    { key: 'net', header: t('cols.netSales'), type: 'amount', render: (r) => amount(r.netCents) },
    { key: 'cost', header: t('cols.purchaseCost'), type: 'amount', render: (r) => amount(r.purchaseCostCents) },
    { key: 'commission', header: t('cols.commission'), type: 'amount', render: (r) => amount(r.commissionCents) },
    { key: 'profit', header: t('cols.profit'), type: 'amount', render: (r) => profit(r.profitCents) },
  ];
  const customerCols: Column<Group>[] = [
    { key: 'customer', header: t('cols.customer'), render: (g) => (g.total ? <b>{g.name}</b> : <span className="nm nowrap">{g.name}</span>) },
    { key: 'broker', header: t('cols.broker'), render: (g) => g.other.join(', ') },
    { key: 'deals', header: t('cols.deals'), type: 'count', render: (g) => strong(g, num(g.deals)) },
    { key: 'units', header: t('cols.units'), type: 'amount', render: (g) => strong(g, num(g.units)) },
    { key: 'net', header: t('cols.netSales'), type: 'amount', render: (g) => strong(g, amount(g.netCents)) },
    { key: 'profit', header: t('cols.profit'), type: 'amount', render: (g) => strong(g, profit(g.profitCents)) },
    { key: 'margin', header: t('cols.margin'), type: 'amount', render: (g) => strong(g, pct(g.profitCents, g.netCents)) },
  ];
  const brokerCols: Column<Group>[] = [
    { key: 'broker', header: t('cols.broker'), render: (g) => (g.total ? <b>{g.name}</b> : <span className="nm nowrap">{g.name}</span>) },
    { key: 'customers', header: t('cols.customers'), type: 'count', render: (g) => strong(g, g.total ? g.other[0] : num(g.other.length)) },
    { key: 'deals', header: t('cols.deals'), type: 'count', render: (g) => strong(g, num(g.deals)) },
    { key: 'units', header: t('cols.units'), type: 'amount', render: (g) => strong(g, num(g.units)) },
    { key: 'net', header: t('cols.netSales'), type: 'amount', render: (g) => strong(g, amount(g.netCents)) },
    { key: 'commission', header: t('cols.commission'), type: 'amount', render: (g) => strong(g, amount(g.commissionCents)) },
    { key: 'profit', header: t('cols.profit'), type: 'amount', render: (g) => strong(g, profit(g.profitCents)) },
    { key: 'margin', header: t('cols.margin'), type: 'amount', render: (g) => strong(g, pct(g.profitCents, g.netCents)) },
  ];
  const flavourCols: Column<FlavourGroup & { total?: boolean }>[] = [
    { key: 'flavour', header: t('cols.flavour'), render: (g) => (g.total ? <b>{t('deal.total')}</b> : <FlavourName flavour={g.key as Flavour} />) },
    { key: 'units', header: t('cols.units'), type: 'amount', render: (g) => strong(g, num(g.units)) },
    { key: 'net', header: t('cols.netSales'), type: 'amount', render: (g) => strong(g, amount(g.netCents)) },
    { key: 'cost', header: t('cols.purchaseCost'), type: 'amount', render: (g) => strong(g, amount(g.purchaseCostCents)) },
    { key: 'commission', header: t('cols.commission'), type: 'amount', render: (g) => strong(g, amount(g.commissionCents)) },
    { key: 'profit', header: t('cols.profit'), type: 'amount', render: (g) => strong(g, profit(g.profitCents)) },
    { key: 'margin', header: t('cols.margin'), type: 'amount', render: (g) => strong(g, pct(g.profitCents, g.netCents)) },
    { key: 'share', header: t('cols.shareOfProfit'), type: 'amount', render: (g) => strong(g, pct(g.profitCents, totalProfit)) },
  ];

  if (!d) return <PageState query={q} />;
  const s = d.summary;
  const preset = range.preset;
  const compareSub = (() => {
    const amt = money(d.compare.netCents, true);
    if (preset === 'this_month' || preset === 'last_month') return t('deal.netSubMonth', { month: monthLong(d.compare.from, locale), amount: amt });
    if (preset === 'last_year') return t('deal.netSubYear', { year: d.compare.from.slice(0, 4), amount: amt });
    return t('deal.netSubLastYear', { amount: amt });
  })();
  const periodWord = ['this_year', 'this_month', 'last_month', 'last_year', 'today', 'this_week'].includes(preset) ? t(`period.${preset}`) : t('period.inRange');
  const noneText = range.from === range.to ? t('deal.noneOn', { range: label }) : t('deal.noneIn', { range: label });

  const header = (first: boolean) => (
    <PageHeader crumbs={[{ label: tc('nav.deal_profit') }]} kicker={<span className="only-wide">{t('deal.kicker')}</span>} title={tc('nav.deal_profit')} actions={first ? undefined : <span className="only-wide">{<DayRangeCalendar value={range} onChange={setRange} />}</span>} />
  );

  const tiles = (zero: boolean) => (
    <div className={`an-eqn ${css.eqn}`}>
      <KpiTile label={t('deal.net')} value={money(s.netCents, true)} sub={zero ? undefined : compareSub} />
      <span className="op" aria-hidden>
        −
      </span>
      <KpiTile label={t('deal.cost')} value={money(s.purchaseCostCents, true)} sub={zero ? undefined : s.units ? t('deal.costSub', { units: num(s.units), cost: money(s.costPerUnitCents) }) : t('deal.costNone')} />
      <span className="op" aria-hidden>
        −
      </span>
      <KpiTile label={t('deal.commission')} value={money(s.commissionCents, true)} sub={zero || !s.units ? undefined : t('deal.commissionSub', { amount: money(s.commissionPerUnitCents) })} />
      <span className="op eq" aria-hidden>
        =
      </span>
      <div className="eq-row">
        <KpiTile label={t('deal.profit')} value={money(s.profitCents, true)} valueTone={s.profitCents > 0 ? 'good' : s.profitCents < 0 ? 'bad' : undefined} sub={zero ? undefined : t('deal.profitSub', { gross: money(s.grossCents, true) })} />
      </div>
    </div>
  );

  // First use: nothing has ever been paid in full.
  if (!d.hasAny) {
    return (
      <div className="page">
        {header(true)}
        <div className="only-wide">{tiles(true)}</div>
        <div className={`only-phone ${css.box}`}>
          <PhoneTotals s={s} note={undefined} />
        </div>
        <Card>
          <EmptyState icon={ChartLineUp} title={t('deal.empty.title')} text={t('deal.empty.text')} />
        </Card>
      </div>
    );
  }

  const chipPresets: ChipPreset[] = ['this_year', 'this_month', 'last_month', 'last_year'];
  const extra = (['custom', 'today', 'this_week'] as DayPreset[]).includes(preset) ? [{ value: preset, label: preset === 'custom' ? t('period.customChip', { range: label }) : t(`period.${preset}`) }] : [];
  const chips = (
    <Chips
      fill={false}
      label={t('period.label')}
      value={preset}
      onChange={(v) => v !== 'custom' && setRange(dayPreset(v as Exclude<DayPreset, 'custom'>))}
      options={[...chipPresets.map((p) => ({ value: p as DayPreset, label: t(`period.${p}`) })), ...extra]}
    />
  );
  const howBtn = (
    <Button size="sm" icon={Info} onClick={() => setHow(!how)} aria-expanded={how}>
      {t('deal.how.button')}
    </Button>
  );

  const shown = filter ? deals.filter((r) => (filter.by === 'customer' ? (r.customerId ?? 'none') : r.brokerId) === filter.key) : deals;
  const pickGroup = (by: 'customer' | 'broker') => (g: Group) => {
    if (g.total) return;
    setTabRaw('deals');
    setFilter({ by, key: g.key, name: g.name });
  };
  const footer = (
    <div className={css.foot}>
      {label}
      {paidDeals ? ` · ${t('deal.fullyPaid', { n: paidDeals })}` : ''}
      {tab !== 'deals' ? ` ${t('deal.groupsNote')}` : ''}
    </div>
  );
  const noneRow = <span className="muted">{noneText}</span>;

  return (
    <div className="page">
      {header(false)}

      {/* Desktop and tablet */}
      <div className="only-wide stack">
        <div className={css.chipLine}>
          {chips}
          <span className={css.end}>{howBtn}</span>
        </div>
        {how && <div className={css.note}>{t('deal.how.rule')}</div>}
        {tiles(false)}
        <div className="cp-row">
        <Chips
          fill={false}
          label={t('deal.breakdown')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'deals', label: t('deal.tabs.deals') },
            { value: 'customers', label: t('deal.tabs.customers') },
            { value: 'brokers', label: t('deal.tabs.brokers') },
            { value: 'flavours', label: t('deal.tabs.flavours') },
          ]}
        />
          <ColumnsSlot />
        </div>
        <Card flush>
          {q.error ? (
            <LoadError error={q.error} onRetry={() => q.refetch()} />
          ) : tab === 'deals' ? (
            <>
              {filter && (
                <div className={css.showing}>
                  <span>{t('deal.showing')}</span>
                  <button type="button" className="an-chip" aria-pressed onClick={() => setFilter(null)} aria-label={t('deal.clearFilter')}>
                    {filter.name} <X className="an-ic sm" aria-hidden />
                  </button>
                </div>
              )}
              <Table columns={dealCols} rows={shown} rowKey={(r) => r.id} onRow={(r) => router.push(`/sales/${r.orderId}`)} empty={noneRow} loading={q.isFetching && !q.data} picker={{ id: 'deal-profit-deals', locked: ['deal', 'profit'], priority: ['broker', 'paidOn', 'net', 'units', 'cost', 'commission'] }} />
            </>
          ) : tab === 'customers' ? (
            <Table columns={customerCols} rows={customers} rowKey={(g) => g.key} onRow={pickGroup('customer')} rowClass={(g) => (g.total ? css.sumRow : '')} empty={noneRow} picker={{ id: 'deal-profit-customers', locked: ['customer', 'profit'], priority: ['net', 'margin', 'deals', 'units', 'broker'] }} />
          ) : tab === 'brokers' ? (
            <Table columns={brokerCols} rows={brokers} rowKey={(g) => g.key} onRow={pickGroup('broker')} rowClass={(g) => (g.total ? css.sumRow : '')} empty={noneRow} picker={{ id: 'deal-profit-brokers', locked: ['broker', 'profit'], priority: ['net', 'margin', 'deals', 'commission', 'customers', 'units'] }} />
          ) : (
            <Table columns={flavourCols} rows={flavourRows} rowKey={(g) => g.key} rowClass={(g) => (g.total ? css.sumRow : '')} empty={noneRow} picker={{ id: 'deal-profit-flavours', locked: ['flavour', 'profit'], priority: ['net', 'share', 'units', 'margin', 'cost', 'commission'] }} />
          )}
          {footer}
        </Card>
      </div>

      {/* Phone */}
      <div className="only-phone stack">
        {chips}
        <div className={css.box}>
          <PhoneTotals s={s} note={t('deal.phoneNote', { period: periodWord })} />
        </div>
        <Button block icon={Info} onClick={() => setHow(!how)} aria-expanded={how}>
          {t('deal.how.button')}
        </Button>
        {how && <div className={css.note}>{t('deal.how.ruleShort')}</div>}
        <span className={css.sectionLabel}>{t('deal.dealsCount', { n: paidDeals })}</span>
        {q.error ? (
          <LoadError error={q.error} onRetry={() => q.refetch()} />
        ) : deals.length ? (
          deals.map((r) => (
            <button key={r.id} type="button" className={`${css.box} ${css.cardBtn}`} onClick={() => router.push(`/sales/${r.orderId}`)}>
              <div className={css.cardHead}>
                <div className={`${css.line} ${css.head}`}>
                  <span>{r.customerName ?? t('noCustomer')}</span>
                  {profit(r.profitCents)}
                </div>
                <span className={css.small}>
                  {t('deal.phoneLine', { number: r.number, broker: r.brokerName, date: date(r.paidAt) })}
                  {r.kind === 'credit_note' && ` · ${t('creditNote')} ${r.documentNumber ?? ''}`}
                </span>
              </div>
              <div className={css.line}>
                <span>{t('deal.netUnits', { units: num(r.units) })}</span>
                <bdi>{money(r.netCents)}</bdi>
              </div>
              <div className={css.line}>
                <span>{t('cols.purchaseCost')}</span>
                <bdi>{money(-r.purchaseCostCents)}</bdi>
              </div>
              <div className={css.line}>
                <span>{t('cols.commission')}</span>
                <bdi>{money(-r.commissionCents)}</bdi>
              </div>
            </button>
          ))
        ) : (
          <div className={`${css.box} ${css.center}`}>
            <span className="muted">{noneText}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PhoneTotals({ s, note }: { s: Figures; note?: string }) {
  const t = useTranslations('money');
  const { money } = useFmt();
  return (
    <>
      <div className={css.line}>
        <span>{t('deal.net')}</span>
        <bdi>{money(s.netCents, true)}</bdi>
      </div>
      <div className={css.line}>
        <span>{t('deal.costLine')}</span>
        <bdi>{money(s.purchaseCostCents, true)}</bdi>
      </div>
      <div className={css.line}>
        <span>{t('deal.commissionLine')}</span>
        <bdi>{money(s.commissionCents, true)}</bdi>
      </div>
      <div className={`${css.line} ${css.big}`}>
        <span>{t('deal.profitLine')}</span>
        <bdi className={s.profitCents > 0 ? css.good : s.profitCents < 0 ? css.bad : undefined}>{money(s.profitCents, true)}</bdi>
      </div>
      {note && <span className={css.small}>{note}</span>}
    </>
  );
}

/** "November 2025" (long month name) for the comparison under Net sales. */
function monthLong(isoDay: string, locale: string) {
  const [y, m] = isoDay.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : locale === 'he' ? 'he-IL' : 'en-GB', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
}

