'use client';

import Link from 'next/link';
import s from './collections.module.css';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt, iso } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import {
  ActionError,
  Button,
  Sheet,
  Table,
  TABLE_PICKERS,
  type Column,
  Bell,
  CaretDown,
  EnvelopeSimple,
  Phone,
  RowActions,
  CaretRight,
  Card,
  Chips,
  DownloadSimple,
  EmptyState,
  ErrorState,
  Icon,
  MenuButton,
  Money,
  PageHeader,
  PageSkeleton,
  Pill,
  SelectPill,
  Skeleton,
  type MenuItem,
} from '@/components/ui';

interface Row {
  orderId: string;
  number: string;
  status: OrderStatus;
  paymentDueOn: string | null;
  outstandingCents: number;
  customerId: string;
  customerName: string;
  phone: string;
  email: string;
  brokerId: string;
  brokerName: string;
  daysLate: number;
  lastReminderAt: string | null;
  remindedToday: boolean;
}
interface Data {
  tiles: { lateCents: number; lateCount: number; dueWeekCents: number; dueWeekCount: number; allCents: number; allCount: number; oldestLateDays: number; everyCents: number | null };
  brokers: { id: string; name: string; unpaid: number }[] | null;
  /** Settings › E-mail "Copy the broker on reminders". */
  copyBroker: boolean;
  items: Row[];
}
type Filter = 'late' | 'week' | 'all';

