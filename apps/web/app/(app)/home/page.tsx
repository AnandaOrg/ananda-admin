'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatDay, useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useMedia } from '@/lib/hooks';
import { useAsOf } from '@/lib/asof';
import {
  ActionError,
  ArrowCounterClockwise,
  Bank,
  Button,
  CaretRight,
  Card,
  Check,
  ClockCounterClockwise,
  EmptyState,
  FileText,
  HourglassMedium,
  Icon,
  KpiTile,
  List,
  ListRow,
  Money,
  NotePencil,
  Package,
  PageHeader,
  PageState,
  Pill,
  Plus,
  Sheet,
  FlavourStock,
  Tag,
  TrendDown,
  Truck,
  UserPlus,
  WarningCircle,
} from '@/components/ui';
import { AllocateSheet } from '../inventory/_components/AllocateSheet';
import { AddCustomerSheet } from '../customers/AddCustomerSheet';
import { NewSaleSheet } from '../sales/NewSaleSheet';
import { ReviewPanel } from './ReviewPanel';
import { SetupBanner } from '../brokers/_components/SetupBanner';
import { BrokerEmailSheet, BankSheet, LatePurchaseSheet, NoInvoiceSheet, OverdueSheet } from './HomeSheets';
import { useDecision } from './useDecision';
import type { Attention, HomeData, OkRow, Step } from './types';
import s from './home.module.css';

const ICON = { new_customer: UserPlus, special_price: Tag, correction: NotePencil, payment: Money } as const;
/** Rows the phone shows under Needs attention (the rest are one tap away in their screens). */
const PHONE_ATTENTION = ['overdue', 'delivered_not_invoiced', 'late_purchases', 'waiting_for_stock'];
type Panel = 'todo' | 'allok' | 'allatt' | 'overdue' | 'delivered_not_invoiced' | 'late_purchases' | 'alloc' | 'bank' | null;

