'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { isoDate } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useAsOf } from '@/lib/asof';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import {
  ArrowUpRight,
  Button,
  CaretDown,
  CaretRight,
  Card,
  Chips,
  ClockCounterClockwise,
  DownloadSimple,
  EmptyState,
  Icon,
  ListCards,
  LoadError,
  Lock,
  MenuButton,
  NoAccess,
  PageHeader,
  Pill,
  Search,
  SelectPill,
  Sheet,
  SkeletonRows,
  Switch,
  Users,
} from '@/components/ui';
import { DayRangeCalendar, dayPreset, dayRangeLabel, rangeQuery, type DayRange } from '../money/_components/range-calendar';
import { deviceName } from '../users/_components/shared';
import { useAuditFormat, type AuditEntry } from './_components/audit-format';
import css from './audit.module.css';

/** Type chips (prototype order). Purchases count as Stock; settings, expenses and events show under Other when there are any. */
const GROUPS = {
  all: [],
  orders: ['orders'],
  payments: ['payments'],
  documents: ['documents'],
  stock: ['stock', 'purchasing'],
  customers: ['customers'],
  commission: ['commission'],
  users_access: ['users_access'],
  security: ['security'],
  other: ['settings', 'expenses', 'events'],
} as const;
type GroupKey = keyof typeof GROUPS;
const groupOf = (category: string): GroupKey => (Object.keys(GROUPS) as GroupKey[]).find((g) => g !== 'all' && (GROUPS[g] as readonly string[]).includes(category)) ?? 'other';

interface Page {
  items: AuditEntry[];
  total: number;
  next: string | null;
  counts: Record<string, number>;
}
interface Person {
  id: string;
  name: string | null;
  role: { key: string; name: string | null; isSystem: boolean } | null;
}

