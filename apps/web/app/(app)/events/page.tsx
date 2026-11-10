'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { UNITS_PER_CARTON } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, CalendarDots, Card, EmptyState, ErrorState, KpiTile, ListCard, PageHeader, PageSkeleton, Pill, Plus, Table, type Column } from '@/components/ui';
import { NewEventSheet } from './_components/NewEventSheet';
import { STATUS_TONE, type EventItem, type EventsList } from './_components/types';

/** Events & festivals (FR-EVT-1). Agents see the events they are invited to. */
export default function EventsPage() {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const router = useRouter();
  const { canEdit, readOnly, isAgent } = useSession();
  const { money, num, dateShort } = useFmt();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['events'], queryFn: () => api.get<EventsList>('/events') });
  const mayEdit = canEdit('events') && !readOnly && !isAgent;

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { tiles, items } = q.data;
  const showCosts = tiles.expensesThisYearCents != null;
  const cartons = (units: number) => t('cartons', { n: Math.floor(units / UNITS_PER_CARTON) });
  const dates = (e: EventItem) => (e.startsOn === e.endsOn ? dateShort(e.startsOn) : `${dateShort(e.startsOn)} – ${dateShort(e.endsOn)}`);

  const columns: Column<EventItem>[] = [
    {
      key: 'event',
      header: t('cols.event'),
      render: (e) => (
        <>
          <span className="nm">{e.name}</span>
          <span className="sb">
            {t(`kind.${e.kind}`)} · {e.place}
          </span>
        </>
      ),
    },
    { key: 'dates', header: t('cols.dates'), render: (e) => <bdi className="nowrap">{dates(e)}</bdi> },
    { key: 'agents', header: t('cols.agents'), render: (e) => (e.agents.length ? e.agents.map((a) => a.name).join(', ') : <span className="subtle">{t('noAgents')}</span>) },
    { key: 'stock', header: t('cols.stock'), type: 'count', render: (e) => num(Math.floor(e.stockUnits / UNITS_PER_CARTON)) },
    { key: 'sold', header: t('cols.sold'), type: 'count', render: (e) => num(Math.floor(e.soldUnits / UNITS_PER_CARTON)) },
    ...(showCosts ? [{ key: 'costs', header: t('cols.costs'), type: 'amount' as const, render: (e: EventItem) => <bdi>{money(e.expensesCents ?? 0)}</bdi> }] : []),
    { key: 'status', header: t('cols.status'), render: (e) => <Pill tone={STATUS_TONE[e.status]}>{t(`status.${e.status}`)}</Pill> },
  ];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.events') }]}
        kicker={t('kicker', { n: items.length })}
        title={tc('nav.events')}
        actions={
          mayEdit ? (
            <Button size="sm" variant="primary" icon={Plus} onClick={() => setOpen(true)}>
              {t('new')}
            </Button>
          ) : undefined
        }
      />
      <div className="kpis" style={{ ['--n' as string]: showCosts ? 3 : 2 }}>
        <KpiTile label={t('tiles.stock')} value={cartons(tiles.stockUnits)} sub={t('tiles.stockSub', { n: tiles.eventsWithStock })} />
        <KpiTile label={t('tiles.sales')} value={cartons(tiles.salesThisYearUnits)} sub={t('tiles.salesSub', { u: num(tiles.salesThisYearUnits) })} />
        {showCosts && <KpiTile label={t('tiles.expenses')} value={money(tiles.expensesThisYearCents ?? 0, true)} sub={t('tiles.expensesSub')} />}
      </div>
      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDots}
            title={t('empty.title')}
            text={t('empty.text')}
            action={
              mayEdit ? (
                <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
                  {t('new')}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={items} rowKey={(e) => e.id} onRow={(e) => router.push(`/events/${e.id}`)} />
          </Card>
          <div className="list-cards only-phone">
            {items.map((e) => (
              <ListCard
                key={e.id}
                href={`/events/${e.id}`}
                title={e.name}
                amount={cartons(e.stockUnits)}
                sub={
                  <>
                    <bdi>{dates(e)}</bdi> · {e.place}
                  </>
                }
                status={<Pill tone={STATUS_TONE[e.status]}>{t(`status.${e.status}`)}</Pill>}
              />
            ))}
          </div>
        </>
      )}
      <NewEventSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
