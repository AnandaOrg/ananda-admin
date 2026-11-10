'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FLAVOURS, REASONS, UNITS_PER_CARTON, type CartonsByFlavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { Banner, Button, Camera, CartonsEditor, FlavourRows, ReasonChips, Sheet, TextArea } from '@/components/ui';
import { PhotoCapture, type PhotoCaptureHandle } from './PhotoCapture';
import type { ShipCard } from './types';

/** Upload signed note (FR-WH-3): photo → preview → Retake or Use photo. The order becomes Delivered. */
export function SignedNoteSheet({ order, onClose }: { order: ShipCard | null; onClose: () => void }) {
  const t = useTranslations('warehouse');
  const tc = useTranslations('common');
  const [file, setFile] = useState<File | null>(null);
  const cam = useRef<PhotoCaptureHandle>(null);
  useEffect(() => setFile(null), [order?.id]);
  const act = useAction((fd: FormData) => api.post(`/warehouse/orders/${order!.id}/signed-note`, fd), {
    success: () => t('note.done', { number: order?.number ?? '' }),
    onDone: onClose,
  });
  if (!order) return null;
  const submit = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    act.mutate(fd);
  };
  return (
    <Sheet
      open
      onClose={onClose}
      dirty={!!file}
      title={t('note.title')}
      sub={
        <>
          <bdi>{order.number}</bdi> · {order.customerName}
        </>
      }
      footer={
        file ? (
          <>
            <Button icon={Camera} onClick={() => cam.current?.open()} disabled={act.isPending}>
              {t('photo.retake')}
            </Button>
            <Button variant="primary" onClick={submit} busy={act.isPending}>
              {t('photo.use')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{tc('cancel')}</Button>
        )
      }
    >
      <PhotoCapture ref={cam} file={file} onFile={setFile} error={act.fields.file} />
      {act.errorText && !act.fields.file && <Banner tone="bad">{act.errorText}</Banner>}
    </Sheet>
  );
}

/**
 * Delivered in part (FR-WH-4): cartons kept per flavour (up to what was sent), the reason, a
 * summary of cartons coming back, then the signed-note photo. Facts only; an Admin decides (A6).
 */
export function PartDeliverySheet({ order, onClose }: { order: ShipCard | null; onClose: () => void }) {
  const t = useTranslations('warehouse');
  const tc = useTranslations('common');
  const { num } = useFmt();
  const [step, setStep] = useState<'facts' | 'photo'>('facts');
  const [kept, setKept] = useState<CartonsByFlavour>({});
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const cam = useRef<PhotoCaptureHandle>(null);

  const sent: CartonsByFlavour = Object.fromEntries((order?.lines ?? []).map((l) => [l.flavour, l.cartons]));
  useEffect(() => {
    setStep('facts');
    setKept(Object.fromEntries((order?.lines ?? []).map((l) => [l.flavour, l.cartons])));
    setReason('');
    setNote('');
    setFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const back: CartonsByFlavour = Object.fromEntries(FLAVOURS.map((f) => [f, Math.max(0, (sent[f] ?? 0) - (kept[f] ?? 0))]));
  const backTotal = FLAVOURS.reduce((s, f) => s + (back[f] ?? 0), 0);

  const act = useAction((fd: FormData) => api.post<{ returnedCartons: number }>(`/warehouse/orders/${order!.id}/part-delivery`, fd), {
    success: (r) => t('part.done', { number: order?.number ?? '', n: r.returnedCartons }),
    onDone: onClose,
  });
  useEffect(() => {
    // A field problem from the server belongs to the first step.
    if (Object.keys(act.fields).some((k) => k.startsWith('kept') || k === 'reason')) setStep('facts');
  }, [act.fields]);
  if (!order) return null;

  const submit = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('kept', JSON.stringify(Object.fromEntries(FLAVOURS.filter((f) => sent[f] != null).map((f) => [f, kept[f] ?? 0]))));
    fd.append('reason', reason);
    if (note.trim()) fd.append('note', note.trim());
    fd.append('file', file);
    act.mutate(fd);
  };
  const keptError = Object.entries(act.fields).find(([k]) => k.startsWith('kept'))?.[1];

  return (
    <Sheet
      open
      onClose={onClose}
      dirty
      title={t('part.title')}
      sub={
        <>
          <bdi>{order.number}</bdi> · {order.customerName}
        </>
      }
      footer={
        step === 'facts' ? (
          <>
            <Button onClick={onClose}>{tc('cancel')}</Button>
            <Button variant="primary" onClick={() => setStep('photo')} disabled={!reason || backTotal === 0}>
              {t('part.continue')}
            </Button>
          </>
        ) : file ? (
          <>
            <Button icon={Camera} onClick={() => cam.current?.open()} disabled={act.isPending}>
              {t('photo.retake')}
            </Button>
            <Button variant="primary" onClick={submit} busy={act.isPending}>
              {t('part.send')}
            </Button>
          </>
        ) : (
          <Button onClick={() => setStep('facts')}>{tc('back')}</Button>
        )
      }
    >
      {step === 'facts' ? (
        <>
          <div className="an-field">
            <label>{t('part.keptLabel')}</label>
            <span className="an-help">{t('part.keptHelp')}</span>
          </div>
          <CartonsEditor value={kept} onChange={setKept} max={sent} only={FLAVOURS.filter((f) => sent[f] != null)} />
          {keptError && <span className="an-help error">{keptError}</span>}
          <ReasonChips reasons={REASONS.part_delivery} value={reason} onChange={setReason} label={t('part.reason')} ns="part_delivery" />
          {act.fields.reason && <span className="an-help error">{act.fields.reason}</span>}
          <TextArea label={t('part.note')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          <div className="stack tight">
            <span className="overline">{t('part.summary')}</span>
            {backTotal > 0 ? (
              <>
                <FlavourRows cartons={back} />
                <span className="body-sm strong">
                  {t('part.summaryTotal', { n: backTotal })} · {tc('unitsCount', { n: num(backTotal * UNITS_PER_CARTON) })}
                </span>
              </>
            ) : (
              <span className="body-sm muted">{t('part.summaryNone')}</span>
            )}
          </div>
          <Banner>{t('part.facts')}</Banner>
        </>
      ) : (
        <>
          <PhotoCapture ref={cam} file={file} onFile={setFile} error={act.fields.file} />
          {backTotal > 0 && <span className="body-sm muted">{t('part.summaryTotal', { n: backTotal })}</span>}
        </>
      )}
      {act.errorText && !keptError && !act.fields.file && <Banner tone="bad">{act.errorText}</Banner>}
    </Sheet>
  );
}