/** FR-ADM-2: who did what, newest first, grouped by day. Permanent and read-only. */
export default function AuditPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { date } = useFmt();
  const f = useAuditFormat();
  const { canView, me } = useSession();
  const asOf = useAsOf();
  const [range, setRange] = useState<DayRange>(() => dayPreset('this_year'));
  const [group, setGroup] = useState<GroupKey>('all');
  const [actorId, setActorId] = useState<string | null>(null);
  const [moneyOnly, setMoneyOnly] = useState(false);
  const [term, setTerm] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const [printing, setPrinting] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    const h = setTimeout(() => setQ(term.trim()), 250);
    return () => clearTimeout(h);
  }, [term]);

  // Looking back at a past day: nothing after the end of that day.
  const to = asOf.lookingBack && range.to > asOf.day ? asOf.day : range.to;
  const from = range.from > to ? to : range.from;
  const params = { category: GROUPS[group].join(',') || undefined, ...rangeQuery({ from, to }), actorId, money: moneyOnly ? '1' : undefined, q: q || undefined };
  const query = qs(params);
  const allowed = canView('audit');
  const people = useQuery({ queryKey: ['audit', 'people'], queryFn: () => api.get<Person[]>('/audit/people'), enabled: allowed });
  const list = useInfiniteQuery({
    queryKey: ['audit', query],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Page>(`/audit${qs({ ...params, before: pageParam, limit: 100 })}`),
    getNextPageParam: (last) => last.next,
    enabled: allowed,
  });

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(null);
    window.addEventListener('afterprint', done);
    const h = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(h);
      window.removeEventListener('afterprint', done);
    };
  }, [printing]);

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const first = list.data?.pages[0];
  const counts = first?.counts ?? {};
  const hasOther = GROUPS.other.some((c) => (counts[c] ?? 0) > 0) || group === 'other';
  const nothingYet = counts._all === 0;
  const today = isoDate();
  const dayKey = (at: string) => isoDate(new Date(at));
  const days = useMemo(() => {
    const out: { day: string; items: AuditEntry[] }[] = [];
    for (const e of rows) {
      const d = dayKey(e.at);
      if (out[out.length - 1]?.day !== d) out.push({ day: d, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [rows]);

  if (!allowed) return <NoAccess />;

  const time = (at: string) => new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : locale === 'he' ? 'he-IL' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  const dayLabel = (d: string, short = false) => {
    const txt = short ? dayRangeLabel(d, d, locale).replace(/\s\d{4}$|\.\d{2,4}$/, '') : date(d);
    return d === today ? t('audit.todayGroup', { date: txt }) : txt;
  };
  const roleName = (r: Person['role'] | AuditEntry['actorRole']) => (r ? (r.isSystem && t.has(`roles.names.${r.key}`) ? t(`roles.names.${r.key}`) : (r.name ?? '')) : '');
  const typeLabel = (e: AuditEntry) => {
    const g = groupOf(e.category);
    return g === 'other' ? f.category(e.category) : t(`audit.groups.${g}`);
  };
  const typePill = (e: AuditEntry) => <Pill tone={e.category === 'security' ? 'warn' : 'mute'}>{typeLabel(e)}</Pill>;
  const person = people.data?.find((p) => p.id === actorId);
  const recordHref = (e: AuditEntry) => {
    if (!e.recordId) return null;
    if (e.recordType === 'order') return `/sales/${e.recordId}`;
    if (e.recordType === 'customer') return `/customers/${e.recordId}`;
    if (e.recordType === 'purchase') return `/purchasing/${e.recordId}`;
    return null;
  };
  const rangeText = dayRangeLabel(from, to, locale);
  const exportAll = async () => {
    const all: AuditEntry[] = [];
    let before: string | null = null;
    do {
      const p: Page = await api.get<Page>(`/audit${qs({ ...params, before, limit: 500 })}`);
      all.push(...p.items);
      before = p.next;
    } while (before && all.length < 5000);
    setPrinting(all);
  };

  const exportMenu = (
    <MenuButton
      items={[
        { key: 'csv', label: t('audit.csv'), detail: t('audit.csvSub'), href: `/api/audit/export.csv${query}` },
        { key: 'pdf', label: t('audit.pdf'), detail: t('audit.pdfSub'), onSelect: () => void exportAll() },
      ]}
      trigger={({ open: o, toggle, ref }) => (
        <button ref={ref} type="button" className="an-btn secondary" aria-expanded={o} aria-haspopup="menu" onClick={toggle}>
          <Icon as={DownloadSimple} />
          {t('audit.export')}
          <Icon as={CaretDown} size="sm" />
        </button>
      )}
    />
  );

  const personPill = (
    <SelectPill
      icon={Users}
      label={t('audit.col.who')}
      value={person?.name ?? t('audit.everyone')}
      items={[
        { key: 'any', label: t('audit.everyone'), selected: !actorId, onSelect: () => setActorId(null) },
        ...(people.data ?? []).map((p) => ({ key: p.id, label: p.name ?? '', detail: roleName(p.role), selected: p.id === actorId, onSelect: () => setActorId(p.id) })),
      ]}
    />
  );

  if (nothingYet && !list.isLoading)
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tc('nav.audit') }]} kicker={t('audit.kickerEmpty')} title={tc('nav.audit')} />
        <Card>
          <EmptyState icon={ClockCounterClockwise} title={t('audit.nothingTitle')} text={t('audit.nothingText')} />
        </Card>
      </div>
    );

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.audit') }]}
        kicker={t('audit.kickerN', { n: first?.total ?? 0, range: rangeText })}
        title={tc('nav.audit')}
        actions={
          <span className={`only-wide ${css.actions}`}>
            <DayRangeCalendar value={range} onChange={setRange} />
            {personPill}
            {exportMenu}
          </span>
        }
      />

      <div className={css.filters}>
        <div className={css.chips}>
          <Chips
            fill={false}
            label={t('audit.category')}
            value={group}
            onChange={setGroup}
            options={(Object.keys(GROUPS) as GroupKey[]).filter((g) => g !== 'other' || hasOther).map((g) => ({ value: g, label: t(`audit.groups.${g}`) }))}
          />
        </div>
        <div className={css.right}>
          <span className={css.money}>
            <span className="muted body-sm">{t('audit.moneyOnly')}</span>
            <Switch checked={moneyOnly} onChange={setMoneyOnly} label={t('audit.moneyOnly')} />
          </span>
          <Search className={css.search} value={term} onChange={setTerm} placeholder={t('audit.search')} />
        </div>
      </div>

      {/* Desktop: one table, a header row per day */}
      <Card flush className="only-wide">
        <div className="tbl-wrap">
          <table className={`an-tbl ${css.tbl}`} aria-busy={list.isLoading || undefined}>
            <thead>
              <tr>
                <th scope="col" className={css.timeCol}>
                  {t('audit.col.time')}
                </th>
                <th scope="col">{t('audit.col.who')}</th>
                <th scope="col" className="c-main">
                  {t('audit.col.what')}
                </th>
                <th scope="col">{t('audit.col.record')}</th>
                <th scope="col" className={css.chev} aria-hidden />
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                <SkeletonRows cells={['text', 'text', 'text', 'status', 'empty']} />
              ) : list.error ? (
                <tr className="err-row">
                  <td colSpan={5}>
                    <LoadError error={list.error} onRetry={() => list.refetch()} />
                  </td>
                </tr>
              ) : days.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    {t('audit.noMatch')}
                  </td>
                </tr>
              ) : (
                days.map((d) => (
                  <Fragment key={d.day}>
                    <tr className={css.dayh}>
                      <td colSpan={5}>{dayLabel(d.day)}</td>
                    </tr>
                    {d.items.map((e) => {
                      const ba = f.beforeAfter(e);
                      return (
                        <tr key={e.id} className="clk" tabIndex={0} onClick={() => setOpen(e)} onKeyDown={(k) => k.key === 'Enter' && setOpen(e)}>
                          <td className={`muted ${css.timeCol}`}>
                            <bdi>{time(e.at)}</bdi>
                          </td>
                          <td className="nowrap">
                            {e.actorName ?? t('audit.system')}
                            {e.actorRole && <span className="sb">{roleName(e.actorRole)}</span>}
                          </td>
                          <td className="c-main">
                            <bdi>{f.sentence(e)}</bdi>
                            {ba && (
                              <span className={`sb ${css.ba}`}>
                                <bdi>{ba}</bdi>
                              </span>
                            )}
                          </td>
                          <td className="st">{typePill(e)}</td>
                          <td className={css.chev}>
                            <Icon as={CaretRight} size="sm" className="subtle" />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className={css.foot}>
          <Icon as={Lock} size="sm" />
          <span>{t('audit.foot')}</span>
        </div>
      </Card>

      {/* Phone: day labels with one card per entry */}
      <div className="only-phone stack">
        <ListCards loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} empty={<p className="muted">{t('audit.noMatch')}</p>}>
          {days.map((d) => (
            <Fragment key={d.day}>
              <span className={css.phoneDay}>{dayLabel(d.day, true)}</span>
              {d.items.map((e) => {
                const ba = f.beforeAfter(e);
                return (
                  <button key={e.id} type="button" className={`an-lcard ${css.pcard}`} onClick={() => setOpen(e)}>
                    <span className="t">{e.actorName ?? t('audit.system')}</span>
                    <span className={css.pType}>{typePill(e)}</span>
                    <span className="sub">
                      <bdi>{f.sentence(e)}</bdi>
                      {ba && (
                        <span className={css.ba}>
                          <br />
                          <bdi>{ba}</bdi>
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </Fragment>
          ))}
        </ListCards>
        <p className="muted body-sm">{t('audit.phoneFoot')}</p>
      </div>

      {list.hasNextPage && (
        <div className={css.more}>
          <Button busy={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            {t('audit.loadMore')}
          </Button>
        </div>
      )}

      <Sheet open={!!open} onClose={() => setOpen(null)} title={t('audit.entry.title')}>
        {open && (
          <>
            <h4 className={css.entryTitle}>
              <bdi>{f.sentence(open)}</bdi>
            </h4>
            <span>{typePill(open)}</span>
            <dl className="an-kv">
              <dt>{t('audit.entry.when')}</dt>
              <dd>
                {date(open.at)} · <bdi>{time(open.at)}</bdi>
              </dd>
              <dt>{t('audit.entry.who')}</dt>
              <dd>
                {open.actorName ?? t('audit.system')}
                {open.actorRole && ` · ${roleName(open.actorRole)}`}
              </dd>
              {f.rec(open) && (
                <>
                  <dt>{t('audit.entry.record')}</dt>
                  <dd>
                    <bdi>{f.rec(open)}</bdi>
                  </dd>
                </>
              )}
              {open.device && (
                <>
                  <dt>{t('audit.entry.device')}</dt>
                  <dd>
                    <bdi>{[deviceName(open.device.userAgent, open.device.kind === 'phone' ? t('users.member.phoneDevice') : t('users.member.desktopDevice')), open.device.ip].filter(Boolean).join(' · ')}</bdi>
                  </dd>
                </>
              )}
            </dl>
            {f.beforeAfter(open) && (
              <>
                <span className={css.sgrp}>{t('audit.entry.beforeAfter')}</span>
                <div className={css.note}>
                  <bdi>{f.beforeAfter(open)}</bdi>
                </div>
              </>
            )}
            {recordHref(open) && (
              <Link className="an-btn secondary" href={recordHref(open)!}>
                <Icon as={ArrowUpRight} size="sm" />
                {t('audit.entry.open', { record: open.recordLabel ?? '' })}
              </Link>
            )}
            <span className={`muted body-sm ${css.lockLine}`}>
              <Icon as={Lock} size="sm" /> {t('audit.entry.permanent')}
            </span>
          </>
        )}
      </Sheet>

      {/* PDF: the filtered entries as a printable report; the browser saves it as PDF. */}
      {printing && (
        <div className={css.print} aria-hidden>
          <h1>ANANDA · {tc('nav.audit')}</h1>
          <p>
            {rangeText} · {t('audit.print.generated', { date: date(new Date()), name: me.user.name })}
          </p>
          <table>
            <thead>
              <tr>
                <th>{t('audit.print.date')}</th>
                <th>{t('audit.col.who')}</th>
                <th>{t('audit.col.what')}</th>
                <th>{t('audit.col.record')}</th>
              </tr>
            </thead>
            <tbody>
              {printing.map((e) => (
                <tr key={e.id}>
                  <td>
                    {date(e.at)} {time(e.at)}
                  </td>
                  <td>
                    {e.actorName ?? t('audit.system')}
                    {e.actorRole && ` · ${roleName(e.actorRole)}`}
                  </td>
                  <td>
                    {f.sentence(e)}
                    {f.beforeAfter(e) && ` (${f.beforeAfter(e)})`}
                  </td>
                  <td>{typeLabel(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>{t('audit.foot')}</p>
        </div>
      )}
    </div>
  );
}
