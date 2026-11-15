'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatDateShort, isoDate } from '@ananda/shared';
import { useAsOf } from '@/lib/asof';
import { Button, CalendarBlank, CaretDown, CaretLeft, CaretRight, Icon } from '@/components/ui';
import css from '../money.module.css';

/* ---------- dates (calendar days as YYYY-MM-DD, months as a running index y * 12 + m) ---------- */

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const parse = (v: string) => {
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const iso = (d: Date) => isoDate(d);
const monthIndex = (v: string) => {
  const [y, m] = v.split('-').map(Number);
  return y * 12 + (m - 1);
};
const monthStart = (i: number) => `${Math.floor(i / 12)}-${pad((i % 12) + 1)}-01`;
const monthEnd = (i: number) => iso(new Date(Math.floor(i / 12), (i % 12) + 1, 0));
const minIso = (a: string, b: string) => (a < b ? a : b);

export type DayPreset = 'today' | 'this_week' | 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'custom';
export type MonthPreset = 'this_month' | 'this_year' | 'last_12_months' | 'last_year' | 'custom';

/** A chosen range of calendar days, both ends included. */
export interface DayRange<P extends string = DayPreset> {
  preset: P;
  from: string;
  to: string;
}

export function dayPreset(p: Exclude<DayPreset, 'custom'>, now = new Date()): DayRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  const t = iso(now);
  switch (p) {
    case 'today':
      return { preset: p, from: t, to: t };
    case 'this_week': {
      const back = (now.getDay() + 6) % 7;
      return { preset: p, from: iso(new Date(y, m, now.getDate() - back)), to: t };
    }
    case 'this_month':
      return { preset: p, from: iso(new Date(y, m, 1)), to: t };
    case 'last_month':
      return { preset: p, from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'last_year':
      return { preset: p, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'this_year':
    default:
      return { preset: 'this_year', from: `${y}-01-01`, to: t };
  }
}

export function monthPreset(p: Exclude<MonthPreset, 'custom'>, now = new Date()): DayRange<MonthPreset> {
  const cur = now.getFullYear() * 12 + now.getMonth();
  const t = iso(now);
  switch (p) {
    case 'this_month':
      return { preset: p, from: monthStart(cur), to: t };
    case 'last_12_months':
      return { preset: p, from: monthStart(cur - 11), to: t };
    case 'last_year':
      return { preset: p, from: monthStart(cur - cur % 12 - 12), to: monthEnd(cur - cur % 12 - 1) };
    case 'this_year':
    default:
      return { preset: 'this_year', from: monthStart(cur - (cur % 12)), to: t };
  }
}

/** API query for a range: always explicit dates. */
export function rangeQuery(r: { from: string; to: string }) {
  return { period: 'custom', from: r.from, to: r.to };
}

/** The same dates one year earlier. */
export function yearBefore(r: { from: string; to: string }) {
  const back = (v: string) => {
    const d = parse(v);
    return iso(new Date(d.getFullYear() - 1, d.getMonth(), d.getDate()));
  };
  return { from: back(r.from), to: back(r.to) };
}


/** Day of the figures: today, or the "As of" day when looking back. */
function useDay() {
  return useAsOf().day;
}

/**
 * Range state for a page. Presets follow the "As of" day (This year ends on that day); a custom
 * range stays as picked. `initial` may be a custom range (e.g. from the URL).
 */
export function useDayRange<P extends string>(make: (p: Exclude<P, 'custom'>, now: Date) => DayRange<P>, initial: P | DayRange<P>): [DayRange<P>, (r: DayRange<P>) => void] {
  const day = useDay();
  const [chosen, setChosen] = useState<DayRange<P> | P>(initial);
  const range = typeof chosen === 'string' ? make(chosen as Exclude<P, 'custom'>, parse(day)) : chosen.preset === 'custom' ? chosen : make(chosen.preset as Exclude<P, 'custom'>, parse(day));
  const set = useCallback((r: DayRange<P>) => setChosen(r.preset === 'custom' ? r : r.preset), []);
  return [range, set];
}

/* ---------- labels ---------- */

function dayMonth(d: Date, locale: string) {
  if (locale === 'he') return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' }).format(d);
  return `${d.getDate()} ${MONTHS_EN[d.getMonth()]}`;
}

function fullDay(d: Date, locale: string) {
  // Compact control: BG is DD.MM.YY (design system); other languages keep day, month, year.
  return locale === 'bg' ? formatDateShort(d, 'bg') : `${dayMonth(d, locale)} ${d.getFullYear()}`;
}

/** Short month name: "Nov" · "ноем." · "נוב׳". */
const MONTHS_BG = ['ян.', 'февр.', 'март', 'апр.', 'май', 'юни', 'юли', 'авг.', 'септ.', 'окт.', 'ноем.', 'дек.'];
const MONTHS_HE = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const WEEKDAYS: Record<string, string[]> = {
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  bg: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'],
  he: ['ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳', 'א׳'],
};

export function monthShort(i: number, locale: string) {
  return (locale === 'bg' ? MONTHS_BG : locale === 'he' ? MONTHS_HE : MONTHS_EN)[i % 12];
}

/** "Nov 2026" from a date or month index. */
export function monthName(v: string | number, locale: string) {
  const i = typeof v === 'number' ? v : monthIndex(v);
  return `${monthShort(i, locale)} ${Math.floor(i / 12)}`;
}

/** "1 Jan – 14 Nov 2026" · "01.01.26 – 14.11.26" · "14 Nov 2026" for one day. */
export function dayRangeLabel(from: string, to: string, locale: string) {
  const a = parse(from);
  const b = parse(to);
  if (from === to) return fullDay(a, locale);
  const sep = ' – ';
  if (locale === 'bg') return formatDateShort(a, 'bg') + sep + formatDateShort(b, 'bg');
  if (a.getFullYear() !== b.getFullYear()) return fullDay(a, locale) + sep + fullDay(b, locale);
  if (locale === 'en' && a.getMonth() === b.getMonth()) return `${a.getDate()}${sep}${fullDay(b, locale)}`;
  return dayMonth(a, locale) + sep + fullDay(b, locale);
}

/** "Jan – Nov 2026" · "Nov 2026" · "Dec 2025 – Nov 2026". */
export function monthRangeLabel(from: string, to: string, locale: string) {
  const a = monthIndex(from);
  const b = monthIndex(to);
  if (a === b) return monthName(a, locale);
  if (Math.floor(a / 12) === Math.floor(b / 12)) return `${monthShort(a, locale)} – ${monthName(b, locale)}`;
  return `${monthName(a, locale)} – ${monthName(b, locale)}`;
}

/* ---------- popover shell ---------- */

function usePopover() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, wrap, btn };
}

