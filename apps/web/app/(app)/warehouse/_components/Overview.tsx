'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import {
  Banner,
  Button,
  Card,
  Chips,
  EmptyState,
  ErrorState,
  FlavourRows,
  KeyValue,
  KpiTile,
  ListCard,
  OrderStatusPill,
  Package,
  PageHeader,
  PageSkeleton,
  Sheet,
  Table,
  Truck,
  type Column,
} from '@/components/ui';
import { DueMarker } from './ToShip';
import { noteUrl, type ShipCard, type WarehouseOverview } from './types';

type Row =
  | { kind: 'ship'; id: string; number: string; customerName: string; city: string | null; when: string | null; cartons: number; order: ShipCard; status: ShipCard['status']; noteId: null }
  | { kind: 'done'; id: string; number: string; customerName: string; city: string | null; when: string | null; cartons: number; status: ShipCard['status']; noteId: string | null };

/** Desktop overview for Admins (FR-WH-1), with the paid orders waiting to be sent. */
export function Overview() {
  const t = useTranslations('warehouse');
  const tc = useTranslations('common');
  const router = useRouter();
  const { date, dateShort, num } = useFmt();
  const { isAdmin, readOnly } = useSession();
  const [filter, setFilter] = useState<'all' | 'to_ship' | 'delivered'>('all');
  const [send, setSend] = useState<ShipCard | null>(null);
  const q = useQuery({ queryKey: ['warehouse', 'overview'], queryFn: () => api.get<WarehouseOverview>('/warehouse') });
  const sendAct = useAction((id: string) => api.post(`/orders/${id}/send-to-warehouse`), {
    success: () => t('ready.sent', { number: send?.number ?? '' }),
    onDone: () => setSend(null),
  });

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const last = d.tiles.lastCount;

  const rows: Row[] = [
    ...(filter !== 'delivered'
      ? d.toShip.map((o) => ({ kind: 'ship' as const, id: o.id, number: o.number, customerName: o.customerName, city: o.city, when: o.sentAt, cartons: o.totalCartons, order: o, status: o.status, noteId: null }))
      : []),
    ...(filter !== 'to_ship'
      ? d.delivered.map((o) => ({ kind: 'done' as const, id: o.id, number: o.number, customerName: o.customerName, city: o.city, when: o.deliveredAt, cartons: o.deliveredCartons, status: o.status, noteId: o.signedNoteId }))
      : []),
  ];

  const noteLink = (r: Row) =>
    r.noteId ? (
      <a className="link" href={noteUrl(r.noteId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {t('viewNote')}
      </a>
    ) : (
      <span className="subtle">—</span>
    );

  const columns: Column<Row>[] = [
    {
      key: 'order',
      header: t('cols.order'),
      render: (r) => <bdi className="nowrap">{r.number}</bdi>,
    },
    {
      key: 'to',
      header: t('cols.deliversTo'),
      render: (r) => (
        <>
          <span className="nm">{r.customerName}</span>
          {r.city && <span className="sb">{r.city}</span>}
        </>
      ),
    },
    {
      key: 'when',
      header: t('cols.when'),
      render: (r) => (
        <span className="row nowrap">
          <span>{date(r.when)}</span>
          {r.kind === 'ship' && <DueMarker order={r.order} />}
        </span>
      ),
    },
    { key: 'cartons', header: t('cols.cartons'), type: 'count', render: (r) => num(r.cartons) },
    { key: 'status', header: t('cols.status'), render: (r) => <OrderStatusPill status={r.status} /> },
    { key: 'note', header: t('cols.signedNote'), render: noteLink },
  ];

  const readyCols: Column<ShipCard>[] = [
    {
      key: 'order',
      header: t('cols.order'),
      render: (o) => (
        <>
          <span className="nm">{o.customerName}</span>
          <span className="sb">
            <bdi>{o.number}</bdi>
            {o.city && ` · ${o.city}`}
          </span>
        </>
      ),
    },
    { key: 'cartons', header: t('cols.cartons'), type: 'count', render: (o) => num(o.totalCartons) },
    { key: 'status', header: t('cols.status'), render: (o) => <OrderStatusPill status={o.status} /> },
    {
      key: 'act',
      header: <span className="sr-only">{t('ready.send')}</span>,
      type: 'amount',
      render: (o) =>
        isAdmin && !readOnly ? (
          <Button
            size="sm"
            variant="primary"
            icon={Truck}
            onClick={(e) => {
              e.stopPropagation();
              setSend(o);
            }}
          >
            {t('ready.send')}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.warehouse') }]}
        kicker={t('toShipKicker', { n: d.tiles.toShipOrders })}
        title={tc('nav.warehouse')}
        actions={
          <>
            <Link href="/warehouse/delivered" className="an-btn secondary sm">
              {t('deliveredPage.title')}
            </Link>
            <Link href="/warehouse/count" className="an-btn secondary sm">
              {t('count.title')}
            </Link>
          </>
        }
      />
      <div className="kpis" style={{ ['--n' as string]: 3 }}>
        <KpiTile label={t('tiles.toShip')} value={num(d.tiles.toShipOrders)} sub={t('tiles.toShipSub', { n: d.tiles.toShipCartons })} />
        <KpiTile label={t('tiles.delivered')} value={num(d.tiles.deliveredThisMonth)} sub={t('tiles.deliveredSub', { n: d.tiles.deliveredThisMonth })} />
        <KpiTile
          label={t('tiles.lastCount')}
          value={last ? dateShort(last.at) : t('tiles.noCount')}
          sub={
            !last
              ? t('tiles.noCountSub')
              : last.cartonsOff == null
                ? t('tiles.countBy', { name: last.byName })
                : last.cartonsOff === 0
                  ? t('tiles.countMatches', { name: last.byName })
                  : t('tiles.countOff', { name: last.byName, n: last.cartonsOff })
          }
          subTone={last?.cartonsOff ? 'bad' : undefined}
          link={last && isAdmin ? { href: '/inventory?tab=counts', label: tc('review') } : undefined}
        />
      </div>

      {d.ready.length > 0 && (
        <Card flush title={t('ready.title')}>
          <div className="only-wide">
            <Table columns={readyCols} rows={d.ready} rowKey={(o) => o.id} onRow={(o) => router.push(`/sales/${o.id}`)} />
          </div>
          <div className="list-cards only-phone" style={{ padding: 'var(--space-3)' }}>
            {d.ready.map((o) => (
              <ListCard
                key={o.id}
                title={o.customerName}
                amount={t('tiles.toShipSub', { n: o.totalCartons })}
                sub={
                  <>
                    <bdi>{o.number}</bdi>
                    {o.city && ` · ${o.city}`}
                  </>
                }
                status={<OrderStatusPill status={o.status} />}
                onClick={() => (isAdmin && !readOnly ? setSend(o) : router.push(`/sales/${o.id}`))}
              />
            ))}
          </div>
        </Card>
      )}

      <Chips
        label={tc('filters')}
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('list.all') },
          { value: 'to_ship', label: t('list.toShip'), count: d.toShip.length },
          { value: 'delivered', label: t('list.delivered'), count: d.delivered.length },
        ]}
      />
      <Card flush title={t('list.title')}
      >
        {rows.length === 0 ? (
          <EmptyState icon={Package} title={filter === 'to_ship' ? t('list.emptyToShip') : t('list.empty')} />
        ) : (
          <>
            <div className="only-wide">
              <Table columns={columns} rows={rows} rowKey={(r) => `${r.kind}-${r.id}`} onRow={(r) => router.push(`/sales/${r.id}`)} />
            </div>
            <div className="list-cards only-phone" style={{ padding: 'var(--space-3)' }}>
              {rows.map((r) => (
                <ListCard
                  key={`${r.kind}-${r.id}`}
                  href={r.noteId ? noteUrl(r.noteId) : `/sales/${r.id}`}
                  title={r.customerName}
                  amount={t('tiles.toShipSub', { n: r.cartons })}
                  sub={
                    <>
                      <bdi>{r.number}</bdi> · {dateShort(r.when)}
                      {r.noteId && ` · ${t('viewNote')}`}
                    </>
                  }
                  status={<OrderStatusPill status={r.status} />}
                />
              ))}
            </div>
          </>
        )}
      </Card>

      <Sheet
        open={!!send}
        onClose={() => setSend(null)}
        title={t('ready.sheetTitle')}
        sub={
          send && (
            <>
              <bdi>{send.number}</bdi> · {send.customerName}
            </>
          )
        }
        footer={
          <>
            <Button onClick={() => setSend(null)}>{tc('cancel')}</Button>
            <Button variant="primary" icon={Truck} busy={sendAct.isPending} onClick={() => send && sendAct.mutate(send.id)}>
              {t('ready.send')}
            </Button>
          </>
        }
      >
        {send && (
          <>
            <KeyValue
              items={[
                [t('card.address'), `${send.address}${send.city ? `, ${send.city}` : ''}`],
                [t('card.contact'), <span key="c">{send.contactName} · <bdi>{send.phone}</bdi></span>],
                [t('card.total'), t('card.totalValue', { c: send.totalCartons, u: num(send.totalUnits) })],
              ]}
            />
            <FlavourRows cartons={Object.fromEntries(send.lines.map((l) => [l.flavour, l.cartons]))} />
            <span className="body-sm muted">{t('ready.sheetText')}</span>
            {sendAct.errorText && <Banner tone="bad">{sendAct.errorText}</Banner>}
          </>
        )}
      </Sheet>
    </div>
  );
}
