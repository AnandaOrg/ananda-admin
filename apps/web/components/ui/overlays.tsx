'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { CheckCircle, Icon, X } from './icon';
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
 */
export function Sheet({ open, onClose, title, sub, children, footer, dirty }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; dirty?: boolean }) {
  const t = useTranslations('common');
  const phone = useIsPhone();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  const head = (
    <div className="an-panel-h">
      <h2 id="sheet-title">
        {title}
        {sub && <span className="sub">{sub}</span>}
      </h2>
      <IconButton icon={X} label={t('close')} onClick={onClose} />
    </div>
  );
  return createPortal(
    <div className="an-stage-fixed" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div className="an-scrim" onClick={() => !dirty && onClose()} />
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
    </div>,
    document.body,
  );
}

interface ToastItem {
  id: number;
  text: string;
  undo?: () => void;
}

const ToastCtx = createContext<(text: string, undo?: () => void) => void>(() => {});

/** Brief confirmation after an action; errors are shown where they happened instead. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, undo?: () => void) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, undo }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), undo ? 9000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className="an-toast">
            <Icon as={CheckCircle} />
            <span>{i.text}</span>
            {i.undo && (
              <button
                className="act"
                onClick={() => {
                  i.undo?.();
                  setItems((x) => x.filter((y) => y.id !== i.id));
                }}
              >
                {t('undo')}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
