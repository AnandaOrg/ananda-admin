'use client';

import Link from 'next/link';
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import type { StatusTone } from '@ananda/shared';
import { useLookingBack } from '@/lib/asof';
import { useMedia } from '@/lib/media';
import { CaretDown, Icon, MagnifyingGlass, Minus, Plus } from './icon';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  icon?: PhosphorIcon;
  block?: boolean;
  /** Sending: keeps its label and width, the icon becomes a spinner, and it can't be pressed twice. */
  busy?: boolean;
  /**
   * Changes data, so it is off while looking back at a past day (header "As of"). Primary buttons
   * change data unless `keep` is set; secondary buttons only when `writes` is set.
   */
  writes?: boolean;
  /** Stays on while looking back (e.g. "Back to today", Download, Print). */
  keep?: boolean;
};

/** Spinner in currentColor (busy buttons, toasts in progress). */
export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="an-spin" style={{ width: size, height: size }} aria-hidden />;
}

/** Pill-shaped button. Labels are verbs in sentence case. */
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', icon, block, busy, writes, keep, className = '', children, disabled, onClick, title, ...rest }, ref) {
  const lookingBack = useLookingBack();
  const t = useTranslations('common');
  const off = lookingBack && !keep && (writes ?? variant === 'primary');
  return (
    <button
      ref={ref}
      type="button"
      className={`an-btn ${variant} ${size === 'md' ? '' : size} ${block ? 'block' : ''} ${busy ? 'is-busy' : ''} ${keep ? 'keep' : ''} ${writes ? 'writes' : ''} ${className}`}
      disabled={disabled || off}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      title={off ? t('lookBack.blockedShort') : title}
      onClick={busy ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {busy ? <Spinner /> : icon && <Icon as={icon} size={size === 'sm' ? 'sm' : 'md'} />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: PhosphorIcon; label: string; badge?: number }>(function IconButton({ icon, label, badge, className = '', ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={`an-iconbtn ${className}`} aria-label={badge ? `${label}, ${badge}` : label} {...rest}>
      <Icon as={icon} />
      {!!badge && <span className="an-badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
});

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/**
 * A chip row fills its container; chips share the width and never wrap. When the options do not
 * fit on one row in the current language, the row becomes a dropdown showing the current choice
 * (design system: chip rows that don't fit become a dropdown).
 */
export function Chips<T extends string>({ options, value, onChange, fill = true, label }: { options: ChipOption<T>[]; value: T; onChange: (v: T) => void; fill?: boolean; label?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const check = () => setFits((measure.current?.scrollWidth ?? 0) <= el.clientWidth + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [options.map((o) => o.label + o.count).join('|')]);
  const text = (o: ChipOption<T>) => (o.count != null ? `${o.label} · ${o.count}` : o.label);
  const cur = options.find((o) => o.value === value) ?? options[0];
  // Phone: the row scrolls sideways (prototype); desktop and tablet: a dropdown when it doesn't fit.
  const phone = useMedia('(max-width: 767px)');
  return (
    <div ref={wrap} className="chips-wrap" style={{ position: 'relative', minWidth: 0 }}>
      {/* Hidden natural-width copy used to measure whether the chips fit; clipped so it adds no width. */}
      <div aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }}>
        <div ref={measure} className="an-chips" style={{ width: 'max-content' }}>
          {options.map((o) => (
            <span key={o.value} className="an-chip" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {o.label}
              {o.count != null && <span className="c"> · {o.count}</span>}
            </span>
          ))}
        </div>
      </div>
      {fits || phone ? (
        <div className={`an-chips ${fill && fits ? 'fill' : ''} ${!fits ? 'scroll' : ''}`} role="group" aria-label={label}>
          {options.map((o) => (
            <button key={o.value} type="button" className="an-chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
              {o.label}
              {o.count != null && <span className="c"> · {o.count}</span>}
            </button>
          ))}
        </div>
      ) : (
        <MenuButton
          align="start"
          items={options.map((o) => ({ key: o.value, label: text(o), selected: o.value === value, onSelect: () => onChange(o.value) }))}
          trigger={({ open, toggle, ref }) => (
            <button ref={ref} type="button" className={`an-dd-btn ${open ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label={label ? `${label}: ${cur ? text(cur) : ''}` : undefined} onClick={toggle}>
              <span>{cur ? text(cur) : ''}</span>
              <Icon as={CaretDown} size="sm" />
            </button>
          )}
        />
      )}
    </div>
  );
}

/** Status tag with a dot and a word; never colour alone. */
export function Pill({ tone = 'info', children, tag }: { tone?: StatusTone; children: ReactNode; tag?: boolean }) {
  return <span className={`an-pill ${tag ? 'tag' : tone}`}>{children}</span>;
}

export function Count({ n, tone = 'y' }: { n: number; tone?: 'y' | 'r' }) {
  return <span className={`an-count ${tone}`}>{n}</span>;
}

export function Segmented<T extends string>({ options, value, onChange, fill, tones, label, disabled }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; fill?: boolean; tones?: Partial<Record<T, 't-mute' | 't-info' | 't-good'>>; label?: string; disabled?: boolean }) {
  return (
    <div className={`an-seg ${fill ? 'fill' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={tones?.[o.value] ?? ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)} disabled={disabled}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="an-swrow">
      <button type="button" role="switch" className="an-switch" aria-checked={checked} onClick={() => onChange(!checked)} disabled={disabled} aria-label={label} />
      <span>{label}</span>
    </label>
  );
}

/** Quantity in cartons; the number box can be typed into for large jumps. */
export function Stepper({ value, onChange, min = 0, step = 1, max, label }: { value: number; onChange: (n: number) => void; min?: number; step?: number; max?: number; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (n: number) => Math.max(min, max != null ? Math.min(max, n) : n);
  return (
    <div className="an-step" role="group" aria-label={label}>
      <button type="button" aria-label={`${label} −${step}`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
        <Icon as={Minus} size="sm" />
      </button>
      <input
        className="an-step-input"
        inputMode="numeric"
        aria-label={label}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d-]/g, '');
          setText(t);
          const n = parseInt(t, 10);
          if (!Number.isNaN(n)) onChange(clamp(n));
        }}
        onBlur={() => setText(String(value))}
        style={{ width: 56, height: 'var(--control-sm)', borderRadius: 'var(--radius-md)', border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--text)', font: '500 16px/1 var(--font-sans)', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
      />
      <button type="button" aria-label={`${label} +${step}`} onClick={() => onChange(clamp(value + step))} disabled={max != null && value >= max}>
        <Icon as={Plus} size="sm" />
      </button>
    </div>
  );
}

export interface SearchSuggestion {
  key: string;
  /** Main line (customer, order number…). */
  title: string;
  /** Second line (order · agent · amount). */
  sub?: string;
  /** Extra words that should match but aren't shown (VAT number, agent). */
  extra?: string;
  href?: string;
  onPick?: () => void;
}

/**
 * How close `text` is to the query: 0 starts with it, 1 a word starts with it, 2 contains it,
 * 3 the letters appear in order (typos, with `fuzzy`), 9 no match. Use it to filter rows as you type.
 */
export function matchScore(query: string, text: string, fuzzy = false): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 0;
  if (t.split(/[\s·,.\-/]+/).some((w) => w.startsWith(q))) return 1;
  if (t.includes(q)) return 2;
  if (!fuzzy || q.length < 3) return 9;
  let i = 0;
  for (const ch of t.replace(/\s+/g, '')) if (ch === q[i]) i++;
  return i === q.length && t.length < q.length * 4 ? 3 : 9;
}

/** Rows whose text matches the query (any of the given fields), best matches kept in their order. */
export function searchFilter<T>(rows: T[], query: string, text: (r: T) => string | (string | null | undefined)[]): T[] {
  if (!query.trim()) return rows;
  return rows.filter((r) => {
    const v = text(r);
    return matchScore(query, Array.isArray(v) ? v.filter(Boolean).join(' ') : v) < 9;
  });
}

function Mark({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.trim().toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  const n = q.trim().length;
  return (
    <>
      {text.slice(0, i)}
      <b className="mk">{text.slice(i, i + n)}</b>
      {text.slice(i + n)}
    </>
  );
}

/**
 * Search bar that filters as you type (`onChange` on every key; filter rows with `searchFilter`).
 * With `suggestions`, the closest matches (max 5) drop down under it: arrows move, Enter picks the
 * first or the highlighted one, Escape clears. "Nothing matches" when there is none.
 */
export function Search({ value, onChange, placeholder, phone, suggestions, className = '' }: { value: string; onChange: (v: string) => void; placeholder: string; phone?: boolean; suggestions?: SearchSuggestion[]; className?: string }) {
  const t = useTranslations('common');
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLLabelElement>(null);
  const q = value.trim();
  const hits = suggestions && q
    ? suggestions
        .map((h) => ({ h, sc: Math.min(matchScore(q, h.title, true), matchScore(q, `${h.title} ${h.sub ?? ''} ${h.extra ?? ''}`) + 1) }))
        .filter((x) => x.sc < 9)
        .sort((a, b) => a.sc - b.sc || a.h.title.localeCompare(b.h.title))
        .slice(0, 5)
        .map((x) => x.h)
    : [];
  useEffect(() => setHi(0), [q]);
  const open = !!suggestions && focus && !!q;
  const pick = (h: SearchSuggestion) => {
    setFocus(false);
    h.onPick?.();
    if (h.href) window.location.assign(h.href);
  };
  return (
    <label ref={box} className={`an-search ${phone ? 'phone' : ''} ${className}`} style={{ position: 'relative', overflow: 'visible' }}>
      <Icon as={MagnifyingGlass} />
      <input
        type="search"
        value={value}
        enterKeyHint="search"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('');
          if (!open || !hits.length) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            pick(hits[hi] ?? hits[0]);
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-expanded={open}
        aria-autocomplete={suggestions ? 'list' : undefined}
        role={suggestions ? 'combobox' : undefined}
      />
      {open && (
        <div className="an-ddl" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {hits.length ? (
            hits.map((h, i) =>
              h.href ? (
                <Link key={h.key} href={h.href} className={`an-ddo ${i === hi ? 'on' : ''}`} role="option" aria-selected={i === hi} onClick={() => setFocus(false)}>
                  <b>
                    <Mark text={h.title} q={q} />
                  </b>
                  {h.sub && (
                    <span>
                      <Mark text={h.sub} q={q} />
                    </span>
                  )}
                </Link>
              ) : (
                <button key={h.key} type="button" className={`an-ddo ${i === hi ? 'on' : ''}`} role="option" aria-selected={i === hi} onClick={() => pick(h)}>
                  <b>
                    <Mark text={h.title} q={q} />
                  </b>
                  {h.sub && (
                    <span>
                      <Mark text={h.sub} q={q} />
                    </span>
                  )}
                </button>
              ),
            )
          ) : (
            <span className="an-ddn">{t('searchNone', { q })}</span>
          )}
        </div>
      )}
    </label>
  );
}

/**
 * Text that may be cut with … (table cells, long names). When it is cut, the full text shows in a
 * tooltip on hover or keyboard focus.
 */
export function Trunc({ children, max, className = '' }: { children: ReactNode; max?: number | string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const show = () => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    const r = el.getBoundingClientRect();
    setTip({ x: document.dir === 'rtl' ? window.innerWidth - r.right : r.left, y: r.bottom + 6, text: el.textContent ?? '' });
  };
  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [tip]);
  return (
    <>
      <span ref={ref} className={`trunc ${className}`} style={max != null ? { maxWidth: max } : undefined} tabIndex={0} onMouseEnter={show} onMouseLeave={() => setTip(null)} onFocus={show} onBlur={() => setTip(null)}>
        {children}
      </span>
      {tip &&
        createPortal(
          <div className="celltip" role="tooltip" style={{ top: tip.y, insetInlineStart: Math.max(8, tip.x) }}>
            {tip.text}
          </div>,
          document.body,
        )}
    </>
  );
}

export interface MenuItem {
  key: string;
  label: string;
  detail?: string;
  onSelect?: () => void;
  href?: string;
  disabled?: boolean;
  selected?: boolean;
}

/** Floating menu from a trigger; arrows move, Enter picks, Escape closes and returns focus. */
export function MenuButton({ trigger, items, align = 'end', groups, panel }: { trigger: (p: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => ReactNode; items: MenuItem[]; align?: 'start' | 'end'; groups?: never; /** Custom content instead of `items` (stays open on clicks inside). */ panel?: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const els = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('.an-mi:not(:disabled), .cp-i:not(:disabled)') ?? [])];
        const i = els.indexOf(document.activeElement as HTMLButtonElement);
        els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    setTimeout(() => wrap.current?.querySelector<HTMLButtonElement>('.an-mi:not(:disabled), .cp-i:not(:disabled)')?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  void groups;
  return (
    <span className={`menu-wrap ${align === 'start' ? 'start' : ''}`} ref={wrap}>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: btn })}
      {open && panel && <div className="menu-panel">{panel(() => setOpen(false))}</div>}
      {open && !panel && (
        <div className="an-pop menu" role="menu">
          {items.map((it) =>
            it.href ? (
              <a key={it.key} className="an-mi" role="menuitem" href={it.href} aria-selected={it.selected}>
                {it.label}
                {it.detail && <small>{it.detail}</small>}
              </a>
            ) : (
              <button
                key={it.key}
                type="button"
                className="an-mi"
                role="menuitem"
                aria-selected={it.selected}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect?.();
                }}
              >
                {it.label}
                {it.detail && <small>{it.detail}</small>}
              </button>
            ),
          )}
        </div>
      )}
    </span>
  );
}

/** Header filter trigger showing the current value. */
export function SelectPill({ icon, value, items, label }: { icon?: PhosphorIcon; value: string; items: MenuItem[]; label: string }) {
  return (
    <MenuButton
      items={items}
      trigger={({ open, toggle, ref }) => (
        <button ref={ref} type="button" className="an-sel" aria-expanded={open} aria-haspopup="menu" aria-label={`${label}: ${value}`} onClick={toggle}>
          {icon && <Icon as={icon} size="sm" />}
          <span>{value}</span>
          <Icon as={CaretDown} size="sm" />
        </button>
      )}
    />
  );
}

export function Avatar({ name, size }: { name: string; size?: 'lg' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <span className={`an-av ${size ?? ''}`} aria-hidden>
      {initials}
    </span>
  );
}

/** Keeps amounts, codes and Latin names left-to-right inside Hebrew text. */
export function B({ children }: { children: ReactNode }) {
  return <bdi>{children}</bdi>;
}
