'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatDay } from '@/lib/format';
import { useAsOf } from '@/lib/asof';
import { Card, LoadingLive, PageHeader, Sk } from '@/components/ui';
import s from './home.module.css';

/** Bar widths that vary row to row, so the skeleton reads like real rows. */
const W = [0.9, 0.7, 0.82, 0.6, 0.86];

/**
 * Overview while it loads: the real header, then the page's own shape (four tiles, Needs your OK,
 * Needs attention, stock) at the same sizes, so nothing jumps when the figures arrive.
 */
export function HomeSkeleton({ phone }: { phone: boolean }) {
  const t = useTranslations('home');
  const locale = useLocale();
  const { day } = useAsOf();
  const header = <PageHeader kicker={formatDay(day, locale)} title={t('title')} actions={phone ? undefined : <Sk w={300} h={36} pill />} />;

  if (phone) {
    return (
      <div className="page" aria-busy>
        <LoadingLive />
        {header}
        <div className={s.ppulse}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={s.pbox} aria-hidden>
              <Sk w="60%" />
              <Sk w="75%" h={28} className="sk-gap" />
              <Sk w="50%" h={10} className="sk-gap" />
            </div>
          ))}
        </div>
        <Sk w={140} h={12} className="sk-gap" />
        {W.slice(0, 3).map((k, i) => (
          <div key={i} className={s.ar} aria-hidden>
            <div className="grow">
              <Sk w={`${Math.round(50 * k)}%`} h={16} />
              <br />
              <Sk w={`${Math.round(90 * k)}%`} h={12} className="sk-gap" />
            </div>
            <Sk w="100%" h={40} pill />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`page ${s.fit}`} aria-busy>
      <LoadingLive />
      {header}
      <div className="kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="an-kpi" aria-hidden>
            <Sk w="50%" />
            <Sk w="70%" h={28} className="sk-gap" />
            <Sk w="40%" h={10} className="sk-gap" />
          </div>
        ))}
      </div>
      <div className={s.homeg}>
        <Card title={<Sk w={130} h={18} />} action={<Sk w={86} h={30} pill />}>
          <div className={s.scrl} aria-hidden>
            {W.slice(0, 4).map((k, i) => (
              <div key={i} className={s.ar}>
                <Sk w={40} h={40} />
                <div>
                  <Sk w={`${Math.round(55 * k)}%`} h={14} />
                  <br />
                  <Sk w={`${Math.round(85 * k)}%`} h={10} className="sk-gap" />
                </div>
                <span className={s.acts}>
                  <Sk w={72} h={32} pill />
                  <Sk w={84} h={32} pill />
                </span>
              </div>
            ))}
          </div>
        </Card>
        <Card title={<Sk w={150} h={18} />} action={<Sk w={86} h={30} pill />}>
          <div className={`${s.scrl} ${s.att}`} aria-hidden>
            {W.map((k, i) => (
              <div key={i} className="an-lrow">
                <Sk w={36} h={36} />
                <span>
                  <Sk w={`${Math.round(70 * k)}%`} h={12} />
                  <br />
                  <Sk w={`${Math.round(50 * k)}%`} h={10} className="sk-gap" />
                </span>
                <Sk w={36} h={12} />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className={s.scard} style={{ pointerEvents: 'none' }} aria-hidden>
        <span className={s.scardH}>
          <Sk w={200} h={18} />
        </span>
        <span className="stock-grid">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="stack tight">
              <Sk w={70} h={12} />
              <Sk w={96} h={34} />
              <Sk w="80%" h={30} />
              <Sk w="70%" h={10} />
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