export default function HomePage() {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const phone = useMedia('(max-width: 767px)');
  const { isBroker, can, canView, canEdit, isWarehouse } = useSession();
  const { day } = useAsOf();
  const { money, date, num } = useFmt();
  const [panel, setPanel] = useState<Panel>(null);
  const [adding, setAdding] = useState(false);
  const [selling, setSelling] = useState(false);
  const [mail, setMail] = useState<{ brokerId: string; brokerName: string; brokerEmail?: string | null; subject: string; body: string } | null>(null);
  const review = params.get('review');
  const home = useQuery({ queryKey: ['home', day], queryFn: () => api.get<HomeData>('/home') });
  const { approve, undo } = useDecision(undefined, true);

  useEffect(() => {
    if (isWarehouse) router.replace('/warehouse');
  }, [isWarehouse, router]);

  if (!home.data) return <PageState query={home} />;
  const d = home.data;
  const setReview = (id: string | null) => router.replace(id ? `/home?review=${id}` : '/home', { scroll: false });
  const attention = (k: string) => d.attention.find((a) => a.kind === k) ?? null;
  const pendingOk = d.needsYourOk.filter((r) => r.status === 'pending');
  const showOk = can('approve') || can('confirm_payment');
  const setup = d.onboarding;
  const doneSteps = setup?.filter((x) => x.done).length ?? 0;
  const kicker = formatDay(d.today, locale);
  const first = (n?: string | null) => (n ?? '').split(' ')[0];
  const flavours = (f?: string[]) => (f ?? []).map((x) => x.toUpperCase()).join(', ');

  // ---------- pieces ----------

  const okLine = (r: OkRow) => {
    const who = r.customerName ?? '—';
    switch (r.kind) {
      case 'new_customer':
        return `${who} · ${t(`ok.vat.${r.summary?.vat ?? 'unchecked'}`)}`;
      case 'special_price':
        return `${who} · ${t('ok.instead', { price: money(r.summary?.unitPriceCents ?? 0), list: money(r.summary?.tierUnitPriceCents ?? 0) })}`;
      case 'correction': {
        const parts = [r.summary?.fewer?.length ? t('ok.fewer', { f: flavours(r.summary.fewer) }) : null, r.summary?.more?.length ? t('ok.more', { f: flavours(r.summary.more) }) : null].filter(Boolean).join(', ');
        return `${who} · ${r.orderNumber} · ${parts || t('ok.changed')}`;
      }
      default:
        return `${who} · ${r.orderNumber} · ${money(r.totalCents ?? 0)}`;
    }
  };

  const okRow = (r: OkRow) => {
    const decided = r.status !== 'pending';
    const title = r.kind === 'payment' ? t('ok.payment') : t(`ok.${r.kind}`);
    return (
      <div key={`${r.kind}-${r.id}`} className={`${s.ar} ${decided ? s.dashed : ''}`}>
        <span className={`${s.ico} ${decided ? '' : s.y}`}>
          <Icon as={ICON[r.kind]} />
        </span>
        <div className="grow">
          <div className={s.t1}>
            {title}
            {decided ? <Pill tone={r.status === 'approved' ? 'good' : 'bad'}>{r.status === 'approved' ? t('ok.approved') : t('ok.declined')}</Pill> : <Pill tone="blue">{r.brokerName}</Pill>}
          </div>
          <div className={s.t2}>
            <bdi>{okLine(r)}</bdi>
          </div>
        </div>
        <div className={s.acts}>
          {decided ? (
            <Button size="sm" icon={ArrowCounterClockwise} writes busy={undo.busy && undo.variables === r.id} onClick={() => undo.mutate(r.id)}>
              {tc('undo')}
            </Button>
          ) : r.kind === 'payment' ? (
            <Link href={`/sales/${r.orderId}`} className="an-btn primary sm">
              {t('ok.confirmPayment')}
            </Link>
          ) : (
            <>
              <Button size="sm" onClick={() => setReview(r.id)}>
                {tc('review')}
              </Button>
              <Button size="sm" variant="primary" busy={approve.busy && approve.variables === r.id} onClick={() => approve.mutate(r.id)}>
                {tc('approve')}
              </Button>
            </>
          )}
        </div>
        {approve.variables === r.id && approve.error && (
          <div className={s.arErr}>
            <ActionError action={approve} message={t('review.approveFailedFor', { name: r.customerName ?? r.orderNumber ?? '' })} />
          </div>
        )}
      </div>
    );
  };

  const attIcon: Record<string, { icon: typeof Bank; tone?: 'bad' | 'warn' | 'accent' }> = {
    overdue: { icon: WarningCircle, tone: 'bad' },
    delivered_not_invoiced: { icon: FileText },
    late_purchases: { icon: HourglassMedium, tone: 'warn' },
    reorder: { icon: TrendDown, tone: 'warn' },
    waiting_for_stock: { icon: Package },
    to_deliver: { icon: Truck },
    drafts: { icon: NotePencil },
    bank_balance: { icon: Bank, tone: 'warn' },
  };

  const attTitle = (a: Attention) => (a.kind === 'bank_balance' && a.detail ? t('attention.bankOld', { n: a.daysOld ?? 0 }) : t(`attention.${a.kind}`));
  const attSub = (a: Attention): ReactNode => {
    switch (a.kind) {
      case 'overdue':
        return t('attention.oldest', { n: a.oldestDays ?? 0 });
      case 'delivered_not_invoiced':
        return t('attention.fullyPaid', { n: a.paidCount ?? 0 });
      case 'late_purchases':
        return t('attention.lateSub', { number: a.detail ?? '', n: a.oldestDays ?? 0 });
      case 'reorder': {
        const items = (a.items ?? []) as { flavour: string; status: string; monthsLeft: number | null; runsOutOn: string | null }[];
        const f = items[0];
        if (!f) return null;
        const rest = items.length > 1 ? ` +${items.length - 1}` : '';
        return f.status === 'reorder_now' && f.runsOutOn
          ? `${f.flavour.toUpperCase()}${rest} · ${t('attention.runsOut', { date: date(f.runsOutOn) })}`
          : `${f.flavour.toUpperCase()}${rest} · ${t('attention.monthsLeft', { n: num(Math.round(f.monthsLeft ?? 0)) })}`;
      }
      case 'waiting_for_stock':
        return a.canAllocate ? t('attention.stockIn') : a.purchase ? t('attention.waitingFor', { number: a.purchase.number }) : t('attention.waitingNoPurchase');
      case 'to_deliver': {
        const n = a.numbers ?? [];
        return n.length <= 2 ? n.join(` ${t('and')} `) : t('attention.andMore', { list: n.slice(0, 2).join(', '), n: n.length - 2 });
      }
      case 'drafts':
        return a.oldest ? `${a.oldest.customerName ?? '—'} · ${t('attention.since', { date: date(a.oldest.createdAt) })}` : null;
      case 'bank_balance':
        return a.detail ? t('attention.lastBalance', { date: date(a.detail) }) : t('attention.noBalance');
      default:
        return null;
    }
  };
  const openAtt = (a: Attention) => {
    if (a.kind === 'overdue' || a.kind === 'delivered_not_invoiced' || a.kind === 'late_purchases') return () => setPanel(a.kind as Panel);
    if (a.kind === 'bank_balance') return a.canRecord ? () => setPanel('bank') : () => router.push(a.link);
    if (a.kind === 'waiting_for_stock') return undefined;
    return () => router.push(a.link);
  };
  const attValue = (a: Attention): ReactNode => {
    if (a.kind === 'overdue') return <span className="bad">{`${num(a.count)} · ${money(a.cents ?? 0, true)}`}</span>;
    if (a.kind === 'reorder') return <span className={a.tone === 'bad' ? 'bad' : 'warn'}>{num(a.count)}</span>;
    if (a.kind === 'bank_balance') return <span className="warn">{t('attention.record')}</span>;
    return num(a.count);
  };
  const waitingActs = (a: Attention) =>
    a.canAllocate ? (
      <span className="row">
        {num(a.count)}
        <Button size="sm" onClick={() => setPanel('alloc')}>
          {t('attention.allocate')}
        </Button>
      </span>
    ) : (
      <span className="row">
        {num(a.count)}
        <Pill tone="mute">{t('attention.waiting')}</Pill>
      </span>
    );
  const attRow = (a: Attention) => {
    const ic = attIcon[a.kind] ?? { icon: FileText };
    return (
      <ListRow
        key={a.kind}
        icon={ic.icon}
        iconTone={a.kind === 'reorder' && a.tone === 'bad' ? 'bad' : ic.tone}
        title={attTitle(a)}
        sub={attSub(a)}
        value={a.kind === 'waiting_for_stock' ? undefined : attValue(a)}
        actions={a.kind === 'waiting_for_stock' ? waitingActs(a) : undefined}
        onClick={openAtt(a)}
      />
    );
  };

  const header = (
    <PageHeader
      kicker={kicker}
      title={t('title')}
      actions={
        setup ? undefined : phone ? (
          <div className={s.phoneActs}>
            {canEdit('customers') && (
              <Button icon={UserPlus} onClick={() => setAdding(true)}>
                {t('addCustomer')}
              </Button>
            )}
            {canEdit('sales') && (
              <Button variant="primary" icon={Plus} onClick={() => setSelling(true)}>
                {tc('newSale')}
              </Button>
            )}
          </div>
        ) : (
          <>
            {canView('sales') && (
              <Link href="/sales" className="an-btn secondary sm keep">
                <Icon as={List} size="sm" />
                {t('openOrders')}
              </Link>
            )}
            {canEdit('customers') && (
              <Button size="sm" icon={UserPlus} onClick={() => setAdding(true)}>
                {t('addCustomer')}
              </Button>
            )}
            {canEdit('sales') && (
              <Button size="sm" variant="primary" icon={Plus} onClick={() => setSelling(true)}>
                {tc('newSale')}
              </Button>
            )}
          </>
        )
      }
    />
  );

  const tiles = (() => {
    const tm = d.tiles;
    if (setup) {
      return (
        <div className="kpis">
          <KpiTile label={t('tiles.salesMonth')} value={money(0, true)} sub={t('tiles.firstSale')} />
          <KpiTile label={t('tiles.owed')} value={money(0, true)} sub={t('tiles.nothingToCollect')} />
          <KpiTile label={t('tiles.salesYear')} value={money(0, true)} />
          <KpiTile label={t('tiles.dealProfit')} value={money(0, true)} />
        </div>
      );
    }
    const could = tm.salesMonth.couldCloseCents > 0 ? <span className={s.hlText}>{t('tiles.couldClose', { amount: money(tm.salesMonth.couldCloseCents, true) })}</span> : t('tiles.paidExclVat');
    const yearSub =
      tm.salesYear.changePct != null ? (
        <span className={tm.salesYear.changePct >= 0 ? 'good' : 'bad'}>{t('tiles.vsLastYear', { pct: `${tm.salesYear.changePct >= 0 ? '+' : '−'}${Math.abs(tm.salesYear.changePct)}` })}</span>
      ) : (
        t('tiles.salesYearSub', { n: tm.salesYear.deals })
      );
    if (phone) {
      return (
        <div className={s.ppulse}>
          <button type="button" className={s.pbox} onClick={() => setPanel('todo')}>
            <span className={s.k}>{t('tiles.salesMonth')}</span>
            <span className={s.num}>
              <bdi>{money(tm.salesMonth.cents, true)}</bdi>
            </span>
            <span className={s.s}>{tm.salesMonth.couldCloseCents > 0 ? <span className={s.hlText}>{t('tiles.couldClose', { amount: money(tm.salesMonth.couldCloseCents, true) })} ›</span> : t('tiles.paidExclVat')}</span>
          </button>
          <button type="button" className={s.pbox} onClick={() => router.push(canView('collections') ? '/collections' : '/sales')}>
            <span className={s.k}>{t('tiles.owed')}</span>
            <span className={s.num}>
              <bdi>{money(tm.owed.cents, true)}</bdi>
            </span>
            <span className={s.s}>{tm.owed.lateCents > 0 ? <><span className="bad">{t('tiles.late', { amount: money(tm.owed.lateCents, true) })}</span> ›</> : t('tiles.nothingLate')}</span>
          </button>
          {isBroker && tm.commission ? (
            <>
              <div className={s.pbox}>
                <span className={s.k}>{t('tiles.readyToPay')}</span>
                <span className={s.num}>{money(tm.commission.readyCents, true)}</span>
                <span className={s.s}>{t('tiles.readyToPaySub')}</span>
              </div>
              <div className={s.pbox}>
                <span className={s.k}>{t('tiles.coming')}</span>
                <span className={s.num}>{money(tm.commission.comingCents, true)}</span>
                <span className={s.s}>{t('tiles.comingSub')}</span>
              </div>
            </>
          ) : (
            <>
              <div className={s.pbox}>
                <span className={s.k}>{t('tiles.salesYear')}</span>
                <span className={s.num}>
                  <bdi>{money(tm.salesYear.cents, true)}</bdi>
                </span>
                <span className={s.s}>{yearSub}</span>
              </div>
              {tm.dealProfitYear && (
                <div className={s.pbox}>
                  <span className={s.k}>{t('tiles.dealProfit')}</span>
                  <span className={`${s.num} ${tm.dealProfitYear.cents >= 0 ? 'good' : 'bad'}`}>
                    <bdi>{money(tm.dealProfitYear.cents, true)}</bdi>
                  </span>
                  <span className={s.s}>{t('tiles.awaiting', { n: tm.dealProfitYear.awaitingPayment })}</span>
                </div>
              )}
            </>
          )}
        </div>
      );
    }
    return (
      <div className="kpis">
        <KpiTile
          label={t('tiles.salesMonth')}
          value={
            <>
              {money(tm.salesMonth.cents, true)} <span className={s.small}>{t('tiles.confirmed')}</span>
            </>
          }
          sub={could}
          link={{ href: '#what-to-do', label: t('whatToDo.title') }}
          linkAccent
          onClick={() => setPanel('todo')}
        />
        <KpiTile
          label={t('tiles.owed')}
          value={money(tm.owed.cents, true)}
          sub={tm.owed.lateCents > 0 ? t('tiles.lateOfIt', { amount: money(tm.owed.lateCents, true) }) : t('tiles.nothingLate')}
          subTone={tm.owed.lateCents > 0 ? 'bad' : undefined}
          link={canView('collections') ? { href: '/collections', label: t('tiles.openCollections') } : undefined}
          onClick={canView('collections') ? () => router.push('/collections') : undefined}
        />
        {isBroker && tm.commission ? (
          <>
            <KpiTile label={t('tiles.readyToPay')} value={money(tm.commission.readyCents, true)} sub={t('tiles.readyToPaySub')} link={{ href: '/brokers', label: tc('nav.earnings') }} />
            <KpiTile label={t('tiles.coming')} value={money(tm.commission.comingCents, true)} sub={t('tiles.comingSub')} />
          </>
        ) : (
          <>
            <KpiTile
              label={t('tiles.salesYear')}
              value={money(tm.salesYear.cents, true)}
              sub={yearSub}
              link={canView('pnl') ? { href: '/money/pnl', label: t('tiles.byMonth') } : undefined}
              onClick={canView('pnl') ? () => router.push('/money/pnl') : undefined}
            />
            {tm.dealProfitYear && (
              <KpiTile
                label={t('tiles.dealProfit')}
                value={money(tm.dealProfitYear.cents, true)}
                valueTone={tm.dealProfitYear.cents >= 0 ? 'good' : 'bad'}
                sub={t('tiles.paidDealsOnly')}
                link={{ href: '/money/deal-profit', label: tc('nav.deal_profit') }}
                onClick={() => router.push('/money/deal-profit')}
              />
            )}
          </>
        )}
      </div>
    );
  })();

  const maxFor = (st: NonNullable<HomeData['stock']>[number]) => {
    // Bars fill by how many months the stock lasts (14 months = full), the number is what's available.
    const months = st.monthsLeft == null ? 14 : Math.max(0.5, Math.min(14, st.monthsLeft));
    return Math.max(1, st.available) * (14 / months);
  };
  const stockCard = d.stock && (
    <button type="button" className={s.scard} onClick={() => router.push(canView('inventory') ? '/inventory' : '/sales')} aria-label={t('stock.aria')}>
      <span className={s.scardH}>
        {t('stock.title')}
        {canView('inventory') && (
          <span className={s.go}>
            {t('stock.inventory')} <Icon as={CaretRight} size="sm" className="flip" />
          </span>
        )}
      </span>
      <span className="stock-grid">
        {d.stock.map((st) => (
          <FlavourStock
            key={st.flavour}
            flavour={st.flavour}
            value={st.available}
            max={maxFor(st)}
            low={st.status === 'reorder_soon'}
            badge={st.status === 'reorder_now' ? <Pill tone="bad">{t('stock.reorder_now')}</Pill> : undefined}
            detail={
              phone ? (
                <>
                  <span>{t('stock.reserved', { n: num(st.reserved) })}</span>
                  <span>{t('stock.inTransit', { n: num(st.onTheWay) })}</span>
                </>
              ) : (
                <span>{`${t('stock.reserved', { n: num(st.reserved) })} · ${t('stock.inTransit', { n: num(st.onTheWay) })}`}</span>
              )
            }
          />
        ))}
      </span>
    </button>
  );

  const setupCard = setup && (
    <Card
      title={
        <span className="row" style={{ width: '100%' }}>
          {t('setup.title')}
          <span className={s.cnt} style={{ marginInlineStart: 'auto' }}>
            {doneSteps}/{setup.length}
          </span>
        </span>
      }
    >
      <span className={s.muted13}>{t('setup.text')}</span>
      <div className={s.setbar}>
        <i style={{ width: `${(doneSteps / setup.length) * 100}%` }} />
      </div>
      {setup.map((st, i) => {
        const firstOpen = setup.findIndex((x) => !x.done);
        const btn =
          st.key === 'customer' ? (
            <Button size="sm" variant={i === firstOpen ? 'primary' : 'secondary'} onClick={() => setAdding(true)}>
              {i === firstOpen ? t('setup.start') : t('setup.open')}
            </Button>
          ) : (
            <Link href={st.link} className={`an-btn ${i === firstOpen ? 'primary' : 'secondary'} sm keep`}>
              {i === firstOpen ? t('setup.start') : t('setup.open')}
            </Link>
          );
        return (
          <div key={st.key} className={`${s.ar} ${st.done ? s.dashed : ''}`}>
            <span className={`${s.ico} ${st.done ? '' : s.y}`}>{st.done ? <Icon as={Check} size="sm" /> : <span className={s.stepNo}>{i + 1}</span>}</span>
            <div className="grow">
              <div className={s.t1}>
                {t(`setup.steps.${st.key}`)}
                {st.done && <Pill tone="good">{t('setup.done')}</Pill>}
              </div>
              <div className={s.t2}>{t(`setup.desc.${st.key}`)}</div>
            </div>
            {!st.done && <div className={s.acts}>{btn}</div>}
          </div>
        );
      })}
    </Card>
  );

  const showAll = (n: number, y: boolean, p: Panel) => (
    <button type="button" className={`${s.showall} ${y ? s.y : ''}`} onClick={() => setPanel(p)}>
      {tc('showAll')} <span className={s.n}>{n}</span>
    </button>
  );

  const okCard = showOk && (
    <Card title={t('ok.title')} action={showAll(pendingOk.length, true, 'allok')}>
      <div className={s.scrl}>{d.needsYourOk.length === 0 ? <EmptyState done title={t('ok.emptyTitle')} text={t('ok.emptyText')} /> : d.needsYourOk.map(okRow)}</div>
    </Card>
  );
  const attCard = (
    <Card title={t('attention.title')} action={!setup && d.attention.length > 0 ? showAll(d.attention.length, false, 'allatt') : undefined}>
      {setup || d.attention.length === 0 ? (
        <EmptyState done title={setup ? t('attention.newTitle') : t('attention.emptyTitle')} text={setup ? t('attention.newText') : t('attention.emptyText')} />
      ) : (
        <div className={`${s.scrl} ${s.att}`}>{d.attention.map(attRow)}</div>
      )}
    </Card>
  );

  // ---------- phone ----------
  const phoneBody = (
    <>
      {tiles}
      {setup ? (
        <>
          {setupCard}
          {attCard}
        </>
      ) : (
        <>
          {showOk && (
            <>
              <div className={s.lbl}>{t('ok.phoneLabel', { n: pendingOk.length })}</div>
              {d.needsYourOk.filter((r) => r.kind !== 'payment').map(okRow)}
              {d.needsYourOk
                .filter((r) => r.kind === 'payment')
                .map((r) => (
                  <Link key={r.id} href={`/sales/${r.orderId}`} className={`${s.prow} ${s.hl}`}>
                    <b>{t('ok.payment')}</b>
                    <span className={`${s.r} ${s.hlText}`}>{t('ok.confirm')} ›</span>
                    <span className={s.s}>
                      <bdi>{okLine(r)}</bdi>
                    </span>
                  </Link>
                ))}
            </>
          )}
          <div className={s.lbl}>{t('attention.title')}</div>
          {d.attention.filter((a) => PHONE_ATTENTION.includes(a.kind)).length === 0 && <EmptyState done title={t('attention.emptyTitle')} />}
          {d.attention
            .filter((a) => PHONE_ATTENTION.includes(a.kind))
            .map((a) =>
              a.kind === 'waiting_for_stock' ? (
                <div key={a.kind} className={s.prow}>
                  <span>{attTitle(a)}</span>
                  <span className={s.r}>{num(a.count)}</span>
                  <span className={s.s}>{attSub(a)}</span>
                  {a.canAllocate ? (
                    <Button size="sm" onClick={() => setPanel('alloc')}>
                      {t('attention.allocate')}
                    </Button>
                  ) : (
                    <Pill tone="mute">{t('attention.waiting')}</Pill>
                  )}
                </div>
              ) : (
                <button key={a.kind} type="button" className={s.prow} onClick={openAtt(a)}>
                  <span>{attTitle(a)}</span>
                  <span className={s.r}>
                    {attValue(a)} ›
                  </span>
                </button>
              ),
            )}
          {stockCard}
        </>
      )}
    </>
  );

  // ---------- What to do ----------
  const sm = d.tiles.salesMonth;
  const lastSaleDays = d.whatToDo.lastSaleAt ? Math.floor((Date.now() - new Date(d.whatToDo.lastSaleAt).getTime()) / 86_400_000) : null;
  const monthName = new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : locale === 'bg' ? 'bg-BG' : 'en-GB', { month: 'long' }).format(new Date(`${d.today}T12:00:00`));
  const explain = [
    sm.cents === sm.lastYearCents ? t('whatToDo.same', { month: monthName, amount: money(sm.lastYearCents, true) }) : sm.cents > sm.lastYearCents ? t('whatToDo.up', { month: monthName, amount: money(sm.lastYearCents, true) }) : t('whatToDo.down', { month: monthName, amount: money(sm.lastYearCents, true) }),
    lastSaleDays != null && lastSaleDays > 14
      ? sm.couldCloseCents > 0
        ? t('whatToDo.noSaleReach', { date: date(d.whatToDo.lastSaleAt), amount: money(sm.couldCloseCents, true) })
        : t('whatToDo.noSale', { date: date(d.whatToDo.lastSaleAt) })
      : sm.couldCloseCents > 0
        ? t('whatToDo.reach', { amount: money(sm.couldCloseCents, true) })
        : null,
  ]
    .filter(Boolean)
    .join(' ');
  const stepRow = (st: Step) => {
    const name = first(st.brokerName);
    let icon = NotePencil;
    let tone = 'warn';
    let title: ReactNode = st.label;
    let sub: ReactNode = null;
    let act: ReactNode = null;
    let onClick: (() => void) | undefined;
    if (st.kind === 'approve_customer') {
      icon = UserPlus;
      tone = 'accent';
      sub = t('whatToDo.newFrom', { name });
      act = (
        <Button size="sm" variant="primary" busy={approve.busy && approve.variables === st.id} onClick={(e) => (e.stopPropagation(), approve.mutate(st.id))}>
          {tc('approve')}
        </Button>
      );
      onClick = () => {
        setPanel(null);
        setReview(st.id);
      };
    } else if (st.kind === 'draft' || st.kind === 'send_draft') {
      title = `${st.label} · ${money(st.cents, true)}`;
      sub = st.kind === 'send_draft' ? t('whatToDo.yourDraft', { date: date(st.since) }) : t('whatToDo.draftOf', { name, date: date(st.since) });
      act =
        st.kind === 'send_draft' ? (
          <Link href={st.link} className="an-btn secondary sm keep">
            {t('whatToDo.openDraft')}
          </Link>
        ) : st.brokerId ? (
          <Button
            size="sm"
            onClick={() =>
              setMail({
                brokerId: st.brokerId!,
                brokerName: st.brokerName ?? '',
                brokerEmail: st.brokerEmail,
                subject: t('whatToDo.draftSubject', { customer: st.label }),
                body: t('whatToDo.draftBody', { name, customer: st.label, number: st.number ?? '', amount: money(st.cents, true), date: date(st.since) }),
              })
            }
          >
            {t('whatToDo.email', { name })}
          </Button>
        ) : null;
    } else {
      icon = ClockCounterClockwise;
      tone = 'info';
      sub = t('whatToDo.dueReorder', { date: date(st.since) });
      act =
        st.brokerId && !isBroker ? (
          <Button
            size="sm"
            onClick={() =>
              setMail({
                brokerId: st.brokerId!,
                brokerName: st.brokerName ?? '',
                brokerEmail: st.brokerEmail,
                subject: st.label,
                body: t('whatToDo.reorderBody', { name, customer: st.label, date: date(st.since) }),
              })
            }
          >
            {t('whatToDo.email', { name })}
          </Button>
        ) : (
          <Link href={st.link} className="an-btn secondary sm keep">
            {t('whatToDo.openCustomer')}
          </Link>
        );
    }
    return (
      <ListRow
        key={st.kind + st.id}
        icon={icon}
        iconTone={tone === 'accent' ? 'accent' : tone === 'warn' ? 'warn' : undefined}
        title={title}
        sub={sub}
        actions={act}
        onClick={onClick}
      />
    );
  };

  return (
    <div className="page">
      {isBroker && <SetupBanner />}
      {header}
      {phone ? (
        phoneBody
      ) : (
        <>
          {tiles}
          {setup ? (
            <div className={s.homeg}>
              {setupCard}
              {attCard}
            </div>
          ) : (
            <>
              <div className={s.homeg}>
                {okCard || null}
                {attCard}
              </div>
              {stockCard}
            </>
          )}
        </>
      )}

      <Sheet open={panel === 'todo'} onClose={() => setPanel(null)} title={t('whatToDo.heading', { amount: money(sm.cents, true) })}>
        <div className={s.panel}>
          <p className={s.sub}>{explain}</p>
          <span className={s.sgrp}>{t('whatToDo.first')}</span>
          {d.whatToDo.steps.length === 0 ? <EmptyState done title={t('whatToDo.emptyTitle')} /> : <div className={s.allp}>{d.whatToDo.steps.map(stepRow)}</div>}
          {sm.couldCloseCents > 0 && <div className={s.note}>{t('whatToDo.couldNote', { drafts: money(sm.draftsCents, true), requests: money(sm.requestsCents, true) })}</div>}
        </div>
      </Sheet>
      <Sheet open={panel === 'allok'} onClose={() => setPanel(null)} title={t('ok.title')}>
        <div className={s.allp}>{d.needsYourOk.length ? d.needsYourOk.map(okRow) : <EmptyState done title={t('ok.emptyTitle')} />}</div>
      </Sheet>
      <Sheet open={panel === 'allatt'} onClose={() => setPanel(null)} title={t('attention.title')}>
        <div className={s.allp}>{d.attention.map(attRow)}</div>
      </Sheet>
      <OverdueSheet row={panel === 'overdue' ? attention('overdue') : null} onClose={() => setPanel(null)} />
      <NoInvoiceSheet row={panel === 'delivered_not_invoiced' ? attention('delivered_not_invoiced') : null} onClose={() => setPanel(null)} />
      <LatePurchaseSheet row={panel === 'late_purchases' ? attention('late_purchases') : null} onClose={() => setPanel(null)} />
      <AllocateSheet open={panel === 'alloc'} onClose={() => setPanel(null)} />
      <BankSheet open={panel === 'bank'} onClose={() => setPanel(null)} />
      <BrokerEmailSheet mail={mail} onClose={() => setMail(null)} />
      <AddCustomerSheet open={adding} onClose={() => setAdding(false)} />
      <NewSaleSheet open={selling} onClose={() => setSelling(false)} onDone={(r) => (setSelling(false), router.push(`/sales/${r.id}`))} />
      <ReviewPanel id={review} onClose={() => setReview(null)} />
    </div>
  );
}
