'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/session';
import { Button, SlidersHorizontal, Sheet, Switch, type Column } from '@/components/ui';
import css from '../money.module.css';

function useTablet() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 768px) and (max-width: 1023px)');
    const f = () => setOn(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}

/**
 * Column picker at 768–1023 (DS: Tables). Locked columns always show; the default set fits in
 * Bulgarian; the choice is remembered per table and person. From 1024 up every column shows.
 */
export function useColumnPicker<T>(tableId: string, columns: Column<T>[], opts: { locked: string[]; defaults: string[] }): { visible: Column<T>[]; button: ReactNode } {
  const t = useTranslations('money');
  const { me } = useSession();
  const tablet = useTablet();
  const storeKey = `ananda:cols:${me.user.id}:${tableId}`;
  const [chosen, setChosen] = useState<string[]>(opts.defaults);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) setChosen(JSON.parse(raw));
    } catch {
      /* storage may be blocked; defaults are fine */
    }
  }, [storeKey]);
  const save = (next: string[]) => {
    setChosen(next);
    try {
      localStorage.setItem(storeKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const optional = columns.filter((c) => !opts.locked.includes(c.key));
  const max = opts.defaults.length;
  const shown = optional.filter((c) => chosen.includes(c.key));
  const hidden = optional.length - shown.length;
  const full = shown.length >= max;
  const visible = useMemo(() => (tablet ? columns.filter((c) => opts.locked.includes(c.key) || chosen.includes(c.key)) : columns), [tablet, columns, opts.locked, chosen]);

  const button = (
    <>
      <span className={css.colsBtn}>
        <Button size="sm" icon={SlidersHorizontal} onClick={() => setOpen(true)}>
          {t('columns.button', { n: hidden })}
        </Button>
      </span>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('columns.title')} footer={<Button variant="primary" onClick={() => setOpen(false)}>{t('columns.done')}</Button>}>
        {full && <p className="muted body-sm">{t('columns.full')}</p>}
        <div className="stack tight">
          {columns.map((c) => {
            const locked = opts.locked.includes(c.key);
            const on = locked || chosen.includes(c.key);
            return (
              <Switch
                key={c.key}
                checked={on}
                disabled={locked || (!on && full)}
                label={typeof c.header === 'string' ? c.header : c.key}
                onChange={(v) => save(v ? [...chosen, c.key] : chosen.filter((k) => k !== c.key))}
              />
            );
          })}
        </div>
      </Sheet>
    </>
  );
  return { visible, button };
}
