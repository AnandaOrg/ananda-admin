'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoney, parseMoney } from '@ananda/shared';
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

/** Money input in euros; the value is kept in cents. Written with the shared money formatter
 *  (EN/HE "€10,382.40", BG "10 382,40 €") and re-written that way when the field is left. */
export function MoneyField({ label, help, error, className, cents, onCents, placeholder, onBlur, ...rest }: FieldShell & { cents: number | null; onCents: (c: number | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId();
  const locale = useLocale();
  return (
    <Field id={id} label={label} help={help} error={error} className={className}>
      <input
        id={id}
        className={`an-input an-money ${error ? 'error' : ''}`}
        inputMode="decimal"
        defaultValue={cents == null ? '' : formatMoney(cents, locale)}
        placeholder={placeholder ?? formatMoney(0, locale)}
        onChange={(e) => onCents(parseMoney(e.target.value, locale))}
        onBlur={(e) => {
          const c = parseMoney(e.target.value, locale);
          if (c != null) e.target.value = formatMoney(c, locale);
          onBlur?.(e);
        }}
        aria-invalid={!!error || undefined}
        aria-describedby={help || error ? `${id}-h` : undefined}
        {...rest}
      />
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
      <span className="an-select-wrap">
        <select id={id} className={`an-input an-dd ${error ? 'error' : ''}`} aria-invalid={!!error || undefined} {...rest}>
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
        <span className="an-select-caret">
          <Icon as={CaretDown} size="sm" />
        </span>
      </span>
    </Field>
  );
}

/** Six-digit code from the authenticator app, for sensitive actions. */
export function TwoStepField({ value, onChange, error, autoFocus }: { value: string; onChange: (v: string) => void; error?: string; autoFocus?: boolean }) {
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
      autoFocus={autoFocus}
    />
  );
}

/** Reason chips from the shared reason lists, with "Other" always available. */
export function ReasonChips({ reasons, value, onChange, label, ns }: { reasons: readonly string[]; value: string; onChange: (v: string) => void; label: string; ns: string }) {
  const t = useTranslations('common');
  return (
    <div className="an-field">
      <label>{label}</label>
      <div className="an-chips wrap" role="group" aria-label={label}>
        {reasons.map((r) => (
          <button key={r} type="button" className="an-chip" aria-pressed={value === r} onClick={() => onChange(r)}>
            {t(`reasons.${ns}.${r}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
