'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FLAVOURS, ORDER_STATUS_TONE, UNITS_PER_CARTON, type CartonsByFlavour, type Flavour, type OrderStatus } from '@ananda/shared';
import { useFmt } from '@/lib/format';
import { Pill, Stepper } from './controls';

export const FLAVOUR_VAR: Record<Flavour, string> = {
  aloha: 'var(--flavour-aloha)',
  gaia: 'var(--flavour-gaia)',
  santorini: 'var(--flavour-santorini)',
  kyoto: 'var(--flavour-kyoto)',
};

/** Flavour name next to its colour; the colour never stands alone. */
export function FlavourName({ flavour }: { flavour: Flavour }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <i className="flav-dot" style={{ background: FLAVOUR_VAR[flavour] }} aria-hidden />
      <span className="flav-name">{flavour.toUpperCase()}</span>
    </span>
  );
}

/** Stock bars (Home, Inventory): the bars fill in the flavour colour up to the level. */
export function StockBars({ flavour, value, max, detail, badge }: { flavour: Flavour; value: number; max: number; detail?: React.ReactNode; badge?: React.ReactNode }) {
  const { num } = useFmt();
  // Bars keep 3 px width and gap; narrow columns show fewer bars so the level stays the same.
  const barsRef = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState(40);
  useEffect(() => {
    const el = barsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBars(Math.max(8, Math.min(40, Math.floor((e.contentRect.width + 3) / 6)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const filled = max > 0 ? Math.round((Math.max(0, value) / max) * bars) : 0;
  return (
    <div className="an-stock">
      <div className="k">
        <i style={{ background: FLAVOUR_VAR[flavour] }} />
        {flavour.toUpperCase()}
        {badge}
      </div>
      <div className="n">
        <bdi>{num(value)}</bdi>
      </div>
      <div className="an-bars" aria-hidden ref={barsRef}>
        {Array.from({ length: bars }, (_, i) => (
          <i key={i} style={{ background: i < filled ? FLAVOUR_VAR[flavour] : undefined }} />
        ))}
      </div>
      {detail && <div className="s">{detail}</div>}
    </div>
  );
}

/** Carton entry per flavour, always in the order Aloha, Gaia, Santorini, Kyoto. */
export function CartonsEditor({ value, onChange, max, only }: { value: CartonsByFlavour; onChange: (v: CartonsByFlavour) => void; max?: CartonsByFlavour; only?: Flavour[] }) {
  const t = useTranslations('common');
  const { num } = useFmt();
  const list = only ?? [...FLAVOURS];
  return (
    <div className="stack tight">
      {list.map((f) => {
        const c = value[f] ?? 0;
        return (
          <div key={f} className="an-flav">
            <i className="dot" style={{ background: FLAVOUR_VAR[f] }} aria-hidden />
            <span className="nm">{f.toUpperCase()}</span>
            <Stepper value={c} onChange={(n) => onChange({ ...value, [f]: n })} max={max?.[f]} label={t('cartonsOf', { flavour: f.toUpperCase() })} />
            <span className="u">
              {t('unitsCount', { n: num(c * UNITS_PER_CARTON) })}
              {max?.[f] != null && ` · ${t('upTo', { n: max[f]! })}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Read-only flavour rows with the quantity at the end. */
export function FlavourRows({ cartons, unitsLabel = true }: { cartons: CartonsByFlavour; unitsLabel?: boolean }) {
  const t = useTranslations('common');
  const { num } = useFmt();
  return (
    <div className="stack tight">
      {FLAVOURS.filter((f) => (cartons[f] ?? 0) > 0).map((f) => (
        <div key={f} className="an-flav">
          <i className="dot" style={{ background: FLAVOUR_VAR[f] }} aria-hidden />
          <span className="nm">{f.toUpperCase()}</span>
          <span className="q">
            <bdi>{num(cartons[f] ?? 0)}</bdi>
          </span>
          {unitsLabel && <span className="u">{t('cartonsUnits', { c: num(cartons[f] ?? 0), u: num((cartons[f] ?? 0) * UNITS_PER_CARTON) })}</span>}
        </div>
      ))}
    </div>
  );
}

/** One plain status per order (PRD §1.2), with the "N days late" overlay. */
export function OrderStatusPill({ status, daysLate }: { status: OrderStatus; daysLate?: number }) {
  const t = useTranslations('common');
  return (
    <span className="row status-pills" style={{ gap: 6 }}>
      <Pill tone={ORDER_STATUS_TONE[status]}>{t(`orderStatus.${status}`)}</Pill>
      {!!daysLate && daysLate > 0 && <Pill tone="bad">{t('daysLate', { n: daysLate })}</Pill>}
    </span>
  );
}
