'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { Bell, Check, Icon, Info, WarningCircle, X } from './icon';
import { IconButton } from './controls';

function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 767px)');
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return phone;
}

/**
 * Task layer that keeps the page in view: side panel on desktop (end side), bottom sheet on
 * phone. Escape closes; focus moves in on open and back to the trigger on close.
 * With `dirty`, closing asks first ("Discard your changes?" · Keep editing / Discard).
 */
export function Sheet({ open, onClose, title, sub, children, footer, dirty }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; dirty?: boolean }) {
  const t = useTranslations('common');
  const phone = useIsPhone();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const [asking, setAsking] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const askingRef = useRef(asking);
  askingRef.current = asking;
  const requestClose = useCallback(() => {
    if (dirtyRef.current) setAsking(true);
    else onClose();
  }, [onClose]);
  useEffect(() => {
    if (!open) {
      setAsking(false);
      return;
    }
    opener.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (askingRef.current) return;
      if (e.key === 'Escape') requestClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const root = ref.current;
      const first =
        root?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=file]):not([hidden]):not(:disabled):not([readonly]), select:not([hidden]), textarea:not([hidden])') ??
        root?.querySelector<HTMLElement>('.an-panel-f button:not(:disabled)') ??
        root?.querySelector<HTMLElement>('button');
      first?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, requestClose]);
  if (!open || typeof document === 'undefined') return null;
  const head = (
    <div className="an-panel-h">
      <h2 id="sheet-title">
        {title}
        {sub && <span className="sub">{sub}</span>}
      </h2>
      <IconButton icon={X} label={t('close')} onClick={requestClose} />
    </div>
  );
  return createPortal(
    <div className="an-stage-fixed" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div className="an-scrim" onClick={requestClose} />
      {phone ? (
        <div className="an-bsheet" ref={ref}>
          <span className="an-grab" />
          {head}
          {children}
          {footer && <div className="an-panel-f">{footer}</div>}
        </div>
      ) : (
        <div className="an-panel" ref={ref}>
          {head}
          {children}
          {footer && <div className="an-panel-f">{footer}</div>}
        </div>
      )}
      <ConfirmDialog
        open={asking}
        title={t('unsaved.title')}
        text={t('unsaved.text')}
        cancel={{ label: t('unsaved.keep'), onClick: () => setAsking(false) }}
        confirm={{
          label: t('discard'),
          danger: true,
          onClick: () => {
            setAsking(false);
            onClose();
          },
        }}
      />
    </div>,
    document.body,
  );
}

/**
 * Centred dialog over a dimmed page (signed out, discard changes). One or two buttons; with two they
 * share the width. `icon` sits in a rounded box above the title.
 */
