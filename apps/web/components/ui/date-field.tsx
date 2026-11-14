'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarBlank, CaretLeft, CaretRight, Icon } from './icon';
import { useFmt } from '@/lib/format';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const WD: Record<string, string[]> = {
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  bg: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'],
  he: ['ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳', 'א׳'],
};

/**
 * A date field (design system Calendar rules: 300px popover, day cells 36px, Escape closes and returns focus) that opens the calendar (a day grid in a popover) instead of the browser's
 * own picker. `value` is YYYY-MM-DD; `min` and `max` grey out days outside the range. Escape closes and
 * returns focus to the field.
 */
export function DateField({ label, value, onChange, min, max, error, help }: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string; error?: string; help?: string }) {
  const id = useId();
  const locale = useLocale();
  const t = useTranslations('common');
  const { date } = useFmt();
  const [open, setOpen] = useState(false);
  const cur = parse(value || ymd(new Date()));
  const [month, setMonth] = useState<[number, number]>([cur.getFullYear(), cur.getMonth()]);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const [cy, cm] = month;
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
  const tag = locale === 'bg' ? 'bg-BG' : locale === 'he' ? 'he-IL' : 'en-GB';
  const title = `${new Intl.DateTimeFormat(tag, { month: 'long' }).format(first)} ${cy}`;
  return (
    <div className="an-field">
      <label htmlFor={id}>{label}</label>
      <div className={`menu-wrap block start date-wrap`} ref={wrap}>
        <button
          id={id}
          ref={btn}
          type="button"
          className={`an-input an-dd ${error ? 'error' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            if (!open) setMonth([cur.getFullYear(), cur.getMonth()]);
            setOpen((o) => !o);
          }}
        >
          <span className="date-value">
            <Icon as={CalendarBlank} size="sm" />
            <bdi>{value ? date(value) : ''}</bdi>
          </span>
        </button>
        {open && (
          <div className={`an-pop menu date-pop`} role="dialog" aria-label={label}>
            <div className="cal-mon">
              <div className="cal-mh">
                <button type="button" className="cal-ib" aria-label={t('lookBack.prevMonth')} onClick={() => step(-1)}>
                  <Icon as={CaretLeft} size="sm" />
                </button>
                <b>{title}</b>
                <button type="button" className="cal-ib" aria-label={t('lookBack.nextMonth')} onClick={() => step(1)}>
                  <Icon as={CaretRight} size="sm" />
                </button>
              </div>
              <div className="cal-grid">
                {(WD[locale] ?? WD.en).map((w) => (
                  <span key={w} className="wd">
                    {w}
                  </span>
                ))}
                {cells.map((d) => {
                  const k = ymd(d);
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`cal-d ${d.getMonth() !== cm ? 'out' : ''} ${k === value ? 'sel' : ''}`}
                      disabled={(!!min && k < min) || (!!max && k > max)}
                      aria-pressed={k === value}
                      onClick={() => {
                        onChange(k);
                        setOpen(false);
                        btn.current?.focus();
                      }}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
      {error ? <span className="an-help error">{error}</span> : help ? <span className="an-help">{help}</span> : null}
    </div>
  );
}
