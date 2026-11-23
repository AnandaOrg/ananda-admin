'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { isoDate, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, EmptyState, ErrorState, FlavourStock as StockCard, Icon, KpiTile, List, Package, PageHeader, PageSkeleton, Pill, ShoppingCart, SlidersHorizontal } from '@/components/ui';
import { AllocateButton, AllocateSheet } from './_components/AllocateSheet';
import { AdjustSheet } from './_components/AdjustSheet';
import type { FlavourStock, InventoryOverview } from './_components/types';
import css from './inventory.module.css';

/** Inventory (PRD §5.6): four totals, one card per flavour that says how long it lasts, Allocate and Stock adjustment. */
export default function InventoryPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { canEdit, readOnly } = useSession();
  const { money, num, unit, dateShort } = useFmt();
  const editable = canEdit('inventory') && !readOnly;
  const canOrder = canEdit('purchasing') && !readOnly;
  const [allocating, setAllocating] = useState(params.get('allocate') === '1');
  const [adjusting, setAdjusting] = useState(false);
  const q = useQuery({ queryKey: ['inventory', 'overview'], queryFn: () => api.get<InventoryOverview>('/inventory') });
  const cardsRef = useStackedHeads(!!q.data);

  // Stock movements and stock counts have their own pages; old links with ?tab= still land there.
  const tab = params.get('tab');
  useEffect(() => {
    if (tab === 'movements' || tab === 'counts') router.replace(`/inventory/${tab}`);
  }, [tab, router]);

  const closeAllocate = () => {
    setAllocating(false);
    if (params.get('allocate')) router.replace('/inventory', { scroll: false });
  };

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const next = d.nextPurchase;
  const empty = d.totals.inStock === 0 && d.totals.onTheWay === 0 && d.totals.reserved === 0;
  const now = d.flavours.filter((f) => f.runway.status === 'reorder_now').length;
  const soon = d.flavours.filter((f) => f.runway.status === 'reorder_soon').length;

  const kicker = empty ? (
    t('kickerEmpty')
  ) : (
    <>
      {t('kicker.flavours', { n: d.flavours.length })}
      {' · '}
      {now > 0 && <span className="bad">{t('kicker.now', { n: now })}</span>}
      {now > 0 && soon > 0 && ' · '}
      {soon > 0 && <span className="warn-dot">{t('kicker.soon', { n: soon })}</span>}
      {now + soon === 0 && t('kicker.none')}
      {' · '}
      {t('kicker.warehouses', { n: 1 })}
    </>
  );

  const allocate = editable && d.waiting.orders > 0 ? <AllocateButton waiting={d.waiting} next={next} onOpen={() => setAllocating(true)} /> : null;

  const onTheWayTile = (
    <KpiTile
      label={t('tiles.onTheWay')}
      value={empty ? '0' : next && next.daysLate > 0 ? <span className="warn">{num(d.totals.onTheWay)}</span> : num(d.totals.onTheWay)}
      sub={empty ? undefined : next ? (next.daysLate > 0 ? t('tiles.onTheWayLate', { number: next.number }) : t('tiles.onTheWayNext', { number: next.number, date: dateShort(next.expectedOn) })) : t('tiles.nothingOnTheWay')}
      onClick={next ? () => router.push(`/purchasing/${next.id}`) : undefined}
      chevron={!!next}
    />
  );

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.inventory') }]}
        kicker={kicker}
        title={tc('nav.inventory')}
        actions={
          empty ? undefined : (
            <span className="row wrap only-wide">
              {allocate}
              {editable && (
                <Button size="sm" icon={SlidersHorizontal} onClick={() => setAdjusting(true)}>
                  {t('adjust.title')}
                </Button>
              )}
              <Button size="sm" icon={List} onClick={() => router.push('/inventory/movements')}>
                {t('movements.title')}
              </Button>
            </span>
          )
        }
      />

      <div className="kpis">
        <KpiTile label={t('tiles.available')} value={num(d.totals.available)} sub={empty ? undefined : t('tiles.availableSub')} />
        <KpiTile label={t('tiles.reserved')} value={num(d.totals.reserved)} sub={empty ? undefined : t('tiles.reservedSub')} />
        {onTheWayTile}
        <KpiTile label={t('tiles.value')} value={money(d.totals.stockValueCents, true)} sub={empty ? undefined : t('tiles.valueSub', { amount: unit(d.totals.avgLandedCostCents) })} />
      </div>

      {empty ? (
        <Card>
          <EmptyState
            icon={Package}
            title={t('empty.title')}
            text={t('empty.text')}
            action={
              <Button variant="primary" icon={ShoppingCart} onClick={() => router.push('/purchasing')}>
                {t('empty.cta')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {allocate && <div className="only-phone stack">{allocate}</div>}
          <div className="overline only-phone">
            {now + soon > 0 && `${t('toReorder', { n: now + soon })} · `}
            {t('byFlavour')}
          </div>
          <div className={`kpis one-on-phone ${css.stretch} ${css.cards}`} ref={cardsRef}>
            {d.flavours.map((f) => (
              <FlavourCard key={f.flavour} f={f} counted={d.lastCount?.units[f.flavour] ?? null} countedOn={d.lastCount?.createdAt ?? null} onOrder={canOrder ? () => router.push(`/purchasing?new=1&flavour=${f.flavour}`) : undefined} />
            ))}
          </div>
          {d.lastCount ? (
            d.openCounts > 0 && (
              <div className={`row between ${css.strip}`}>
                <span className="caption muted">{t('counts.banner', { n: d.openCounts })}</span>
                <Button size="sm" onClick={() => router.push('/inventory/counts')}>
                  {t('counts.review')}
                </Button>
              </div>
            )
          ) : (
            <div className={`caption muted ${css.strip}`}>
              <span className="only-wide">{t('noCount')}</span>
              <span className="only-phone">{t('noCountPhone')}</span>
            </div>
          )}
          {editable && (
            <div className="only-phone stack">
              <Button icon={SlidersHorizontal} block onClick={() => setAdjusting(true)}>
                {t('adjust.title')}
              </Button>
            </div>
          )}
        </>
      )}

      {editable && <AllocateSheet open={allocating} onClose={closeAllocate} />}
      {editable && <AdjustSheet open={adjusting} onClose={() => setAdjusting(false)} />}
    </div>
  );
}