function Trigger({ label, open, onClick, btnRef, aria }: { label: string; open: boolean; onClick: () => void; btnRef: React.Ref<HTMLButtonElement>; aria: string }) {
  return (
    <button ref={btnRef} type="button" className={`an-sel ${open ? css.selOpen : ''}`} aria-expanded={open} aria-haspopup="dialog" aria-label={`${aria}: ${label}`} onClick={onClick}>
      <Icon as={CalendarBlank} size="sm" />
      <bdi>{label}</bdi>
      <Icon as={CaretDown} size="sm" />
    </button>
  );
}

function PresetChips<P extends string>({ items, current, onPick }: { items: { value: P; label: string }[]; current: P; onPick: (p: P) => void }) {
  return (
    <div className={css.calChips}>
      {items.map((p) => (
        <button key={p.value} type="button" className="an-chip" aria-pressed={current === p.value} onClick={() => onPick(p.value)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- day-range calendar (Deal profit, Audit log) ---------- */

/**
 * Header date-range picker: presets, a month of days, pick a first and a last day, Apply.
 * Future days can't be picked. `value.preset` is 'custom' after Apply.
 */
export function DayRangeCalendar({ value, onChange, presets = ['today', 'this_week', 'this_month', 'this_year', 'last_year'] }: { value: DayRange; onChange: (r: DayRange) => void; presets?: Exclude<DayPreset, 'custom'>[] }) {
  const t = useTranslations('money');
  const locale = useLocale();
  const { open, setOpen, wrap, btn } = usePopover();
  const today = useDay();
  const [a, setA] = useState(value.from);
  const [b, setB] = useState<string | null>(value.to);
  const [view, setView] = useState(monthIndex(value.to));
  const toggle = () => {
    if (!open) {
      setA(value.from);
      setB(value.to);
      setView(monthIndex(value.to));
    }
    setOpen(!open);
  };
  const lo = b == null ? a : minIso(a, b);
  const hi = b == null ? a : a > b ? a : b;
  const first = parse(monthStart(view));
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weekdays = WEEKDAYS[locale] ?? WEEKDAYS.en;
  const pick = (d: string) => {
    if (b != null) {
      setA(d);
      setB(null);
    } else setB(d);
  };
  const long = new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'he-IL', { month: 'long' }).format(first);
  const title = locale === 'en' ? monthName(view, locale) : `${long.charAt(0).toUpperCase()}${long.slice(1)} ${first.getFullYear()}`;
  return (
    <div className={css.calWrap} ref={wrap}>
      <Trigger label={dayRangeLabel(value.from, value.to, locale)} open={open} onClick={toggle} btnRef={btn} aria={t('cal.dates')} />
      {open && (
        <div className={`an-pop an-cal ${css.calPop}`} role="dialog" aria-label={t('cal.dates')}>
          <PresetChips
            items={presets.map((p) => ({ value: p, label: t(`period.${p}`) }))}
            current={value.preset as Exclude<DayPreset, 'custom'>}
            onPick={(p) => {
              onChange(dayPreset(p, parse(today)));
              setOpen(false);
            }}
          />
          <div className="an-cal-h">
            <button type="button" className="an-calnav" aria-label={t('cal.prevMonth')} onClick={() => setView(view - 1)}>
              <Icon as={CaretLeft} size="sm" className="flip" />
            </button>
            <b>{title}</b>
            <button type="button" className="an-calnav" aria-label={t('cal.nextMonth')} disabled={view >= monthIndex(today)} onClick={() => setView(view + 1)}>
              <Icon as={CaretRight} size="sm" className="flip" />
            </button>
          </div>
          <div className="an-days">
            {weekdays.map((w, i) => (
              <span key={i} className="dw">
                {w}
              </span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={`l${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const d = iso(new Date(first.getFullYear(), first.getMonth(), i + 1));
              const end = d === lo || d === hi;
              const inside = d >= lo && d <= hi;
              return (
                <button key={d} type="button" className={`${inside && !end ? 'in' : ''} ${end ? 'end' : ''} ${d === today && !end ? css.today : ''}`} disabled={d > today} aria-pressed={inside} onClick={() => pick(d)}>
                  {i + 1}
                </button>
              );
            })}
          </div>
          <span className={css.calHint}>{b == null ? t('cal.pickLastDay') : t('cal.fromTo', { from: fullDay(parse(lo), locale), to: fullDay(parse(hi), locale) })}</span>
          <div className={css.calActions}>
            <Button onClick={() => setOpen(false)}>{t('cal.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                onChange({ preset: 'custom', from: lo, to: hi });
                setOpen(false);
              }}
            >
              {t('cal.apply')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- month-range calendar (Monthly P&L, Expenses) ---------- */

/** Header month-range picker shared by Monthly P&L and Expenses. */
export function MonthRangeCalendar({ value, onChange, presets = ['this_month', 'this_year', 'last_12_months', 'last_year'] }: { value: DayRange<MonthPreset>; onChange: (r: DayRange<MonthPreset>) => void; presets?: Exclude<MonthPreset, 'custom'>[] }) {
  const t = useTranslations('money');
  const locale = useLocale();
  const { open, setOpen, wrap, btn } = usePopover();
  const today = useDay();
  const now = monthIndex(today);
  const [a, setA] = useState(monthIndex(value.from));
  const [b, setB] = useState<number | null>(monthIndex(value.to));
  const [year, setYear] = useState(Math.floor(monthIndex(value.to) / 12));
  const toggle = () => {
    if (!open) {
      setA(monthIndex(value.from));
      setB(monthIndex(value.to));
      setYear(Math.floor(monthIndex(value.to) / 12));
    }
    setOpen(!open);
  };
  const lo = b == null ? a : Math.min(a, b);
  const hi = b == null ? a : Math.max(a, b);
  const pick = (m: number) => {
    if (b != null) {
      setA(m);
      setB(null);
    } else setB(m);
  };
  return (
    <div className={css.calWrap} ref={wrap}>
      <Trigger label={monthRangeLabel(value.from, value.to, locale)} open={open} onClick={toggle} btnRef={btn} aria={t('cal.months')} />
      {open && (
        <div className={`an-pop an-cal ${css.calPop}`} role="dialog" aria-label={t('cal.months')}>
          <PresetChips
            items={presets.map((p) => ({ value: p, label: t(`period.${p}`) }))}
            current={value.preset as Exclude<MonthPreset, 'custom'>}
            onPick={(p) => {
              onChange(monthPreset(p, parse(today)));
              setOpen(false);
            }}
          />
          <div className="an-cal-h">
            <button type="button" className="an-calnav" aria-label={t('cal.prevYear')} onClick={() => setYear(year - 1)}>
              <Icon as={CaretLeft} size="sm" className="flip" />
            </button>
            <b>{year}</b>
            <button type="button" className="an-calnav" aria-label={t('cal.nextYear')} disabled={year >= Math.floor(now / 12)} onClick={() => setYear(year + 1)}>
              <Icon as={CaretRight} size="sm" className="flip" />
            </button>
          </div>
          <div className={`an-days ${css.monthGrid}`}>
            {Array.from({ length: 12 }, (_, i) => {
              const m = year * 12 + i;
              const end = m === lo || m === hi;
              const inside = m >= lo && m <= hi;
              return (
                <button key={m} type="button" className={`${inside && !end ? 'in' : ''} ${end ? 'end' : ''}`} disabled={m > now} aria-pressed={inside} onClick={() => pick(m)}>
                  {monthShort(m, locale)}
                </button>
              );
            })}
          </div>
          <span className={css.calHint}>{b == null ? t('cal.pickLastMonth') : t('cal.fromTo', { from: monthName(lo, locale), to: monthName(hi, locale) })}</span>
          <div className={css.calActions}>
            <Button onClick={() => setOpen(false)}>{t('cal.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                onChange({ preset: 'custom', from: monthStart(lo), to: minIso(monthEnd(hi), today) });
                setOpen(false);
              }}
            >
              {t('cal.apply')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