export function ConfirmDialog({ open, icon, title, text, confirm, cancel }: { open: boolean; icon?: PhosphorIcon; title: ReactNode; text?: ReactNode; confirm: { label: string; onClick: () => void; danger?: boolean }; cancel?: { label: string; onClick: () => void } }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    setTimeout(() => ref.current?.querySelector<HTMLButtonElement>(cancel ? 'button' : '.an-btn.primary')?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && cancel) {
        e.stopPropagation();
        cancel.onClick();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button')];
        const i = f.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, cancel]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="an-dialog-wrap">
      <div className="an-dialog" role="alertdialog" aria-modal="true" aria-labelledby="an-dlg-t" ref={ref}>
        {icon && (
          <span className="an-dialog-ic">
            <Icon as={icon} size="lg" />
          </span>
        )}
        <h3 id="an-dlg-t">{title}</h3>
        {text && <p>{text}</p>}
        <div className={cancel ? 'an-dialog-btns' : 'an-dialog-btns one'}>
          {cancel && (
            <button type="button" className="an-btn secondary" onClick={cancel.onClick}>
              {cancel.label}
            </button>
          )}
          <button type="button" className={`an-btn primary keep ${confirm.danger ? 'danger' : ''}`} onClick={confirm.onClick}>
            {confirm.label}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------- Toasts ---------------------------------------------------------------- */

export type ToastKind = 'ok' | 'err' | 'info' | 'inc' | 'prog';
export interface ToastAction {
  label: string;
  onClick?: () => void;
  href?: string;
}
export interface ToastOptions {
  kind?: ToastKind;
  /** The one optional button (View, Undo, Try again, Reload, Review…). */
  action?: ToastAction;
  /** Replace the toast with this id (e.g. "Preparing PRO-0008.pdf…" → "PRO-0008.pdf ready"). */
  id?: string;
}

interface ToastItem extends ToastOptions {
  key: number;
  text: string;
  kind: ToastKind;
}

/** `toast(text, undo?)` (confirmation) plus `toast.show(text, opts)` and `toast.dismiss(id)`. */
export interface ToastFn {
  (text: string, undo?: () => void): void;
  show: (text: string, opts?: ToastOptions) => string;
  dismiss: (id?: string) => void;
}

const ToastCtx = createContext<ToastFn>(Object.assign(() => {}, { show: () => '', dismiss: () => {} }));

/** Confirmations are cut to what happened (the first sentence, no full stop). */
function cut(text: string, kind: ToastKind) {
  let s = text.trim();
  if (kind === 'ok') {
    const m = s.match(/^(.+?[.!])\s+\S/);
    if (m) s = m[1];
  }
  if (/[^.]\.$/.test(s) && !/…$/.test(s)) s = s.slice(0, -1);
  return s;
}

const TOAST_ICON: Record<ToastKind, PhosphorIcon | null> = { ok: Check, err: WarningCircle, info: Info, inc: Bell, prog: null };

/**
 * One style for every toast (design system TOASTS): neutral card, coloured round icon, one optional
 * button, close. Desktop: centred over the page's header row. Phone: under the status bar.
 * Confirmations fade after 5 s; errors, incoming updates and "in progress" stay until closed.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const [item, setItem] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismiss = useCallback((id?: string) => {
    setItem((x) => (!id || x?.id === id ? null : x));
  }, []);
  const show = useCallback((text: string, opts: ToastOptions = {}) => {
    const kind = opts.kind ?? 'ok';
    const id = opts.id ?? String(Date.now());
    const key = Date.now() + Math.random();
    clearTimeout(timer.current);
    setItem({ ...opts, kind, id, key, text: cut(text, kind) });
    if (kind === 'ok') timer.current = setTimeout(() => setItem((x) => (x?.key === key ? null : x)), 5000);
    return id;
  }, []);
  const fn = useMemo<ToastFn>(() => Object.assign((text: string, undo?: () => void) => void show(text, { kind: 'ok', action: undo ? { label: t('undo'), onClick: undo } : undefined }), { show, dismiss }), [show, dismiss, t]);
  const ic = item ? TOAST_ICON[item.kind] : null;
  return (
    <ToastCtx.Provider value={fn}>
      {children}
      <div className="toasts" aria-live="polite">
        {item && (
          <div key={item.key} className={`an-toast x-${item.kind}`} role={item.kind === 'err' ? 'alert' : 'status'}>
            <span className={`tic ${item.kind}`}>{ic ? <Icon as={ic} size="sm" /> : <span className="an-spin" aria-hidden />}</span>
            <span className="msg">{item.text}</span>
            {item.action &&
              (item.action.href ? (
                <Link className="tbtn" href={item.action.href} onClick={() => setItem(null)}>
                  {item.action.label}
                </Link>
              ) : (
                <button
                  type="button"
                  className="tbtn"
                  onClick={() => {
                    setItem(null);
                    item.action?.onClick?.();
                  }}
                >
                  {item.action.label}
                </button>
              ))}
            {item.kind !== 'prog' && (
              <button type="button" className="tx" aria-label={t('close')} onClick={() => setItem(null)}>
                <Icon as={X} size="sm" />
              </button>
            )}
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
