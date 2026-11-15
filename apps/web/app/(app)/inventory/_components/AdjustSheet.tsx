'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, UNITS_PER_CARTON, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { ActionError, Button, CaretDown, Icon, Sheet, Stepper } from '@/components/ui';
import { ADJUST_REASONS, type InventoryOverview } from './types';
import css from '../inventory.module.css';

type Reason = (typeof ADJUST_REASONS)[number];

/** FR-INV-4 Stock adjustment: flavour, change in cartons (±), reason. Written to stock movements and the audit log. */
export function AdjustSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const { num } = useFmt();
  const stock = useQuery({ queryKey: ['inventory', 'overview'], queryFn: () => api.get<InventoryOverview>('/inventory'), enabled: open });
  const [flavour, setFlavour] = useState<Flavour | null>(null);
  const [cartons, setCartons] = useState(0);
  const [reason, setReason] = useState<Reason | null>(null);
  useEffect(() => {
    if (!open) return;
    setFlavour(null);
    setCartons(0);
    setReason(null);
  }, [open]);

  const inStock = flavour ? (stock.data?.flavours.find((x) => x.flavour === flavour)?.inStock ?? 0) : 0;
  const minCartons = -Math.floor(inStock / UNITS_PER_CARTON);
  const adjust = useAction(() => api.post('/inventory/adjustments', { flavour, cartons, reason }), {
    success: t('adjust.done', { flavour: (flavour ?? '').toUpperCase(), n: cartons > 0 ? `+${cartons}` : String(cartons) }),
    successAction: { label: tc('view'), href: '/inventory/movements' },
    onDone: onClose,
  });
  const units = cartons * UNITS_PER_CARTON;
  const tone = cartons < 0 ? 'bad' : cartons > 0 ? 'good' : 'muted';

  return (
    <Sheet open={open} onClose={onClose} title={t('adjust.title')} dirty={cartons !== 0 || !!reason}>
      <p className={`body-sm muted ${css.para}`}>
        {t('adjust.sub')}
      </p>
      <div className="stack tight">
        <label>{t('adjust.flavour')}</label>
        <div className={`an-chips ${css.chipRow}`} role="radiogroup" aria-label={t('adjust.flavour')}>
          {FLAVOURS.map((f) => (
            <button
              key={f}
              type="button"
              className="an-chip"
              role="radio"
              aria-checked={flavour === f}
              aria-pressed={flavour === f}
              onClick={() => {
                setFlavour(f);
                setCartons(0);
              }}
            >
              <i aria-hidden className={`${css.dot} ${css[f]}`} />
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className={`row between ${css.box}`}>
        <span className="body-strong">{t('adjust.change')}</span>
        <span className={`stack tight ${css.center}`}>
          <Stepper value={cartons} onChange={setCartons} min={flavour ? minCartons : 0} max={flavour ? undefined : 0} label={t('adjust.change')} />
          <span className={`caption strong ${tone}`}>
            <bdi>{cartons > 0 ? '+' : cartons < 0 ? '−' : ''}{t('adjust.units', { n: num(Math.abs(units)) })}</bdi>
          </span>
        </span>
      </div>
      {adjust.fields.cartons && <span className="an-help error">{adjust.fields.cartons}</span>}
      <ReasonDropdown value={reason} onChange={setReason} />
      {!adjust.fields.cartons && <ActionError action={adjust} />}
      <Button variant="primary" block size="lg" disabled={!flavour || !reason || cartons === 0} busy={adjust.isPending} onClick={() => adjust.mutate(undefined)}>
        {t('adjust.cta')}
      </Button>
    </Sheet>
  );
}

/** Reason picker: a field-sized dropdown where each reason says when to use it. */
function ReasonDropdown({ value, onChange }: { value: Reason | null; onChange: (r: Reason) => void }) {
  const t = useTranslations('inventory');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
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
    <div className={`an-field ${css.reason}`} ref={wrap}>
      <label id="adj-reason">{t('adjust.reason')}</label>
      <button type="button" className="an-input an-dd" aria-haspopup="listbox" aria-expanded={open} aria-labelledby="adj-reason" onClick={() => setOpen((o) => !o)}>
        <span className={value ? '' : 'muted'}>{value ? t(`adjust.reasons.${value}`) : t('adjust.chooseReason')}</span>
        <Icon as={CaretDown} size="sm" />
      </button>
      {open && (
        <div className={`an-pop ${css.reasonPop}`} role="listbox" aria-labelledby="adj-reason">
          {ADJUST_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="option"
              className={`an-mi ${css.reasonItem}`}
              aria-selected={r === value}
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
            >
              <span className="body-strong">{t(`adjust.reasons.${r}`)}</span>
              <small>{t(`adjust.reasonHelp.${r}`)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
