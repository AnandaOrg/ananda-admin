'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatDate, type Locale } from '@ananda/shared';
import { CaretLeft, CaretRight, Icon, Info, X } from '../ui/icon';

/* "As of" calendar: quick picks (today, end of last month / quarter / year) and a month grid.
   Days after today can't be picked: there are no figures yet. */

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const WD: Record<string, string[]> = {
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  bg: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'],
  he: ['ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳', 'א׳'],
};

export function quickPicks(today: string) {
  const t = parse(today);
  const endLastMonth = new Date(t.getFullYear(), t.getMonth(), 0);
  const q = Math.floor(t.getMonth() / 3);
  const endLastQuarter = new Date(t.getFullYear(), q * 3, 0);
  const endLastYear = new Date(t.getFullYear(), 0, 0);
  return [
    { key: 'quickToday', day: today },
    { key: 'endMonth', day: ymd(endLastMonth) },
    { key: 'endQuarter', day: ymd(endLastQuarter) },
    { key: 'endYear', day: ymd(endLastYear) },
  ] as const;
}

export function CalendarBody({ day, today, locale, onPick, phone, onClose }: { day: string; today: string; locale: Locale; onPick: (d: string) => void; phone?: boolean; onClose?: () => void }) {
  const t = useTranslations('common');
  const cur = parse(day);
  const [month, setMonth] = useState<[number, number]>([cur.getFullYear(), cur.getMonth()]);
  const [cy, cm] = month;
  const tday = parse(today);
  const atMax = cy > tday.getFullYear() || (cy === tday.getFullYear() && cm >= tday.getMonth());
  const first = new Date(cy, cm, 1);
  const dow = (first.getDay() + 6) % 7;
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(cy, cm, 1 - dow + i);
    if (i === 35 && d.getMonth() !== cm) break;
    cells.push(d);
  }
  const step = (n: number) => {
    const x = cy * 12 + cm + n;
    setMonth([Math.floor(x / 12), x % 12]);
  };
  const title = `${new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : locale === 'he' ? 'he-IL' : 'en-GB', { month: 'long' }).format(first)} ${cy}`;
  const monthHead = (
    <div className="cal-mon">
      <div className="cal-mh">
        <button type="button" className="cal-ib" aria-label={t('lookBack.prevMonth')} onClick={() => step(-1)}>
          <Icon as={CaretLeft} size="sm" />
        </button>
        <b>{title}</b>
        <button type="button" className="cal-ib" aria-label={t('lookBack.nextMonth')} onClick={() => step(1)} disabled={atMax}>
          <Icon as={CaretRight} size="sm" />
        </button>
      </div>
      <div className="cal-grid" role="grid">
        {(WD[locale] ?? WD.en).map((w) => (
          <span key={w} className="wd">
            {w}
          </span>
        ))}
        {cells.map((d) => {
          const k = ymd(d);
          const fut = k > today;
          return (
            <button
              key={k}
              type="button"
              className={`cal-d ${d.getMonth() !== cm ? 'out' : ''} ${k === today ? 'today' : ''} ${k === day ? 'sel' : ''}`}
              disabled={fut}
              aria-label={formatDate(d, locale)}
              aria-pressed={k === day}
              onClick={() => onPick(k)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
  const picks = quickPicks(today);
  if (phone)
    return (
      <>
        <span className="an-grab" />
        <div className="nt-h">
          <b>{t('lookBack.title')}</b>
          <button type="button" className="cal-ib big" aria-label={t('close')} onClick={onClose}>
            <Icon as={X} />
          </button>
        </div>
        <div>
          <div className="cal-qrow">
            {picks.map((p) => (
              <button key={p.key} type="button" className="an-tabx" aria-pressed={p.day === day} onClick={() => onPick(p.day)}>
                {t(`lookBack.${p.key}`)}
              </button>
            ))}
          </div>
          {monthHead}
        </div>
        <div className="cal-f">
          <Icon as={Info} size="sm" />
          <span>{t('lookBack.footPhone')}</span>
        </div>
      </>
    );
  return (
    <>
      <div className="cal-ql">
        <span className="cal-lab">{t('lookBack.title')}</span>
        {picks.map((p) => (
          <button key={p.key} type="button" className={`cal-q ${p.day === day ? 'on' : ''}`} onClick={() => onPick(p.day)}>
            <b>{t(`lookBack.${p.key}`)}</b>
            <small>{formatDate(p.day, locale)}</small>
          </button>
        ))}
      </div>
      {monthHead}
      <div className="cal-f">
        <Icon as={Info} size="sm" />
        <span>{t('lookBack.footDesk')}</span>
      </div>
    </>
  );
}