const first = (name: string) => name.split(' ')[0];
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** One figure tile; the Late tile opens the late list (chevron), as on Overview. */
function Tile({ label, value, sub, bad, onClick }: { label: string; value: ReactNode; sub?: ReactNode; bad?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <div className="top">
        <span>{label}</span>
        {onClick && <Icon as={CaretRight} size="sm" />}
      </div>
      <div className={`v ${bad ? 'bad' : ''}`}>
        <bdi>{value}</bdi>
      </div>
      {sub && <div className="s">{sub}</div>}
    </>
  );
  return onClick ? (
    <button type="button" className={`an-kpi clk ${s.tileBtn}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="an-kpi">{body}</div>
  );
}

/** The reminder draft, read (and edited) before it goes out. The broker is copied (FR-COLL-3). */
function useReminder(row: Row, copyBroker: boolean, onDone: () => void) {
  const t = useTranslations('collections');
  const draft = useQuery({ queryKey: ['collections', 'draft', row.orderId], queryFn: () => api.get<{ to: string; subject: string; message: string }>(`/collections/${row.orderId}/reminder`), staleTime: Infinity });
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (draft.data && text === null) setText(draft.data.message);
  }, [draft.data, text]);
  const send = useAction(() => api.post(`/collections/${row.orderId}/reminder`, { subject: draft.data!.subject, message: text ?? '' }), {
    success: copyBroker ? t('reminderSent', { name: iso(row.customerName), broker: iso(first(row.brokerName)) }) : t('reminderSentNoCopy', { name: iso(row.customerName) }),
    onDone,
  });
  return { draft, text, setText, send };
}

/** Row actions as one menu: Get in touch with Call, Email and Remind (every width). */
function GetInTouch({ row, onRemind, block }: { row: Row; onRemind: () => void; block?: boolean }) {
  const t = useTranslations('collections');
  const tc = useTranslations('common');
  return (
    <RowActions
      label={t('getInTouch')}
      block={block}
      size={block ? 'md' : 'sm'}
      actions={[
        { key: 'call', label: tc('call'), icon: Phone, href: telHref(row.phone) },
        { key: 'email', label: t('emailAction'), icon: EnvelopeSimple, href: `mailto:${row.email}` },
        { key: 'remind', label: t('remindAction'), icon: Bell, onSelect: onRemind },
      ]}
    />
  );
}

/** The reminder, read and edited in a Sheet before it goes out. The broker is copied (FR-COLL-3). */
function ReminderSheet({ row, copyBroker, onDone }: { row: Row; copyBroker: boolean; onDone: () => void }) {
  const t = useTranslations('collections');
  const tc = useTranslations('common');
  const { draft, text, setText, send } = useReminder(row, copyBroker, onDone);
  return (
    <Sheet
      open
      onClose={onDone}
      dirty={text !== null && text !== draft.data?.message}
      title={t('sendReminder')}
      sub={
        <>
          {row.customerName} · <bdi>{row.number}</bdi>
        </>
      }
      footer={
        <>
          <ActionError action={send} />
          <div className={s.sheetBtns}>
            <Button onClick={onDone} className={s.share}>
              {tc('discard')}
            </Button>
            <Button variant="primary" className={s.share} busy={send.busy} disabled={!text?.trim()} onClick={() => send.mutate(undefined)}>
              {t('sendReminder')}
            </Button>
          </div>
        </>
      }
    >
      {draft.error ? (
        <ErrorState error={draft.error} retry={() => draft.refetch()} />
      ) : text === null ? (
        <Skeleton h={160} />
      ) : (
        <div className="an-field">
          <label>{t('draftLabel', { email: draft.data?.to ?? '' })}</label>
          <textarea className={`an-area ${s.draft}`} dir="auto" aria-label={t('draftLabel', { email: draft.data?.to ?? '' })} value={text} onChange={(e) => setText(e.target.value)} rows={8} />
        </div>
      )}
    </Sheet>
  );
}

export default function CollectionsPage() {
  const t = useTranslations('collections');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const { isBroker } = useSession();
  const { money, date, num } = useFmt();
  const initial = params.get('filter');
  const [filter, setFilter] = useState<Filter>(initial === 'week' || initial === 'all' ? initial : 'late');
  const [brokerId, setBrokerId] = useState<string | null>(params.get('brokerId'));
  const [open, setOpen] = useState<string | null>(null);
  const query = qs({ filter, brokerId });
  const q = useQuery({ queryKey: ['collections', query], queryFn: () => api.get<Data>(`/collections${query}`) });

  if (q.isLoading) return <PageSkeleton />;
  if (!q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const { tiles, items, brokers, copyBroker } = q.data;
  const broker = brokers?.find((a) => a.id === brokerId) ?? null;
  const showBroker = !isBroker;
  const empty = tiles.allCount === 0 && !brokerId;

  const pick = (v: Filter) => {
    setOpen(null);
    setFilter(v);
  };
  const brokerItems: MenuItem[] = [
    { key: 'all', label: t('allBrokers'), detail: t('unpaidInvoices', { n: (brokers ?? []).reduce((s, a) => s + a.unpaid, 0) }), selected: !brokerId, onSelect: () => setBrokerId(null) },
    ...(brokers ?? []).map((a) => ({ key: a.id, label: a.name, detail: t('unpaidInvoices', { n: a.unpaid }), selected: a.id === brokerId, onSelect: () => setBrokerId(a.id) })),
  ];
  const brokerLabel = broker?.name ?? t('allBrokers');

  const when = (r: Row) =>
    r.daysLate > 0 ? <Pill tone="bad">{tc('daysLate', { n: r.daysLate })}</Pill> : r.paymentDueOn ? <Pill tone="warn">{t('dueOn', { date: date(r.paymentDueOn) })}</Pill> : null;
  const toggle = (r: Row) => setOpen(open === r.orderId ? null : r.orderId);

  const sheetRow = items.find((r) => r.orderId === open) ?? null;
  const columns: Column<Row>[] = [
    {
      key: 'customer',
      header: t('cols.customer'),
      render: (r) => (
        <>
          <Link href={`/customers/${r.customerId}`} className="nm">
            {r.customerName}
          </Link>
          <span className="sb">
            <Link href={`/sales/${r.orderId}`}>
              <bdi>{r.number}</bdi>
            </Link>
          </span>
        </>
      ),
    },
    ...(showBroker ? [{ key: 'broker', header: tc('broker'), render: (r: Row) => r.brokerName } as Column<Row>] : []),
    { key: 'amount', header: tc('amount'), type: 'amount', render: (r) => <bdi>{money(r.outstandingCents)}</bdi> },
    { key: 'when', header: t('cols.when'), type: 'status', render: (r) => when(r) },
    {
      key: 'actions',
      header: <span className="sr-only">{t('cols.actions')}</span>,
      type: 'amount',
      render: (r) =>
        r.remindedToday ? (
          <span className={`body-sm ${s.sent}`}>{copyBroker ? t('sentToday', { name: first(r.brokerName) }) : t('sentTodayNoCopy')}</span>
        ) : (
          <GetInTouch row={r} onRemind={() => toggle(r)} />
        ),
    },
  ];

  const kicker = empty ? t('nothingUnpaid') : isBroker ? t('kickerOwn', { n: tiles.allCount }) : t('kicker', { n: tiles.allCount, who: broker?.name ?? t('everyBroker') });
  const allSub = broker && tiles.everyCents != null ? t('tiles.share', { name: first(broker.name), total: money(tiles.everyCents, true) }) : t('tiles.sameAsOverview');

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.collections') }]}
        kicker={<span className="only-wide">{kicker}</span>}
        title={tc('nav.collections')}
        actions={
          empty ? undefined : (
            <span className="row only-wide">
              {showBroker && <SelectPill label={tc('broker')} value={brokerLabel} items={brokerItems} />}
              <a className="an-btn secondary sm" href={`/api/collections/export.csv${query}`}>
                <DownloadSimple className="an-ic sm" aria-hidden /> {tc('exportCsv')}
              </a>
            </span>
          )
        }
      />

      {/* Desktop tiles: Late + Due this week = All unpaid, the same figure as Overview. */}
      <div className="kpis only-wide" style={{ ['--n' as string]: 3 }}>
        {empty ? (
          <>
            <Tile label={t('tiles.late')} value={num(0)} />
            <Tile label={t('tiles.week')} value={num(0)} />
            <Tile label={t('tiles.all')} value={num(0)} />
          </>
        ) : (
          <>
            <Tile label={t('tiles.late')} value={money(tiles.lateCents, true)} bad={tiles.lateCents > 0} sub={t('tiles.invoices', { n: tiles.lateCount })} onClick={() => pick('late')} />
            <Tile label={t('tiles.week')} value={money(tiles.dueWeekCents, true)} sub={t('tiles.invoices', { n: tiles.dueWeekCount })} />
            <Tile label={t('tiles.all')} value={money(tiles.allCents, true)} sub={isBroker ? undefined : allSub} />
          </>
        )}
      </div>
      {/* Phone tiles: three compact figures in one row. */}
      <div className={`only-phone ${s.tiles3}`}>
        {[
          { k: 'late', label: t('tiles.late'), v: empty ? num(0) : money(tiles.lateCents, true), bad: !empty && tiles.lateCents > 0, go: () => pick('late') },
          { k: 'week', label: t('tiles.weekShort'), v: empty ? num(0) : money(tiles.dueWeekCents, true), go: () => pick('week') },
          { k: 'all', label: t('tiles.all'), v: empty ? num(0) : money(tiles.allCents, true), go: () => pick('all') },
        ].map((x) => (
          <button key={x.k} type="button" className={`an-kpi clk ${s.tile}`} onClick={empty ? undefined : x.go}>
            <span className="caption muted">{x.label}</span>
            <bdi className={`body-lg tnum ${s.tileV} ${x.bad ? s.bad : ''}`}>
              {x.v}
            </bdi>
          </button>
        ))}
      </div>

      {sheetRow && <ReminderSheet row={sheetRow} copyBroker={copyBroker} onDone={() => setOpen(null)} />}
      {empty ? (
        <Card>
          <EmptyState icon={Money} title={t('empty.title')} text={t('empty.text')} />
        </Card>
      ) : (
        <>
          <Chips
            label={tc('nav.collections')}
            value={filter}
            onChange={pick}
            options={[
              { value: 'late', label: t('filters.late'), count: tiles.lateCount },
              { value: 'week', label: t('filters.week'), count: tiles.dueWeekCount },
              { value: 'all', label: t('filters.all'), count: tiles.allCount },
            ]}
          />
          {showBroker && (
            <div className={`only-phone ${s.pickGrid}`}>
              <MenuButton
                align="start"
                items={brokerItems}
                trigger={({ open: o, toggle: tg, ref }) => (
                  <button ref={ref} type="button" className={`an-input an-dd ${s.dd}`} aria-expanded={o} aria-haspopup="menu" aria-label={`${tc('broker')}: ${brokerLabel}`} onClick={tg}>
                    <span>{brokerLabel}</span>
                    <Icon as={CaretDown} size="sm" />
                  </button>
                )}
              />
            </div>
          )}

          <Card flush className="only-wide">
            <Table
              columns={columns}
              rows={items}
              rowKey={(r) => r.orderId}
              picker={TABLE_PICKERS.collections}
              error={q.error}
              onRetry={() => q.refetch()}
              empty={<span className="muted">{broker ? t('nothingFor', { name: broker.name }) : t('nothingHere')}</span>}
            />
            <div className={`caption muted ${s.foot}`}>{copyBroker ? t('foot') : t('footNoCopy')}</div>
          </Card>

          <div className="list-cards only-phone">
            {items.length === 0 && <span className="body-sm muted">{broker ? t('nothingFor', { name: broker.name }) : t('nothingHere')}</span>}
            {items.map((r) => (
              <div key={r.orderId} className={`an-card ${s.cardGap}`}>
                <div className="row between">
                  <Link href={`/sales/${r.orderId}`} className="strong">
                    {r.customerName}
                  </Link>
                  <bdi className="strong tnum">{money(r.outstandingCents)}</bdi>
                </div>
                <div className="row between body-sm muted">
                  <span>
                    <bdi>{r.number}</bdi>
                    {showBroker && ` · ${r.brokerName}`}
                  </span>
                  {when(r)}
                </div>
                {r.remindedToday ? (
                  <span className={`body-sm ${s.sent}`}>
                    {copyBroker ? t('sentTodayCard', { name: first(r.brokerName) }) : t('sentTodayCardNoCopy')}
                  </span>
                ) : (
                  <div className={`row ${s.cardActs}`}>
                    <GetInTouch row={r} block onRemind={() => toggle(r)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
