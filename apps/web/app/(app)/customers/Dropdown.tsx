'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CaretDown, Icon } from '@/components/ui';
import s from './customers.module.css';

export interface DropdownOption {
  value: string;
  label: string;
  detail?: string;
}

/**
 * The app's own dropdown for forms in a panel: the list opens inside the form and pushes what
 * follows down instead of covering it, and scrolls itself into view. Each option can carry a
 * second line (e.g. "No commission on its orders").
 */
export function DropdownField({ label, value, options, placeholder, onChange, error, help }: { label: string; value: string; options: DropdownOption[]; placeholder: string; onChange: (v: string) => void; error?: string; help?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => list.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    const onDoc = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const els = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const i = els.indexOf(document.activeElement as HTMLButtonElement);
        els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div className="an-field" ref={wrap}>
      <label htmlFor={id}>{label}</label>
      <div className={`an-ddwrap ${open ? 'open' : ''}`}>
        <button
          id={id}
          type="button"
          className={`an-input an-dd ${s.dd} ${error ? 'error' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-invalid={!!error || undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={current ? '' : s.ph}>{current?.label ?? placeholder}</span>
          <Icon as={CaretDown} size="sm" />
        </button>
        {open && (
          <div className={`an-pop ${s.ddl}`} role="listbox" aria-labelledby={id} ref={list}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                className="an-mi"
                aria-selected={o.value === value}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <b>{o.label}</b>
                {o.detail && <small>{o.detail}</small>}
              </button>
            ))}
          </div>
        )}
      </div>
      {error ? <span className="an-help error">{error}</span> : help ? <span className="an-help">{help}</span> : null}
    </div>
  );
}
