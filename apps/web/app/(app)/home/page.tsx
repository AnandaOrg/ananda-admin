'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import {
  Button,
  Card,
  Check,
  Clock,
  Count,
  EmptyState,
  ErrorState,
  HourglassMedium,
  Info,
  KpiTile,
  ListRow,
  Money,
  NotePencil,
  Package,
  PageHeader,
  PageSkeleton,
  Pill,
  ProgressSteps,
  Receipt,
  Sheet,
  StockBars,
  Tag,
  Truck,
  UserPlus,
  Warning,
  WarningCircle,
  Bank,
} from '@/components/ui';
import { ReviewPanel } from './ReviewPanel';

interface HomeData {
  tiles: {
    salesMonth: { cents: number; couldCloseCents: number; couldCloseCount: number };
    owed: { cents: number; lateCents: number; lateCount: number; oldestLateDays: number };
    salesYear: { cents: number; units: number; deals: number };
    dealProfitYear: { cents: number; deals: number } | null;
    commission: { readyCents: number; comingCents: number } | null;
  };
  whatToDo: { kind: string; cents: number; label: string; id: string; agentName?: string; link: string }[];
  needsYourOk: { kind: string; id: string; customerName: string | null; agentName: string; orderId?: string; orderNumber?: string; reason?: string | null; totalCents?: number; payload?: Record<string, unknown> }[];
  attention: { kind: string; count: number; cents?: number; oldestDays?: number; detail?: string; link: string; action?: string }[];
  stock: { flavour: Flavour; available: number; reserved: number; onTheWay: number; nextArrivalOn: string | null; status: 'ok' | 'reorder_soon' | 'reorder_now' }[] | null;
  onboarding: { key: string; done: boolean; link: string; unlocked: boolean }[] | null;
}

const ATTENTION_ICON = {
  overdue: WarningCircle,
  delivered_not_invoiced: Receipt,
  late_purchases: Truck,
  supplier_follow_up: Clock,
  reorder: Warning,
  stock_count: Package,
  waiting_for_stock: HourglassMedium,
  to_deliver: Truck,
  drafts: NotePencil,
  bank_balance: Bank,
} as const;

