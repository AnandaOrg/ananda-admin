'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { UNITS_PER_CARTON, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Banner, Button, Card, ErrorState, KeyValue, KpiTile, PageHeader, PageSkeleton, Pill, Plus, Segmented, SlidersHorizontal, StockBars } from '@/components/ui';
import { AllocateSheet } from './_components/AllocateSheet';
import { AdjustSheet } from './_components/AdjustSheet';
import { Movements } from './_components/Movements';
import { Counts } from './_components/Counts';
import type { FlavourStock, InventoryOverview } from './_components/types';

type Tab = 'stock' | 'movements' | 'counts';

/** Inventory (PRD §5.6): tiles, one card per flavour, Allocate, adjustments, movements, counts. */
export default function InventoryPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { canEdit, readOnly } = useSession();
  const { money, num } = useFmt();
  const editable = canEdit('inventory') && !readOnly;
  const initialTab = params.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(initialTab && ['stock', 'movements', 'counts'].includes(initialTab) ? initialTab : 'stock');
  const [allocating, setAllocating] = useState(params.get('allocate') === '1');
  const [adjusting, setAdjusting] = useState<{ flavour?: Flavour } | null>(null);
  const q = useQuery({ queryKey: ['inventory', 'overview'], queryFn: () => api.get<InventoryOverview>('/inventory') });

  const go = (next: Tab) => {
    setTab(next);
    router.replace(next === 'stock' ? '/inventory' : `/inventory?tab=${next}`, { scroll: false });
  };
  const closeAllocate = () => {
    setAllocating(false);
    if (params.get('allocate')) router.replace(tab === 'stock' ? '/inventory' : `/inventory?tab=${tab}`, { scroll: false });
  };

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const max = Math.max(1, ...d.flavours.map((f) => f.inStock + f.onTheWay));

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.inventory') }]}
        kicker={t('kicker', { n: num(d.totals.inStock), c: num(Math.floor(d.totals.inStock / UNITS_PER_CARTON)) })}
        title={tc('nav.inventory')}
        actions={
          editable ? (
            <>
              <Button size="sm" icon={SlidersHorizontal} onClick={() => setAdjusting({})}>
                {t('adjust.title')}
              </Button>
              {d.waiting.orders > 0 && (
                <Button size="sm" variant={d.waiting.canAllocate ? 'primary' : 'secondary'} onClick={() => setAllocating(true)}>
                  {t('allocate.title')}
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <Segmented
        label={t('tabs.label')}
        value={tab}
        onChange={go}
        options={[
          { value: 'stock', label: t('tabs.stock') },
          { value: 'movements', label: t('tabs.movements') },
          { value: 'counts', label: d.openCounts ? t('tabs.countsOpen', { n: d.openCounts }) : t('tabs.counts') },
        ]}
      />

      {tab === 'stock' && (
        <>
          <div className="kpis">
            <KpiTile label={t('tiles.available')} value={num(d.totals.available)} sub={t('tiles.cartons', { n: num(Math.floor(d.totals.available / UNITS_PER_CARTON)) })} />
            <KpiTile label={t('tiles.reserved')} value={num(d.totals.reserved)} sub={t('tiles.reservedSub')} />
            <KpiTile label={t('tiles.onTheWay')} value={num(d.totals.onTheWay)} sub={t('tiles.cartons', { n: num(Math.floor(d.totals.onTheWay / UNITS_PER_CARTON)) })} link={{ href: '/purchasing?filter=open', label: tc('nav.purchasing') }} />
            <KpiTile label={t('tiles.value')} value={money(d.totals.stockValueCents, true)} sub={t('tiles.valueSub')} />
          </div>
          {d.waiting.orders > 0 && (
            <Banner tone={d.waiting.canAllocate ? 'info' : 'bad'} action={editable ? { label: t('allocate.title'), onClick: () => setAllocating(true) } : undefined} sub={d.waiting.canAllocate ? t('waiting.canAllocate') : t('waiting.notYet')}>
              {t('waiting.title', { n: d.waiting.orders })}
            </Banner>
          )}
          {d.openCounts > 0 && (
            <Banner action={{ label: t('counts.review'), onClick: () => go('counts') }}>{t('counts.banner', { n: d.openCounts })}</Banner>
          )}
          <div className="cols even">
            {d.flavours.map((f) => (
              <FlavourCard key={f.flavour} f={f} max={max} onAdjust={editable ? () => setAdjusting({ flavour: f.flavour }) : undefined} canOrder={canEdit('purchasing') && !readOnly} />
            ))}
          </div>
          <p className="caption muted">{t('caption', { days: 60 })}</p>
        </>
      )}
      {tab === 'movements' && <Movements />}
      {tab === 'counts' && <Counts editable={editable} />}

      {editable && <AllocateSheet open={allocating} onClose={closeAllocate} />}
      {editable && <AdjustSheet open={!!adjusting} flavour={adjusting?.flavour} stock={d.flavours} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

/** FR-INV-2: one card per flavour. */
function FlavourCard({ f, max, onAdjust, canOrder }: { f: FlavourStock; max: number; onAdjust?: () => void; canOrder: boolean }) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const { money, num, date, unit } = useFmt();
  const r = f.runway;
  const status =
    r.status === 'reorder_now' ? (
      <Pill tone="bad">{t('status.reorder_now')}</Pill>
    ) : r.status === 'reorder_soon' ? (
      <Pill tone="warn">{t('status.reorder_soon')}</Pill>
    ) : r.monthsLeft != null ? (
      <Pill tone="good">{t('status.months', { n: num(r.monthsLeft, 1) })}</Pill>
    ) : (
      <Pill tone="mute">{t('status.noSales')}</Pill>
    );
  return (
    <Card>
      <StockBars
        flavour={f.flavour}
        value={f.available}
        max={max}
        badge={<span style={{ marginInlineStart: 'auto' }}>{status}</span>}
        detail={<span>{t('card.availableCaption')}</span>}
      />
      <KeyValue
        items={[
          [t('card.reserved'), num(f.reserved)],
          [t('card.inStock'), tc('cartonsUnits', { c: num(Math.floor(f.inStock / UNITS_PER_CARTON)), u: num(f.inStock) })],
          [t('card.value'), <bdi key="v">{money(f.stockValueCents, true)}{f.avgLandedCostCents > 0 && <span className="muted"> · {t('card.perUnit', { amount: unit(f.avgLandedCostCents, 4) })}</span>}</bdi>],
          [t('card.onTheWay'), f.onTheWay > 0 ? t('card.onTheWayValue', { n: num(f.onTheWay), date: date(f.nextArrivalOn) }) : <span className="muted" key="n">{tc('none')}</span>],
          [t('card.runsOut'), r.runsOutOn ? date(r.runsOutOn) : <span className="muted" key="r">{t('card.noSales')}</span>],
          [t('card.soldPerDay'), t('card.soldPerDayValue', { n: num(r.soldPerDay, 1) })],
          [t('card.leadTime'), t('card.days', { n: f.leadTimeDays })],
        ]}
      />
      {(onAdjust || (canOrder && r.status !== 'ok')) && (
        <div className="row wrap">
          {canOrder && r.status !== 'ok' && (
            <Link href={`/purchasing?new=1&flavour=${f.flavour}`} className={`an-btn sm ${r.status === 'reorder_now' ? 'primary' : 'secondary'}`}>
              <Plus className="an-ic sm" aria-hidden />
              {t('card.reorder')}
            </Link>
          )}
          {onAdjust && (
            <Button size="sm" onClick={onAdjust}>
              {t('card.adjust')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