/** FR-INV-2: one card per flavour, leading with what is available to sell and how long it lasts. */
function FlavourCard({ f, counted, countedOn, onOrder }: { f: FlavourStock; counted: number | null; countedOn: string | null; onOrder?: () => void }) {
  const t = useTranslations('inventory');
  const { money, num, dateShort, date } = useFmt();
  const r = f.runway;
  const low = r.status !== 'ok';
  const tone = r.status === 'reorder_now' ? 'bad' : r.status === 'reorder_soon' ? 'warn' : '';
  const late = f.onTheWay > 0 && !!f.nextArrivalOn && f.nextArrivalOn < isoDate();
  const status =
    r.status === 'reorder_now' ? (
      <Pill tone="bad">{t('status.reorder_now')}</Pill>
    ) : r.status === 'reorder_soon' ? (
      <Pill tone="warn">{t('status.reorder_soon')}</Pill>
    ) : r.monthsLeft != null ? (
      <Pill tone="good">{t('status.months', { n: Math.max(1, Math.round(r.monthsLeft)) })}</Pill>
    ) : (
      <Pill tone="mute">{t('status.noSales')}</Pill>
    );
  const tint = r.status === 'reorder_now' ? css.cardBad : r.status === 'reorder_soon' ? css.cardWarn : '';
  const name = f.flavour.toUpperCase() as Uppercase<Flavour>;
  // Head (design): name and pill side by side; a low flavour adds a cart button at the end. When a pill doesn't
  // fit on any card, every card puts it under the name (useStackedHeads) so the four numbers stay aligned.
  const badge = (
    <>
      <span className={css.headBreak} aria-hidden />
      <span className={css.headPill}>{status}</span>
      {low && onOrder && (
        <button type="button" className={`an-iconbtn only-wide ${css.headOrder}`} onClick={onOrder} aria-label={t('card.orderMore', { flavour: name })} title={t('card.orderMore', { flavour: name })}>
          <Icon as={ShoppingCart} size="sm" />
        </button>
      )}
    </>
  );
  return (
    <section className={`an-card ${css.card} ${tint}`}>
      <StockCard
        flavour={f.flavour}
        value={f.available}
        max={Math.max(f.inStock, f.available)}
        badge={badge}
        detail={
          <>
            <span className="only-wide">{t('card.availableCaption')}</span>
            <span className="only-phone">{t('card.availablePhone')}</span>
          </>
        }
      />
      {low && onOrder && (
        <span className="only-phone">
          <Button size="sm" icon={ShoppingCart} onClick={onOrder}>
            {t('card.orderMore', { flavour: name })}
          </Button>
        </span>
      )}
      <hr className="divider only-phone" />
      <Rows
        lines={[
          [t('card.reserved'), num(f.reserved)],
          [t('card.inStock'), num(f.inStock)],
          [t('card.value'), money(f.stockValueCents)],
        ]}
      />
      <hr className="divider only-wide" />
      <Rows
        lines={[
          [
            t('card.onTheWay'),
            f.onTheWay > 0 ? (
              <>
                {num(f.onTheWay)} · <span className={late ? 'bad' : ''}>{ddmmyy(f.nextArrivalOn)}</span>
              </>
            ) : (
              t('card.none')
            ),
          ],
          [t('card.runsOut'), r.runsOutOn ? <span className={tone}>{date(r.runsOutOn)}</span> : t('card.noSales')],
          [t('card.soldPerDay'), num(r.soldPerDay, 1)],
          ...(counted != null ? ([[t('card.counted', { date: dateShort(countedOn) }), t('card.countedUnits', { n: num(counted) })]] as [ReactNode, ReactNode][]) : []),
        ]}
      />
      {r.status === 'reorder_now' && <span className="caption muted">{t('card.nowHint')}</span>}
    </section>
  );
}

