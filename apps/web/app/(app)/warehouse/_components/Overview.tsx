'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Card, EmptyState, ErrorState, Eye, Icon, KpiTile, ListCard, PageHeader, PageSkeleton, Pill, Table, Truck, UserPlus, type Column } from '@/components/ui';
import { NoteViewSheet } from './DeliverySheets';
import { useWhen } from './ToShip';
import { daysAgo, type DeliveredRow, type WarehouseOverview } from './types';

const sameMonth = (iso: string) => {
  const a = new Date(iso);
  const n = new Date();
  return a.getFullYear() === n.getFullYear() && a.getMonth() === n.getMonth();
};

type Row =
  | { kind: 'ship'; key: string; orderId: string; number: string; customerName: string; city: string | null; when: string; cartons: number; rest: boolean; note: null }
  | { kind: 'done'; key: string; orderId: string; number: string; customerName: string; city: string | null; when: string; cartons: number; rest: boolean; note: DeliveredRow };

/** Warehouse & shipments for Admins (FR-WH-1): what the warehouse has to ship, every signed note, the last count. */
export function Overview() {
  const t = useTranslations('warehouse');
  const tc = useTranslations('common');
  const router = useRouter();
  const { dateShort, num } = useFmt();
  const { canEdit, readOnly } = useSession();
  const when = useWhen();
  const [view, setView] = useState<DeliveredRow | null>(null);
  const q = useQuery({ queryKey: ['warehouse', 'overview'], queryFn: () => api.get<WarehouseOverview>('/warehouse') });

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const last = d.tiles.lastCount;
  const kicker = d.site ? t('site', { city: d.site }) : t('siteNone');
  const header = <PageHeader crumbs={[{ label: tc('nav.warehouse') }]} kicker={kicker} title={t('title')} />;

  if (d.toShip.length === 0 && d.delivered.length === 0) {
    return (
      <div className="page">
        {header}
        <Card>
          <EmptyState
            icon={Truck}
            title={t('empty.title')}
            text={t('empty.text')}
            action={
              canEdit('users') && !readOnly ? (
                <Link href="/users?new=1" className="an-btn primary">
                  <Icon as={UserPlus} size="sm" />
                  {t('empty.invite')}
                </Link>
              ) : undefined
            }
          />
        </Card>
      </div>
    );
  }

  const rows: Row[] = [
    ...d.toShip.map((o) => ({ kind: 'ship' as const, key: `s-${o.id}`, orderId: o.id, number: o.number, customerName: o.customerName, city: o.city, when: when(o.sentAt), cartons: o.totalCartons, rest: o.partDelivered, note: null })),
    ...d.delivered.map((n) => ({ kind: 'done' as const, key: `d-${n.id}`, orderId: n.orderId, number: n.number, customerName: n.customerName, city: n.city, when: dateShort(n.deliveredAt), cartons: n.deliveredCartons, rest: n.part, note: n })),
  ];

  const status = (r: Row) =>
    r.kind === 'ship' ? <Pill tone={r.rest ? 'warn' : 'info'}>{r.rest ? t('status.rest') : t('status.toShip')}</Pill> : <Pill tone="good">{r.rest ? t('status.part') : t('status.delivered')}</Pill>;

  const columns: Column<Row>[] = [
    {
      key: 'order',
      header: t('cols.order'),
      render: (r) => (
        <>
          <span className="nm">{r.customerName}</span>
          <span className="sb">
            <bdi>{r.number}</bdi>
          </span>
        </>
      ),
    },
    { key: 'to', header: t('cols.deliversTo'), render: (r) => r.city ?? '—' },
    { key: 'when', header: t('cols.when'), render: (r) => <span className="nowrap">{r.when}</span> },
    { key: 'cartons', header: t('cols.cartons'), type: 'count', render: (r) => num(r.cartons) },
    { key: 'status', header: t('cols.status'), type: 'status', render: status },
    {
      key: 'note',
      header: <span className="sr-only">{t('note.view')}</span>,
      type: 'amount',
      render: (r) =>
        r.note?.signedNoteId ? (
          <button
            type="button"
            className="an-iconbtn"
            aria-label={`${t('note.view')} · ${r.number}`}
            onClick={(e) => {
              e.stopPropagation();
              setView(r.note);
            }}
          >
            <Icon as={Eye} />
          </button>
        ) : null,
    },
  ];

  const lastToday = last && daysAgo(last.at) === 0;

  return (
    <div className="page">
      {header}
      <div className="kpis" style={{ ['--n' as string]: 3 }}>
        <KpiTile label={t('tiles.toShip')} value={num(d.tiles.toShipOrders)} sub={d.tiles.toShipNumbers.length ? d.tiles.toShipNumbers.join(', ') : t('tiles.nothingWaiting')} />
        <KpiTile label={t('tiles.delivered')} value={num(d.tiles.deliveredThisMonth)} sub={d.tiles.deliveredThisMonth ? t('tiles.withNotes') : t('tiles.noneYet')} />
        <KpiTile
          label={t('tiles.lastCount')}
          value={!last ? t('tiles.noCount') : lastToday ? t('tiles.today') : dateShort(last.at)}
          sub={last && sameMonth(last.at) ? t('tiles.counted', { n: last.cartons }) : t('tiles.noCountSub')}
        />
      </div>

      <Card flush className="only-wide">
        <Table columns={columns} rows={rows} rowKey={(r) => r.key} onRow={(r) => router.push(`/sales/${r.orderId}`)} />
        <div className="body-sm muted" style={{ padding: 'var(--space-4) var(--card-padding)', borderTop: '1px solid var(--line)' }}>
          {t('foot')}
        </div>
      </Card>
      <div className="list-cards only-phone">
        {rows.map((r) => (
          <ListCard
            key={r.key}
            onClick={r.note ? () => setView(r.note) : () => router.push(`/sales/${r.orderId}`)}
            title={r.customerName}
            amount={r.when}
            sub={
              <>
                <bdi>{r.number}</bdi>
                {r.city && ` · ${r.city}`} · {t('card.cartons', { n: r.cartons })}
              </>
            }
            status={status(r)}
          />
        ))}
      </div>
      <NoteViewSheet row={view} onClose={() => setView(null)} />
    </div>
  );
}
