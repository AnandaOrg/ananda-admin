'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FLAVOURS, REASONS, UNITS_PER_CARTON, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { Banner, Button, ReasonChips, Segmented, Sheet, Stepper, TextArea, Totals } from '@/components/ui';
import type { FlavourStock } from './types';

/** FR-INV-4 Stock adjustment: flavour, change in cartons (±), reason. */
export function AdjustSheet({ open, onClose, stock, flavour: initial }: { open: boolean; onClose: () => void; stock: FlavourStock[]; flavour?: Flavour }) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const { num } = useFmt();
  const [flavour, setFlavour] = useState<Flavour>(initial ?? 'aloha');
  const [cartons, setCartons] = useState(0);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setFlavour(initial ?? 'aloha');
    setCartons(0);
    setReason('');
    setNote('');
  }, [open, initial]);

  const s = stock.find((x) => x.flavour === flavour);
  const inStockCartons = Math.floor((s?.inStock ?? 0) / UNITS_PER_CARTON);
  const afterUnits = (s?.inStock ?? 0) + cartons * UNITS_PER_CARTON;
  const adjust = useAction(() => api.post('/inventory/adjustments', { flavour, cartons, reason, note: note.trim() || undefined }), {
    success: t('adjust.done', { flavour: flavour.toUpperCase(), n: cartons > 0 ? `+${cartons}` : String(cartons) }),
    onDone: onClose,
  });
  const needsNote = reason === 'other' && !note.trim();

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('adjust.title')}
      dirty={cartons !== 0}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={cartons === 0 || !reason || needsNote || afterUnits < 0} busy={adjust.isPending} onClick={() => adjust.mutate(undefined)}>
            {t('adjust.cta')}
          </Button>
        </>
      }
    >
      <div className="an-field">
        <label>{tc('flavour')}</label>
        <Segmented fill label={tc('flavour')} value={flavour} onChange={(f) => { setFlavour(f); setCartons(0); }} options={FLAVOURS.map((f) => ({ value: f, label: f.toUpperCase() }))} />
      </div>
      <div className="an-field">
        <label>{t('adjust.change')}</label>
        <div className="row">
          <Stepper value={cartons} onChange={setCartons} min={-inStockCartons} label={t('adjust.change')} />
          <span className="body-sm muted">{tc('unitsCount', { n: num(cartons * UNITS_PER_CARTON) })}</span>
        </div>
        <span className={`an-help ${adjust.fields.cartons ? 'error' : ''}`}>{adjust.fields.cartons ?? t('adjust.changeHelp')}</span>
      </div>
      <ReasonChips reasons={REASONS.adjustment} value={reason} onChange={setReason} label={tc('reason')} ns="adjustment" />
      <TextArea label={reason === 'other' ? tc('note') : tc('noteOptional')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      <Totals lines={[[t('adjust.inStockNow'), tc('cartonsUnits', { c: num(inStockCartons), u: num(s?.inStock ?? 0) })]]} big={[t('adjust.inStockAfter'), tc('cartonsUnits', { c: num(Math.floor(afterUnits / UNITS_PER_CARTON)), u: num(afterUnits) })]} />
      <p className="body-sm muted">{t('adjust.consequence')}</p>
      {adjust.errorText && !adjust.fields.cartons && <Banner tone="bad">{adjust.errorText}</Banner>}
    </Sheet>
  );
}
