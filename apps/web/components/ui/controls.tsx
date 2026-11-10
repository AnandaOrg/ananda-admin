'use client';

import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import type { StatusTone } from '@ananda/shared';
import { CaretDown, Icon, MagnifyingGlass, Minus, Plus } from './icon';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  icon?: PhosphorIcon;
  block?: boolean;
  busy?: boolean;
};

/** Pill-shaped button. Labels are verbs in sentence case. */
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'secondary', size = 'md', icon, block, busy, className = '', children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={`an-btn ${variant} ${size === 'md' ? '' : size} ${block ? 'block' : ''} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {icon && <Icon as={icon} size={size === 'sm' ? 'sm' : 'md'} />}
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
 * fit on one row in the current language, the row becomes a dropdown showing the current choice.
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
  return (
    <div ref={wrap} style={{ position: 'relative', minWidth: 0 }}>
      {/* Hidden natural-width copy used to measure whether the chips fit; clipped so it adds no width. */}
      <div aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none' }}>
        <div ref={measure} className="an-chips" style={{ width: 'max-content' }}>
          {options.map((o) => (
            <span key={o.value} className="an-chip" style={{ display: 'inline-flex', alignItems: 'center' }}>
              {o.label}
              {o.count != null && <span className="c">{o.count}</span>}
            </span>
          ))}
        </div>
      </div>
      {fits ? (
        <div className={`an-chips ${fill ? 'fill' : ''}`} role="group" aria-label={label}>
          {options.map((o) => (
            <button key={o.value} type="button" className="an-chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
              {o.label}
              {o.count != null && <span className="c">{o.count}</span>}
            </button>
          ))}
        </div>
      ) : (
        <span style={{ position: 'relative', display: 'block' }}>
          <select className="an-input an-dd" value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label} style={{ paddingInlineEnd: 36 }}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {text(o)}
              </option>
            ))}
          </select>
          <span style={{ position: 'absolute', insetInlineEnd: 12, top: 14, pointerEvents: 'none', color: 'var(--text-muted)' }}>
            <Icon as={CaretDown} size="sm" />
          </span>
        </span>
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

export function Search({ value, onChange, placeholder, phone }: { value: string; onChange: (v: string) => void; placeholder: string; phone?: boolean }) {
  return (
    <label className={`an-search ${phone ? 'phone' : ''}`}>
      <Icon as={MagnifyingGlass} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
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
export function MenuButton({ trigger, items, align = 'end', groups }: { trigger: (p: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => ReactNode; items: MenuItem[]; align?: 'start' | 'end'; groups?: never }) {
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
        const els = [...(wrap.current?.querySelectorAll<HTMLButtonElement>('.an-mi:not(:disabled)') ?? [])];
        const i = els.indexOf(document.activeElement as HTMLButtonElement);
        els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    setTimeout(() => wrap.current?.querySelector<HTMLButtonElement>('.an-mi:not(:disabled)')?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  void groups;
  return (
    <span className={`menu-wrap ${align === 'start' ? 'start' : ''}`} ref={wrap}>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: btn })}
      {open && (
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
