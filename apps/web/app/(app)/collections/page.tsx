'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { OrderStatus } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import {
  Banner,
  Button,
  CaretDown,
  CaretRight,
  Card,
  Chips,
  DownloadSimple,
  EmptyState,
  EnvelopeSimple,
  ErrorState,
  Icon,
  MenuButton,
  Money,
  PageHeader,
  PageSkeleton,
  Phone,
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
    <button type="button" className="an-kpi clk" onClick={onClick} style={{ textAlign: 'start', font: 'inherit', color: 'inherit' }}>
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
    success: copyBroker ? t('reminderSent', { name: row.customerName, broker: first(row.brokerName) }) : t('reminderSentNoCopy', { name: row.customerName }),
    onDone,
  });
  return { draft, text, setText, send };
}

function DraftBox({ row, copyBroker, onDone, phone }: { row: Row; copyBroker: boolean; onDone: () => void; phone?: boolean }) {
  const t = useTranslations('collections');
  const tc = useTranslations('common');
  const { draft, text, setText, send } = useReminder(row, copyBroker, onDone);
  if (draft.error) return <ErrorState error={draft.error} retry={() => draft.refetch()} />;
  const box =
    text === null ? (
      <Skeleton h={phone ? 76 : 40} />
    ) : (
      <textarea
        className="an-area"
        dir="auto"
        aria-label={t('draftLabel', { email: draft.data?.to ?? '' })}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={phone ? 5 : 2}
        style={{ minHeight: 0 }}
      />
    );
  const buttons = (
    <>
      <Button size={phone ? 'md' : 'sm'} onClick={onDone} style={phone ? { flex: '1 1 0' } : undefined}>
        {tc('discard')}
      </Button>
      <Button size={phone ? 'md' : 'sm'} variant="primary" busy={send.busy} disabled={!text?.trim()} onClick={() => send.mutate(undefined)} style={phone ? { flex: '1 1 0' } : undefined}>
        {t('sendReminder')}
      </Button>
    </>
  );
  return (
    <div className="stack tight">
      {phone ? (
        <>
          {box}
          <div className="row">{buttons}</div>
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--space-4)', alignItems: 'center' }}>
          {box}
          <div className="row">{buttons}</div>
        </div>
      )}
      {send.errorText && <Banner tone="bad">{send.errorText}</Banner>}
    </div>
  );
}