export default function HomePage() {
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { isAgent, can, canView, isWarehouse } = useSession();
  const { money, num, date } = useFmt();
  const [whatToDo, setWhatToDo] = useState(false);
  const review = params.get('review');
  const home = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeData>('/home') });
  const approve = useAction((id: string) => api.post(`/approvals/${id}/approve`), { success: t('review.approved') });
  const issueAll = useAction(() => api.post<{ issued: string[] }>('/orders/invoice-all'), { success: (r) => t('issuedAll', { n: r.issued.length }) });

  useEffect(() => {
    if (isWarehouse) router.replace('/warehouse');
  }, [isWarehouse, router]);

  if (home.isLoading) return <PageSkeleton />;
  if (home.error || !home.data) return <ErrorState error={home.error} retry={() => home.refetch()} />;
  const d = home.data;
  const setReview = (id: string | null) => router.replace(id ? `/home?review=${id}` : '/home', { scroll: false });
  const maxStock = Math.max(1, ...(d.stock ?? []).map((s) => s.available + s.reserved + s.onTheWay));

  return (
    <div className="page">
      <PageHeader kicker={t('kicker')} title={tc('nav.home')} />

      {d.onboarding && (
        <Card title={t('onboarding.title')}>
          <p className="muted">{t('onboarding.text')}</p>
          <ProgressSteps
            current={d.onboarding.findIndex((s) => !s.done)}
            steps={d.onboarding.map((s) => ({
              label: t(`onboarding.steps.${s.key}`),
              action: s.unlocked && !s.done ? (
                <Link href={s.link} className="an-btn primary sm">
                  {t(`onboarding.actions.${s.key}`)}
                </Link>
              ) : undefined,
            }))}
          />
        </Card>
      )}

      <div className="kpis">
        <KpiTile
          label={t('tiles.salesMonth')}
          value={money(d.tiles.salesMonth.cents, true)}
          sub={d.tiles.salesMonth.couldCloseCents > 0 ? t('tiles.couldClose', { amount: money(d.tiles.salesMonth.couldCloseCents, true) }) : t('tiles.paidExclVat')}
          link={{ href: '#what-to-do', label: t('whatToDo.title') }}
          linkAccent
          onClick={() => setWhatToDo(true)}
        />
        <KpiTile
          label={t('tiles.owed')}
          value={money(d.tiles.owed.cents, true)}
          sub={d.tiles.owed.lateCents > 0 ? t('tiles.lateOfIt', { amount: money(d.tiles.owed.lateCents, true) }) : t('tiles.nothingLate')}
          subTone={d.tiles.owed.lateCents > 0 ? 'bad' : undefined}
          link={canView('collections') ? { href: '/collections', label: t('tiles.openCollections') } : undefined}
        />
        {isAgent && d.tiles.commission ? (
          <>
            <KpiTile label={t('tiles.readyToPay')} value={money(d.tiles.commission.readyCents, true)} sub={t('tiles.readyToPaySub')} link={{ href: '/agents', label: tc('nav.earnings') }} />
            <KpiTile label={t('tiles.coming')} value={money(d.tiles.commission.comingCents, true)} sub={t('tiles.comingSub')} />
          </>
        ) : (
          <>
            <KpiTile label={t('tiles.salesYear')} value={money(d.tiles.salesYear.cents, true)} sub={t('tiles.salesYearSub', { n: d.tiles.salesYear.deals })} tip={t('tiles.salesYearTip')} />
            {d.tiles.dealProfitYear && (
              <KpiTile
                label={t('tiles.dealProfit')}
                value={money(d.tiles.dealProfitYear.cents, true)}
                valueTone={d.tiles.dealProfitYear.cents >= 0 ? 'good' : 'bad'}
                sub={t('tiles.paidDealsOnly')}
                link={{ href: '/money/deal-profit', label: tc('nav.deal_profit') }}
              />
            )}
          </>
        )}
      </div>

      <div className="cols">
        <div className="stack loose">
          {(can('approve') || can('confirm_payment')) && (
            <Card title={<span className="row">{t('ok.title')} {d.needsYourOk.length > 0 && <Count n={d.needsYourOk.length} />}</span>}>
              {d.needsYourOk.length === 0 ? (
                <EmptyState done title={t('ok.emptyTitle')} text={t('ok.emptyText')} />
              ) : (
                <div className="lrows">
                  {d.needsYourOk.map((r) =>
                    r.kind === 'payment' ? (
                      <ListRow
                        key={`p-${r.id}`}
                        icon={Money}
                        iconTone="accent"
                        wrapActions
                        title={
                          <>
                            {t('ok.payment')} · {r.customerName}
                          </>
                        }
                        sub={
                          <>
                            <bdi>{r.orderNumber}</bdi> · {r.agentName} · <bdi>{money(r.totalCents)}</bdi>
                          </>
                        }
                        actions={
                          <Link href={`/sales/${r.orderId}?confirm=1`} className="an-btn primary sm">
                            {t('ok.confirmPayment')}
                          </Link>
                        }
                      />
                    ) : (
                      <ListRow
                        key={r.id}
                        icon={r.kind === 'new_customer' ? UserPlus : r.kind === 'special_price' ? Tag : NotePencil}
                        iconTone="accent"
                        wrapActions
                        title={
                          <>
                            {t(`ok.${r.kind}`)} · {r.customerName}
                          </>
                        }
                        sub={
                          <>
                            {r.agentName}
                            {r.orderNumber && (
                              <>
                                {' · '}
                                <bdi>{r.orderNumber}</bdi>
                              </>
                            )}
                            {r.reason && ` · ${r.reason}`}
                          </>
                        }
                        actions={
                          <>
                            <Button size="sm" onClick={() => setReview(r.id)}>
                              {tc('review')}
                            </Button>
                            <Button size="sm" variant="primary" icon={Check} busy={approve.isPending && approve.variables === r.id} onClick={() => approve.mutate(r.id)}>
                              {tc('approve')}
                            </Button>
                          </>
                        }
                      />
                    ),
                  )}
                </div>
              )}
              {approve.errorText && <p className="an-help error">{approve.errorText}</p>}
            </Card>
          )}

          {d.stock && (
            <Card title={t('stock.title')} action={canView('inventory') ? <Link href="/inventory" className="an-btn secondary sm">{tc('showAll')}</Link> : undefined}>
              <div className="stock-grid">
                {d.stock.map((s) => (
                  <StockBars
                    key={s.flavour}
                    flavour={s.flavour}
                    value={s.available}
                    max={maxStock}
                    badge={s.status !== 'ok' ? <Pill tone={s.status === 'reorder_now' ? 'bad' : 'warn'}>{t('stock.reorder')}</Pill> : undefined}
                    detail={
                      <>
                        <span>{t('stock.reserved', { n: num(s.reserved) })}</span>
                        <span>{t('stock.inTransit', { n: num(s.onTheWay) })}</span>
                      </>
                    }
                  />
                ))}
              </div>
              <p className="caption muted">{t('stock.caption')}</p>
            </Card>
          )}
        </div>

        <Card title={<span className="row">{t('attention.title')} {d.attention.length > 0 && <Count n={d.attention.length} tone="r" />}</span>}>
          {d.attention.length === 0 ? (
            <EmptyState done title={t('attention.emptyTitle')} text={t('attention.emptyText')} />
          ) : (
            <div className="lrows">
              {d.attention.map((a) => {
                const issueN = a.action?.startsWith('issue_all:') ? Number(a.action.split(':')[1]) : 0;
                return (
                  <ListRow
                    key={a.kind}
                    icon={ATTENTION_ICON[a.kind as keyof typeof ATTENTION_ICON] ?? Info}
                    iconTone={a.kind === 'overdue' ? 'bad' : a.kind === 'reorder' || a.kind === 'late_purchases' ? 'warn' : undefined}
                    title={t(`attention.${a.kind}`, { n: a.count })}
                    sub={attentionSub(a)}
                    href={issueN ? undefined : a.link}
                    value={!issueN && a.cents ? money(a.cents, true) : undefined}
                    wrapActions={!!issueN}
                    actions={
                      issueN ? (
                        <>
                          <Link href={a.link} className="an-btn secondary sm">
                            {tc('view')}
                          </Link>
                          <Button size="sm" variant="primary" busy={issueAll.isPending} onClick={() => issueAll.mutate(undefined)}>
                            {t('attention.issueAll', { n: issueN })}
                          </Button>
                        </>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          )}
          {issueAll.errorText && <p className="an-help error">{issueAll.errorText}</p>}
        </Card>
      </div>

      <Sheet open={whatToDo} onClose={() => setWhatToDo(false)} title={t('whatToDo.title')} footer={<Button onClick={() => setWhatToDo(false)}>{tc('close')}</Button>}>
        <p>{t('whatToDo.explain', { amount: money(d.tiles.salesMonth.cents), could: money(d.tiles.salesMonth.couldCloseCents), n: d.tiles.salesMonth.couldCloseCount })}</p>
        {d.whatToDo.length === 0 ? (
          <EmptyState done title={t('whatToDo.emptyTitle')} />
        ) : (
          <div className="lrows">
            {d.whatToDo.map((s) => (
              <ListRow
                key={s.kind + s.id}
                icon={s.kind === 'approve_customer' ? UserPlus : NotePencil}
                iconTone="accent"
                title={t(`whatToDo.${s.kind}`, { agent: s.agentName ?? '' })}
                sub={s.label}
                value={s.cents ? money(s.cents, true) : undefined}
                onClick={() => {
                  setWhatToDo(false);
                  router.push(s.link);
                }}
              />
            ))}
          </div>
        )}
      </Sheet>
      <ReviewPanel id={review} onClose={() => setReview(null)} />
    </div>
  );

  function attentionSub(a: HomeData['attention'][number]) {
    switch (a.kind) {
      case 'overdue':
        return t('attention.oldest', { n: a.oldestDays ?? 0 });
      case 'late_purchases':
        return t('attention.oldestLate', { n: a.oldestDays ?? 0 });
      case 'reorder':
        return a.detail?.split(',').map((f) => f.toUpperCase()).join(', ');
      case 'bank_balance':
        return a.detail ? t('attention.lastBalance', { date: date(a.detail) }) : t('attention.noBalance');
      default:
        return t(`attention.${a.kind}Sub`);
    }
  }
}
