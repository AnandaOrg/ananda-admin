'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, CalendarBlank, Card, EmptyState, ErrorState, KpiTile, ListCard, PageHeader, PageSkeleton, Pill, Plus, Table, type Column } from '@/components/ui';
import { NewEventSheet } from './_components/NewEventSheet';
import { eventDates } from './_components/dates';
import type { EventItem, EventsList } from './_components/types';

/** Events & festivals (FR-EVT-1). Agents see the events they are invited to. */
export default function EventsPage() {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const router = useRouter();
  const { canEdit, readOnly, isAgent } = useSession();
  const { money, num, locale } = useFmt();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['events'], queryFn: () => api.get<EventsList>('/events') });
  const mayEdit = canEdit('events') && !readOnly && !isAgent;

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { tiles, items } = q.data;
  const showCosts = tiles.expensesThisYearCents != null;
  const agents = (e: EventItem) => e.agents.map((a) => a.name).join(', ');
  const newButton = (block = false) =>
    mayEdit ? (
      <Button size={block ? 'lg' : 'sm'} block={block} variant="primary" icon={Plus} onClick={() => setOpen(true)}>
        {t('new')}
      </Button>
    ) : undefined;

  const columns: Column<EventItem>[] = [
    {
      key: 'event',
      header: t('cols.event'),
      render: (e) => (
        <>
          <span className="nm">{e.name}</span>
          <span className="sb">{e.place}</span>
        </>
      ),
    },
    { key: 'when', header: t('cols.when'), render: (e) => <bdi className="nowrap">{eventDates(e.startsOn, e.endsOn, locale)}</bdi> },
    { key: 'type', header: t('cols.type'), render: (e) => t(`kind.${e.kind}`) },
    { key: 'invited', header: t('cols.invited'), render: (e) => agents(e) || t('noneYet') },
    {
      key: 'stock',
      header: t('cols.stock'),
      type: 'amount',
      render: (e) =>
        e.stockUnits > 0 ? (
          <bdi>{num(e.stockUnits)}</bdi>
        ) : mayEdit && e.status !== 'past' ? (
          <Link href={`/events/${e.id}?move=1`} className="nowrap" style={{ fontWeight: 400 }} onClick={(ev) => ev.stopPropagation()}>
            {t('moveStockEmpty')}
          </Link>
        ) : (
          '0'
        ),
    },
  ];

  const deskTiles = (
    <div className="kpis only-wide" style={{ ['--n' as string]: showCosts ? 3 : 2 }}>
      <KpiTile label={t('tiles.stock')} value={num(tiles.stockUnits)} sub={t('tiles.units')} />
      <KpiTile label={t('tiles.sales')} value={money(tiles.salesThisYearCents, true)} />
      {showCosts && <KpiTile label={t('tiles.expenses')} value={money(tiles.expensesThisYearCents ?? 0, true)} />}
    </div>
  );

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.events') }]}
        kicker={items.length ? t('kicker', { n: tiles.upcoming }) : t('kickerNone')}
        title={tc('nav.events')}
        actions={mayEdit ? <span className="only-wide">{newButton()}</span> : undefined}
      />
      <div className="kpis only-phone" style={{ ['--n' as string]: 2 }}>
        <KpiTile label={t('tiles.stock')} value={num(tiles.stockUnits)} sub={t('tiles.units')} />
        <KpiTile label={t('tiles.salesShort')} value={money(tiles.salesThisYearCents, true)} sub={t('tiles.thisYear')} />
      </div>
      {items.length === 0 ? (
        <>
          <Card className="only-wide">
            <EmptyState icon={CalendarBlank} title={t('empty.title')} text={t('empty.text')} action={newButton()} />
          </Card>
          <Card className="only-phone">
            <EmptyState icon={CalendarBlank} title={t('empty.titlePhone')} text={t('empty.textPhone')} />
          </Card>
        </>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={items} rowKey={(e) => e.id} onRow={(e) => router.push(`/events/${e.id}`)} picker={{ id: 'events', locked: ['event', 'when', 'stock'], priority: ['invited', 'type'] }} />
            <div className="caption muted" style={{ padding: 'var(--space-4) var(--space-5)', borderBlockStart: '1px solid var(--line)' }}>
              {t('foot')}
            </div>
          </Card>
          <div className="list-cards only-phone">
            {items.map((e) => (
              <ListCard
                key={e.id}
                href={`/events/${e.id}`}
                title={e.name}
                amount={eventDates(e.startsOn, e.endsOn, locale, true)}
                sub={`${e.place} · ${agents(e) || t('noAgentsYet')}`}
                status={<Pill tone="info">{t(`kind.${e.kind}`)}</Pill>}
              />
            ))}
            <span className="caption muted">{t('foot')}</span>
          </div>
        </>
      )}
      {deskTiles}
      {mayEdit && <div className="only-phone">{newButton(true)}</div>}
      <NewEventSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