export default function CollectionsPage() {
  const t = useTranslations('collections');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const { isBroker } = useSession();
  const { money, num, dateShort } = useFmt();
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
    r.daysLate > 0 ? <Pill tone="bad">{tc('daysLate', { n: r.daysLate })}</Pill> : r.paymentDueOn ? <Pill tone="warn">{t('dueOn', { date: dateShort(r.paymentDueOn) })}</Pill> : null;
  const toggle = (r: Row) => setOpen(open === r.orderId ? null : r.orderId);

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
      <div className="only-phone" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-2)' }}>
        {[
          { k: 'late', label: t('tiles.late'), v: empty ? num(0) : money(tiles.lateCents, true), bad: !empty && tiles.lateCents > 0, go: () => pick('late') },
          { k: 'week', label: t('tiles.weekShort'), v: empty ? num(0) : money(tiles.dueWeekCents, true), go: () => pick('week') },
          { k: 'all', label: t('tiles.all'), v: empty ? num(0) : money(tiles.allCents, true), go: () => pick('all') },
        ].map((x) => (
          <button key={x.k} type="button" className="an-kpi clk" onClick={empty ? undefined : x.go} style={{ padding: 'var(--space-3)', textAlign: 'start', font: 'inherit', color: 'inherit', minWidth: 0 }}>
            <span className="caption muted">{x.label}</span>
            <bdi className="body-lg tnum" style={{ color: x.bad ? 'var(--bad)' : undefined, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {x.v}
            </bdi>
          </button>
        ))}
      </div>

      {empty ? (
        <Card>
          <EmptyState icon={Money} title={t('empty.title')} text={t('empty.text')} />
        </Card>
      ) : (
        <>
          <Chips
            fill={false}
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
            <div className="only-phone" style={{ display: 'grid' }}>
              <MenuButton
                align="start"
                items={brokerItems}
                trigger={({ open: o, toggle: tg, ref }) => (
                  <button ref={ref} type="button" className="an-input an-dd" aria-expanded={o} aria-haspopup="menu" aria-label={`${tc('broker')}: ${brokerLabel}`} onClick={tg} style={{ minHeight: 44 }}>
                    <span>{brokerLabel}</span>
                    <Icon as={CaretDown} size="sm" />
                  </button>
                )}
              />
            </div>
          )}

          <Card flush className="only-wide">
            <div className="tbl-wrap">
              <table className="an-tbl">
                <thead>
                  <tr>
                    <th>{t('cols.customer')}</th>
                    {showBroker && <th>{tc('broker')}</th>}
                    <th className="amt">{tc('amount')}</th>
                    <th>{t('cols.when')}</th>
                    <th className="amt">
                      <span className="sr-only">{t('cols.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={showBroker ? 5 : 4} className="muted">
                        {broker ? t('nothingFor', { name: broker.name }) : t('nothingHere')}
                      </td>
                    </tr>
                  )}
                  {items.map((r) => (
                    <Fragment key={r.orderId}>
                      <tr>
                        <td>
                          <Link href={`/customers/${r.customerId}`} className="nm">
                            {r.customerName}
                          </Link>
                          <span className="sb">
                            <Link href={`/sales/${r.orderId}`}>
                              <bdi>{r.number}</bdi>
                            </Link>
                          </span>
                        </td>
                        {showBroker && <td>{r.brokerName}</td>}
                        <td className="amt">
                          <bdi>{money(r.outstandingCents)}</bdi>
                        </td>
                        <td>{when(r)}</td>
                        <td className="amt">
                          {open === r.orderId ? (
                            <span className="body-sm muted">{t('draftBelow')}</span>
                          ) : r.remindedToday ? (
                            <span className="body-sm" style={{ color: 'var(--good)' }}>
                              {copyBroker ? t('sentToday', { name: first(r.brokerName) }) : t('sentTodayNoCopy')}
                            </span>
                          ) : (
                            <span className="row end">
                              <a className="an-btn secondary sm" href={telHref(r.phone)}>
                                <Phone className="an-ic sm" aria-hidden /> {tc('call')}
                              </a>
                              <Button size="sm" icon={EnvelopeSimple} onClick={() => toggle(r)}>
                                {t('remind')}
                              </Button>
                            </span>
                          )}
                        </td>
                      </tr>
                      {open === r.orderId && (
                        <tr>
                          <td colSpan={showBroker ? 5 : 4}>
                            <DraftBox row={r} copyBroker={copyBroker} onDone={() => setOpen(null)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="caption muted" style={{ padding: 'var(--space-4) var(--card-padding)', borderBlockStart: '1px solid var(--line)' }}>
              {copyBroker ? t('foot') : t('footNoCopy')}
            </div>
          </Card>

          <div className="list-cards only-phone">
            {items.length === 0 && <span className="body-sm muted">{broker ? t('nothingFor', { name: broker.name }) : t('nothingHere')}</span>}
            {items.map((r) => (
              <div key={r.orderId} className="an-card" style={{ gap: 'var(--space-1)' }}>
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
                {open === r.orderId ? (
                  <DraftBox row={r} copyBroker={copyBroker} phone onDone={() => setOpen(null)} />
                ) : r.remindedToday ? (
                  <span className="body-sm" style={{ color: 'var(--good)' }}>
                    {copyBroker ? t('sentTodayCard', { name: first(r.brokerName) }) : t('sentTodayCardNoCopy')}
                  </span>
                ) : (
                  <div className="row" style={{ marginBlockStart: 'var(--space-1)' }}>
                    <a className="an-btn secondary" href={telHref(r.phone)} style={{ flex: '1 1 0' }}>
                      <Phone className="an-ic sm" aria-hidden /> {tc('call')}
                    </a>
                    <Button icon={EnvelopeSimple} onClick={() => toggle(r)} style={{ flex: '1 1 0' }}>
                      {t('remind')}
                    </Button>
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
