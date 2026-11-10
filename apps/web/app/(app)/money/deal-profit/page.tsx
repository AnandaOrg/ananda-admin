'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { Flavour } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { Button, Card, ChartLineUp, Chips, DownloadSimple, EmptyState, ErrorState, FlavourName, Info, KpiTile, ListCard, PageHeader, PageSkeleton, Pill, Sheet, Table, type Column } from '@/components/ui';
import { PeriodPill, periodQuery, usePeriodLine, type PeriodValue } from '../_components/period';
import { useColumnPicker } from '../_components/columns';
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
  customerName: string | null;
  agentName: string;
  paidAt: string;
  units: number;
}

interface Group extends Figures {
  key: string;
  name: string;
  deals: number;
  customers: number;
  units: number;
}

interface DealProfit {
  period: { from: string; to: string };
  summary: Figures & { grossCents: number; units: number; deals: number; costPerUnitCents: number };
  deals: Deal[];
  byCustomer: Group[];
  byAgent: Group[];
  byFlavour: Group[];
}

type Tab = 'deals' | 'customers' | 'agents' | 'flavours';

/** FR-MON-1: deal profit counted on the date the customer paid in full. */
export default function DealProfitPage() {
  const t = useTranslations('money');
  const tc = useTranslations('common');
  const router = useRouter();
  const { money, num, date, dateShort } = useFmt();
  const periodLine = usePeriodLine();
  const [period, setPeriod] = useState<PeriodValue>({ kind: 'this_year' });
  const [tab, setTab] = useState<Tab>('deals');
  const [how, setHow] = useState(false);
  const query = qs(periodQuery(period));
  const q = useQuery({ queryKey: ['money', 'deal-profit', query], queryFn: () => api.get<DealProfit>(`/money/deal-profit${query}`) });

  const amount = (c: number) => <bdi className={c < 0 ? 'bad' : undefined}>{money(c)}</bdi>;
  const margin = (g: Figures) => (g.netCents ? `${num((g.profitCents / g.netCents) * 100, 1)}%` : '—');
  const totalProfit = q.data?.summary.profitCents ?? 0;

  const dealCols: Column<Deal>[] = [
    {
      key: 'deal',
      header: t('cols.deal'),
      render: (d) => (
        <>
          <span className="nm">{d.customerName ?? t('noCustomer')}</span>
          <span className="sb">
            <bdi>{d.number}</bdi>
            {d.kind === 'credit_note' && (
              <>
                {' · '}
                {t('creditNote')} <bdi>{d.documentNumber}</bdi>
              </>
            )}
          </span>
        </>
      ),
    },
    { key: 'agent', header: t('cols.agent'), render: (d) => d.agentName },
    { key: 'paidOn', header: t('cols.paidOn'), render: (d) => <span className="nowrap">{date(d.paidAt)}</span> },
    { key: 'units', header: t('cols.units'), type: 'count', render: (d) => num(d.units) },
    { key: 'net', header: t('cols.netSales'), type: 'amount', render: (d) => amount(d.netCents) },
    { key: 'cost', header: t('cols.purchaseCost'), type: 'amount', render: (d) => amount(d.purchaseCostCents) },
    { key: 'commission', header: t('cols.commission'), type: 'amount', render: (d) => amount(d.commissionCents) },
    { key: 'profit', header: t('cols.profit'), type: 'amount', render: (d) => amount(d.profitCents) },
  ];

  const groupCols = (first: Column<Group>, extra: Column<Group>[] = []): Column<Group>[] => [
    first,
    ...extra,
    { key: 'net', header: t('cols.netSales'), type: 'amount', render: (g) => amount(g.netCents) },
    { key: 'cost', header: t('cols.purchaseCost'), type: 'amount', render: (g) => amount(g.purchaseCostCents) },
    { key: 'commission', header: t('cols.commission'), type: 'amount', render: (g) => amount(g.commissionCents) },
    { key: 'margin', header: t('cols.margin'), type: 'amount', render: margin },
    { key: 'profit', header: t('cols.profit'), type: 'amount', render: (g) => amount(g.profitCents) },
  ];
  const deals = { key: 'deals', header: t('cols.deals'), type: 'count' as const, render: (g: Group) => num(g.deals) };
  const units = { key: 'units', header: t('cols.units'), type: 'count' as const, render: (g: Group) => num(g.units) };
  const customerCols = groupCols({ key: 'customer', header: t('cols.customer'), render: (g) => <span className="nm">{g.name || t('noCustomer')}</span> }, [deals, units]);
  const agentCols = groupCols({ key: 'agent', header: t('cols.agent'), render: (g) => <span className="nm">{g.name}</span> }, [deals, { key: 'customers', header: t('cols.customers'), type: 'count', render: (g) => num(g.customers) }, units]);
  const flavourCols: Column<Group>[] = [
    { key: 'flavour', header: t('cols.flavour'), render: (g) => <FlavourName flavour={g.key as Flavour} /> },
    units,
    { key: 'share', header: t('cols.shareOfProfit'), type: 'amount', render: (g) => (totalProfit ? `${num((g.profitCents / totalProfit) * 100, 1)}%` : '—') },
    ...groupCols({ key: 'x', header: '', render: () => null }).slice(1),
  ];

  // Column picker defaults from the design system (Tables › Default columns).
  const dealPick = useColumnPicker('deal-profit-deals', dealCols, { locked: ['deal', 'profit'], defaults: ['agent', 'paidOn', 'units', 'net'] });
  const customerPick = useColumnPicker('deal-profit-customers', customerCols, { locked: ['customer', 'profit'], defaults: ['net', 'margin', 'deals', 'units'] });
  const agentPick = useColumnPicker('deal-profit-agents', agentCols, { locked: ['agent', 'profit'], defaults: ['net', 'margin', 'deals', 'commission'] });
  const flavourPick = useColumnPicker('deal-profit-flavours', flavourCols, { locked: ['flavour', 'profit'], defaults: ['net', 'share', 'units', 'margin'] });
  const picker = { deals: dealPick, customers: customerPick, agents: agentPick, flavours: flavourPick }[tab];

  if (q.isLoading) return <PageSkeleton />;
  const d = q.data;
  const s = d?.summary;

  const groups: Record<Exclude<Tab, 'deals'>, Group[]> = { customers: d?.byCustomer ?? [], agents: d?.byAgent ?? [], flavours: d?.byFlavour ?? [] };

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.deal_profit') }]}
        kicker={d ? `${periodLine(d.period)} · ${t('dealsCount', { n: s?.deals ?? 0 })}` : undefined}
        title={tc('nav.deal_profit')}
        actions={
          <>
            <PeriodPill value={period} onChange={setPeriod} options={['this_year', 'this_month', 'last_month', 'last_year', 'custom']} />
            <Button size="sm" icon={Info} onClick={() => setHow(true)}>
              {t('how.button')}
            </Button>
            <a className="an-btn secondary sm" href={`/api/money/deal-profit/export.csv${query}`}>
              <DownloadSimple className="an-ic sm" aria-hidden />
              {tc('exportCsv')}
            </a>
          </>
        }
      />
      {q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : (
        d &&
        s && (
          <>
            <p className="sr-only">{t('equation.sentence', { net: money(s.netCents, true), cost: money(s.purchaseCostCents, true), commission: money(s.commissionCents, true), profit: money(s.profitCents, true) })}</p>
            <div className={`an-eqn ${css.eqn}`}>
              <KpiTile label={t('equation.net')} value={money(s.netCents, true)} sub={t('equation.netSub', { deals: s.deals, units: num(s.units) })} />
              <span className="op" aria-hidden>
                −
              </span>
              <KpiTile label={t('equation.cost')} value={money(s.purchaseCostCents, true)} sub={t('equation.costSub', { units: num(s.units), cost: money(s.costPerUnitCents) })} />
              <span className="op" aria-hidden>
                −
              </span>
              <KpiTile label={t('equation.commission')} value={money(s.commissionCents, true)} sub={t('equation.commissionSub')} />
              <span className="op eq" aria-hidden>
                =
              </span>
              <div className="eq-row">
                <KpiTile label={t('equation.profit')} value={money(s.profitCents, true)} valueTone={s.profitCents >= 0 ? 'good' : 'bad'} sub={t('equation.profitSub', { gross: money(s.grossCents, true) })} />
              </div>
            </div>

            <div className="row between wrap">
              <div className="grow">
                <Chips
                  label={t('breakdown')}
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: 'deals', label: t('tabs.deals'), count: d.deals.filter((x) => x.kind === 'deal').length },
                    { value: 'customers', label: t('tabs.customers'), count: d.byCustomer.length },
                    { value: 'agents', label: t('tabs.agents'), count: d.byAgent.length },
                    { value: 'flavours', label: t('tabs.flavours') },
                  ]}
                />
              </div>
              {picker.button}
            </div>

            {d.deals.length === 0 ? (
              <Card>
                <EmptyState icon={ChartLineUp} title={t('empty.dealsTitle')} text={t('empty.dealsText')} action={period.kind !== 'this_year' ? <Button onClick={() => setPeriod({ kind: 'this_year' })}>{t('empty.showYear')}</Button> : undefined} />
              </Card>
            ) : tab === 'deals' ? (
              <>
                <Card flush className="only-wide">
                  <Table columns={dealPick.visible} rows={d.deals} rowKey={(r) => r.id} onRow={(r) => router.push(`/sales/${r.orderId}`)} />
                </Card>
                <div className="list-cards only-phone">
                  {d.deals.map((r) => (
                    <ListCard
                      key={r.id}
                      href={`/sales/${r.orderId}`}
                      title={r.customerName ?? t('noCustomer')}
                      amount={money(r.profitCents)}
                      sub={
                        <>
                          <bdi>{r.number}</bdi> · {dateShort(r.paidAt)} · {r.agentName} · {t('netShort', { amount: money(r.netCents) })}
                        </>
                      }
                      status={r.kind === 'credit_note' ? <Pill tone="warn">{t('creditNote')}</Pill> : undefined}
                    />
                  ))}
                </div>
              </>
            ) : (
              <>
                <Card flush className="only-wide">
                  <Table columns={picker.visible as Column<Group>[]} rows={groups[tab]} rowKey={(r) => r.key} />
                </Card>
                <div className="list-cards only-phone">
                  {groups[tab].map((g) => (
                    <ListCard
                      key={g.key}
                      title={tab === 'flavours' ? <FlavourName flavour={g.key as Flavour} /> : g.name || t('noCustomer')}
                      amount={money(g.profitCents)}
                      sub={`${t('netShort', { amount: money(g.netCents) })} · ${t('marginShort', { m: margin(g) })} · ${t('unitsShort', { n: num(g.units) })}`}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )
      )}

      <Sheet open={how} onClose={() => setHow(false)} title={t('how.title')} footer={<Button variant="primary" onClick={() => setHow(false)}>{t('how.close')}</Button>}>
        <ol className={css.howList}>
          {(['paid', 'net', 'cost', 'commission', 'credit', 'once'] as const).map((k) => (
            <li key={k}>
              <strong>{t(`how.${k}.title`)}</strong> {t(`how.${k}.text`)}
            </li>
          ))}
        </ol>
      </Sheet>
    </div>
  );
}
