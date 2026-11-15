'use client';

import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { FLAVOURS, UNITS_PER_CARTON, type CartonsByFlavour, type Flavour, type OrderStatus } from '@ananda/shared';
import { CaretDown, Check, FLAVOUR_VAR, Icon, OrderStatusPill, Pill, Stepper } from '@/components/ui';
import './sales.css';

/** Order status (shared `OrderStatusPill`: prototype tones, an overdue order shows only "N days late"); a cancelled order is red on its own page. */
export function SalesStatus({ status, daysLate, page }: { status: OrderStatus; daysLate?: number; page?: boolean }) {
  const tc = useTranslations('common');
  if (status === 'cancelled' && page) return <Pill tone="bad">{tc('orderStatus.cancelled')}</Pill>;
  return <OrderStatusPill status={status} daysLate={daysLate} />;
}

/** Flavour rows with − n + steppers, each with its own line under the name (units, "was 20 cartons"…). */
export function FlavourSteppers({ value, onChange, sub, only, max }: { value: CartonsByFlavour; onChange: (v: CartonsByFlavour) => void; sub: (f: Flavour, n: number) => ReactNode; only?: Flavour[]; max?: CartonsByFlavour }) {
  const tc = useTranslations('common');
  return (
    <div className="stack tight">
      {(only ?? [...FLAVOURS]).map((f) => {
        const n = value[f] ?? 0;
        return (
          <div key={f} className="an-flav">
            <i className="dot" style={{ background: FLAVOUR_VAR[f] }} aria-hidden />
            <span className="nm">{f.toUpperCase()}</span>
            <Stepper value={n} onChange={(x) => onChange({ ...value, [f]: x })} max={max?.[f]} label={tc('cartonsOf', { flavour: f.toUpperCase() })} />
            <span className="u">{sub(f, n)}</span>
          </div>
        );
      })}
    </div>
  );
}

export const unitsOf = (cartons: number) => cartons * UNITS_PER_CARTON;

/** Label/value rows in a soft box (the prototype's .box with .tot rows). */
export function SumBox({ rows, children, plain }: { rows: [ReactNode, ReactNode, ('big' | 'bad' | 'good' | 'warn')?][]; children?: ReactNode; plain?: boolean }) {
  return (
    <div className={plain ? 'sales-box plain' : 'sales-box'}>
      {rows.map(([k, v, x], i) => (
        <div key={i} className={`sales-tot ${x === 'big' ? 'big' : ''}`}>
          <span>{k}</span>
          <bdi className={x === 'warn' ? 'warn-dot' : x && x !== 'big' ? `tone-${x}` : undefined}>{v}</bdi>
        </div>
      ))}
      {children}
    </div>
  );
}

export const firstName = (name: string | null | undefined) => (name ?? '').split(' ')[0];

export interface PickOption {
  value: string;
  label: string;
  sub?: string;
}

/**
 * The app's own dropdown (prototype DD): each option has a line under it, and the list opens inside
 * the form, pushing what follows down instead of covering it.
 */
export function Picker({ label, value, options, placeholder, onChange, error }: { label?: string; value: string | null; options: PickOption[]; placeholder: string; onChange: (v: string) => void; error?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const cur = options.find((o) => o.value === value);
  return (
    <div className="an-field sales-pick">
      {label && (
        <label id={`${id}-l`} htmlFor={`${id}-b`}>
          {label}
        </label>
      )}
      <button id={`${id}-b`} type="button" className={`sales-pick-btn ${cur ? '' : 'ph'} ${error ? 'err' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{cur?.label ?? placeholder}</span>
        <Icon as={CaretDown} size="sm" />
      </button>
      {open && (
        <div className="sales-pick-list" role="listbox" aria-labelledby={label ? `${id}-l` : undefined}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={o.value === value ? 'on' : ''}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>
                <b>{o.label}</b>
                {o.sub && <span>{o.sub}</span>}
              </span>
              {o.value === value && <Icon as={Check} size="sm" />}
            </button>
          ))}
        </div>
      )}
      {error && <span className="an-help error">{error}</span>}
    </div>
  );
}

/** A row of choice chips (filters panel). */
export function PickChips({ options, value, onChange, label }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="sales-picks" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="an-chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
