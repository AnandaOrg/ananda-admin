'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useTranslations } from 'next-intl';
import { CaretDown, Icon } from './icon';

interface FieldShell {
  label: string;
  help?: ReactNode;
  error?: string;
  className?: string;
}

export function Field({ label, help, error, className = '', children, id }: FieldShell & { children: ReactNode; id: string }) {
  return (
    <div className={`an-field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <span className="an-help error" id={`${id}-h`}>
          {error}
        </span>
      ) : help ? (
        <span className="an-help" id={`${id}-h`}>
          {help}
        </span>
      ) : null}
    </div>
  );
}

export function TextField({ label, help, error, className, ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Field id={id} label={label} help={help} error={error} className={className}>
      <input id={id} className={`an-input ${error ? 'error' : ''}`} aria-invalid={!!error || undefined} aria-describedby={help || error ? `${id}-h` : undefined} {...rest} />
    </Field>
  );
}

/** Money input in euros; the value is kept in cents. */
export function MoneyField({ label, help, error, className, cents, onCents, ...rest }: FieldShell & { cents: number | null; onCents: (c: number | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId();
  return (
    <Field id={id} label={label} help={help} error={error} className={className}>
      <span className={`an-input ${error ? 'error' : ''}`} style={{ paddingInlineEnd: 0 }}>
        <span className="muted">€</span>
        <input
          id={id}
          inputMode="decimal"
          style={{ flex: 1, minWidth: 0, height: '100%', border: 0, background: 'none', color: 'inherit', font: 'inherit', outline: 'none', fontVariantNumeric: 'tabular-nums' }}
          defaultValue={cents == null ? '' : (cents / 100).toFixed(2)}
          onChange={(e) => {
            const n = parseFloat(e.target.value.replace(/\s/g, '').replace(',', '.'));
            onCents(Number.isFinite(n) ? Math.round(n * 100) : null);
          }}
          aria-invalid={!!error || undefined}
          {...rest}
        />
      </span>
    </Field>
  );
}

export function TextArea({ label, help, error, className, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Field id={id} label={label} help={help} error={error} className={className}>
      <textarea id={id} className="an-area" aria-invalid={!!error || undefined} {...rest} />
    </Field>
  );
}

/** Dropdown field (native select styled as the design system's Dropdown). */
export function Select({ label, help, error, className, options, placeholder, ...rest }: FieldShell & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  const id = useId();
  return (
    <Field id={id} label={label} help={help} error={error} className={className}>
      <span style={{ position: 'relative', display: 'block' }}>
        <select id={id} className={`an-input an-dd ${error ? 'error' : ''}`} style={{ paddingInlineEnd: 36 }} aria-invalid={!!error || undefined} {...rest}>
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span style={{ position: 'absolute', insetInlineEnd: 12, top: 14, pointerEvents: 'none', color: 'var(--text-muted)' }}>
          <Icon as={CaretDown} size="sm" />
        </span>
      </span>
    </Field>
  );
}

/** Six-digit code from the authenticator app, for sensitive actions. */
export function TwoStepField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const t = useTranslations('common');
  return (
    <TextField
      label={t('twoStep.label')}
      help={t('twoStep.help')}
      error={error}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      className="code"
      maxLength={6}
    />
  );
}

/** Reason chips from the shared reason lists, with "Other" always available. */
export function ReasonChips({ reasons, value, onChange, label, ns }: { reasons: readonly string[]; value: string; onChange: (v: string) => void; label: string; ns: string }) {
  const t = useTranslations('common');
  return (
    <div className="an-field">
      <label>{label}</label>
      <div className="an-chips" role="group" aria-label={label} style={{ flexWrap: 'wrap' }}>
        {reasons.map((r) => (
          <button key={r} type="button" className="an-chip" aria-pressed={value === r} onClick={() => onChange(r)}>
            {t(`reasons.${ns}.${r}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
