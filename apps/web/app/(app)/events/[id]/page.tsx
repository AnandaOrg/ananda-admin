'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, UNITS_PER_CARTON } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import {
  ArrowCounterClockwise,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FlavourName,
  KpiTile,
  ListCard,
  PageHeader,
  PageSkeleton,
  Pill,
  Plus,
  StockBars,
  Table,
  Tip,
  Truck,
  type Column,
} from '@/components/ui';
import { MoveStockSheet, SaleSheet } from '../_components/StockSheets';
import { STATUS_TONE, type EventDetail } from '../_components/types';

type Sale = EventDetail['sales'][number];
type Move = EventDetail['movements'][number];
type Expense = NonNullable<EventDetail['expenses']>[number];

/** One event (FR-EVT-3): its own stock, sales by agent and direct costs. */
export default function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const { money, num, date, dateShort, dateTime } = useFmt();
  const { readOnly, canView } = useSession();
  const q = useQuery({ queryKey: ['events', id], queryFn: () => api.get<EventDetail>(`/events/${id}`) });
  const [move, setMove] = useState<'to_event' | 'back' | null>(null);
  const [lastDir, setLastDir] = useState<'to_event' | 'back'>('to_event');
  const [sale, setSale] = useState(false);

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const e = d.event;
  const mayEdit = d.canEdit && !readOnly;
  const cartons = (units: number) => t('cartons', { n: Math.floor(units / UNITS_PER_CARTON) });
  const dates = e.startsOn === e.endsOn ? date(e.startsOn) : `${dateShort(e.startsOn)} – ${date(e.endsOn)}`;
  const maxBar = Math.max(1, ...d.stock.map((s) => s.movedUnits));
  const openMove = (dir: 'to_event' | 'back') => {
    setLastDir(dir);
    setMove(dir);
  };

  const saleCols: Column<Sale>[] = [
    { key: 'agent', header: t('detail.agent'), render: (s) => <span className="nm">{s.name}</span> },
    ...FLAVOURS.filter((f) => d.sales.some((s) => s.byFlavour[f] > 0)).map((f) => ({
      key: f,
      header: <FlavourName flavour={f} />,
      type: 'count' as const,
      render: (s: Sale) => num(Math.floor(s.byFlavour[f] / UNITS_PER_CARTON)),
    })),
    { key: 'cartons', header: tc('cartons'), type: 'count', render: (s) => num(s.cartons) },
    { key: 'units', header: tc('units'), type: 'count', render: (s) => num(s.units) },
    {
      key: 'commission',
      header: (
        <span className="row end nowrap">
          {t('detail.commission')}
          <Tip text={t('detail.commissionHelp')} />
        </span>
      ),
      type: 'amount',
      render: (s) => <bdi>{money(s.commissionCents)}</bdi>,
    },
  ];
  const moveCols: Column<Move>[] = [
    { key: 'when', header: t('detail.date'), render: (m) => <span className="nowrap">{dateTime(m.createdAt)}</span> },
    { key: 'kind', header: t('detail.what'), render: (m) => t(`detail.kinds.${m.kind}`) },
    { key: 'flavour', header: tc('flavour'), render: (m) => <FlavourName flavour={m.flavour} /> },
    { key: 'cartons', header: tc('cartons'), type: 'count', render: (m) => <bdi>{(m.units > 0 ? '+' : '−') + num(Math.abs(m.units) / UNITS_PER_CARTON)}</bdi> },
    { key: 'by', header: t('detail.who'), render: (m) => m.byName ?? '—' },
  ];
  const costCols: Column<Expense>[] = [
    { key: 'date', header: t('detail.date'), render: (x) => <span className="nowrap">{date(x.spentOn)}</span> },
    { key: 'desc', header: t('detail.description'), render: (x) => <span className="nm">{x.description}</span> },
    { key: 'amount', header: t('detail.amount'), type: 'amount', render: (x) => <bdi>{money(x.netCents)}</bdi> },
  ];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.events'), href: '/events' }, { label: e.name }]}
        kicker={
          <span className="row wrap">
            <bdi>{dates}</bdi> · {e.place} · {t(`kind.${e.kind}`)}
            <Pill tone={STATUS_TONE[e.status]}>{t(`status.${e.status}`)}</Pill>
          </span>
        }
        title={e.name}
        actions={
          mayEdit ? (
            <>
              <Button size="sm" icon={ArrowCounterClockwise} onClick={() => openMove('back')} disabled={d.totals.stockUnits <= 0}>
                {t('detail.moveBack')}
              </Button>
              <Button size="sm" icon={Plus} onClick={() => setSale(true)} disabled={d.totals.stockUnits <= 0}>
                {t('detail.recordSale')}
              </Button>
              <Button size="sm" variant="primary" icon={Truck} onClick={() => openMove('to_event')}>
                {t('detail.moveTo')}
              </Button>
            </>
          ) : undefined
        }
      />
      <div className="kpis" style={{ ['--n' as string]: d.expenses ? 3 : 2 }}>
        <KpiTile label={t('detail.tileStock')} value={cartons(d.totals.stockUnits)} sub={t('detail.units', { u: num(d.totals.stockUnits) })} />
        <KpiTile label={t('detail.tileSold')} value={cartons(d.totals.soldUnits)} sub={t('detail.units', { u: num(d.totals.soldUnits) })} />
        {d.expenses && <KpiTile label={t('detail.tileCosts')} value={money(d.expensesCents ?? 0, true)} sub={t('detail.tileCostsSub')} />}
      </div>

      <Card title={t('detail.stockTitle')}>
        {d.totals.movedUnits <= 0 && d.totals.stockUnits <= 0 ? (
          <EmptyState
            icon={Truck}
            title={t('detail.stockTitle')}
            text={t('detail.stockEmpty')}
            action={
              mayEdit ? (
                <Button variant="primary" icon={Truck} onClick={() => openMove('to_event')}>
                  {t('detail.moveTo')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="stock-grid">
            {d.stock.map((s) => (
              <StockBars
                key={s.flavour}
                flavour={s.flavour}
                value={s.cartons}
                max={Math.max(1, Math.floor(maxBar / UNITS_PER_CARTON))}
                detail={
                  <>
                    <span>{t('detail.moved', { c: cartons(s.movedUnits) })}</span>
                    <span>{t('detail.sold', { c: cartons(s.soldUnits) })}</span>
                  </>
                }
              />
            ))}
          </div>
        )}
        <span className="caption muted">
          {t('detail.invited')}: {d.agents.length ? d.agents.map((a) => a.name).join(', ') : t('noAgents')}
        </span>
      </Card>

      <Card flush title={t('detail.salesTitle')}>
        {d.sales.length === 0 ? (
          <div className="empty-row">{t('detail.salesEmpty')}</div>
        ) : (
          <>
            <div className="only-wide">
              <Table columns={saleCols} rows={d.sales} rowKey={(s) => s.agentId} />
            </div>
            <div className="list-cards only-phone" style={{ padding: 'var(--space-3)' }}>
              {d.sales.map((s) => (
                <ListCard key={s.agentId} title={s.name} amount={money(s.commissionCents)} sub={`${cartons(s.units)} · ${tc('unitsCount', { n: num(s.units) })}`} />
              ))}
              <span className="caption muted">{t('detail.commissionHelp')}</span>
            </div>
          </>
        )}
      </Card>

      {d.expenses && canView('expenses') && (
        <Card flush title={t('detail.costsTitle')} action={canView('expenses') ? <Link className="link body-sm" href="/money/expenses">{t('detail.addExpense')}</Link> : undefined}>
          {d.expenses.length === 0 ? (
            <div className="empty-row">{t('detail.costsEmpty')}</div>
          ) : (
            <>
              <div className="only-wide">
                <Table columns={costCols} rows={d.expenses} rowKey={(x) => x.id} />
              </div>
              <div className="list-cards only-phone" style={{ padding: 'var(--space-3)' }}>
                {d.expenses.map((x) => (
                  <ListCard key={x.id} title={x.description} amount={money(x.netCents)} sub={dateShort(x.spentOn)} />
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      <Card flush title={t('detail.historyTitle')}>
        {d.movements.length === 0 ? (
          <div className="empty-row">{t('detail.historyEmpty')}</div>
        ) : (
          <>
            <div className="only-wide">
              <Table columns={moveCols} rows={d.movements} rowKey={(m) => m.id} />
            </div>
            <div className="list-cards only-phone" style={{ padding: 'var(--space-3)' }}>
              {d.movements.map((m) => (
                <ListCard
                  key={m.id}
                 
                  title={t(`detail.kinds.${m.kind}`)}
                  amount={(m.units > 0 ? '+' : '−') + num(Math.abs(m.units) / UNITS_PER_CARTON)}
                  sub={
                    <>
                      {m.flavour.toUpperCase()} · {dateShort(m.createdAt)}
                      {m.byName && ` · ${m.byName}`}
                    </>
                  }
                />
              ))}
            </div>
          </>
        )}
      </Card>

      <MoveStockSheet data={d} open={!!move} direction={move ?? lastDir} onDirection={(x) => openMove(x)} onClose={() => setMove(null)} />
      <SaleSheet data={d} open={sale} onClose={() => setSale(false)} />
    </div>
  );
}