/** The short numeric date of the card rows (design): "30.09.26" in every language. */
function ddmmyy(v: string | null | undefined) {
  if (!v) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[3]}.${m[2]}.${m[1].slice(2)}`;
  const d = new Date(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
}

/**
 * Flavour card heads (prototype ivhEq): with the pills inline, if any head wraps (a long Bulgarian pill, a
 * narrow card), every head stacks its pill under the name, so the four numbers stay on one line. Set as a
 * data attribute straight on the DOM (measured with it off), re-checked on every render and resize.
 */
function useStackedHeads(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    delete el.dataset.stack;
    const mid = (r: DOMRect) => (r.top + r.bottom) / 2;
    const wraps = [...el.querySelectorAll<HTMLElement>('.an-stock > .k')].some((k) => {
      const parts = [...k.children].filter((c) => (c as HTMLElement).offsetWidth > 0);
      if (!parts.length) return false;
      const m0 = mid(parts[0].getBoundingClientRect());
      return parts.some((c) => Math.abs(mid(c.getBoundingClientRect()) - m0) > 6);
    });
    if (wraps) el.dataset.stack = '';
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - last) > 0.5) {
        last = el.clientWidth;
        setTick((x) => x + 1);
      }
    });
    ro.observe(el);
    let live = true;
    // web fonts change every width once they arrive
    document.fonts?.ready.then(() => live && setTick((x) => x + 1)).catch(() => {});
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [ready]);
  void tick;
  return ref;
}

/** Label and figure rows inside a flavour card. */
function Rows({ lines }: { lines: [ReactNode, ReactNode][] }) {
  return (
    <div className={css.lines}>
      {lines.map(([k, v], i) => (
        <div key={i} className={`row between body ${css.line}`}>
          <span className="muted">{k}</span>
          <bdi>{v}</bdi>
        </div>
      ))}
    </div>
  );
}
