'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FLAVOURS, type CartonsByFlavour, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Banner, Button, Camera, FLAVOUR_VAR, Sheet, Stepper } from '@/components/ui';
import { PhotoCapture, type PhotoCaptureHandle } from './PhotoCapture';
import { noteUrl, type DeliveredRow, type ShipCard } from './types';

/** Footer for the photo step: Take photo, then Retake or Use photo. */
function PhotoFooter({ file, cam, busy, onUse }: { file: File | null; cam: React.RefObject<PhotoCaptureHandle | null>; busy: boolean; onUse: () => void }) {
  const t = useTranslations('warehouse');
  return file ? (
    <>
      <Button onClick={() => cam.current?.open()} disabled={busy} style={{ flex: '1 1 0' }}>
        {t('photo.retake')}
      </Button>
      <Button variant="primary" onClick={onUse} busy={busy} style={{ flex: '1 1 0' }}>
        {t('photo.use')}
      </Button>
    </>
  ) : (
    <Button variant="primary" block icon={Camera} onClick={() => cam.current?.open()}>
      {t('photo.take')}
    </Button>
  );
}

/** Upload signed note (FR-WH-3): photo → preview → Retake or Use photo. The order becomes Delivered. */
export function SignedNoteSheet({ order, onClose }: { order: ShipCard | null; onClose: () => void }) {
  const t = useTranslations('warehouse');
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
    <Sheet open onClose={onClose} dirty={!!file} title={t('photo.title')} sub={t('photo.sub', { customer: order.customerName, n: order.totalCartons })} footer={<PhotoFooter file={file} cam={cam} busy={act.isPending} onUse={submit} />}>
      <PhotoCapture ref={cam} file={file} onFile={setFile} error={act.fields.file} />
      {act.errorText && !act.fields.file && <Banner tone="bad">{act.errorText}</Banner>}
    </Sheet>
  );
}

/** One flavour with a stepper and a line under its name ("of 20 cartons", "480 units"). */
export function StepRow({ flavour, value, onChange, max, sub, label }: { flavour: Flavour; value: number; onChange: (n: number) => void; max?: number; sub: string; label: string }) {
  return (
    <div className="an-flav">
      <i className="dot" style={{ background: FLAVOUR_VAR[flavour] }} aria-hidden />
      <span className="nm">{flavour.toUpperCase()}</span>
      <Stepper value={value} onChange={onChange} max={max} label={label} />
      <span className="u">{sub}</span>
    </div>
  );
}

/**
 * Delivered in part (FR-WH-4): the cartons delivered now, per flavour (up to what is left); then the
 * signed note for them. The rest stays in To ship and goes out later on its own note.
 */
export function PartDeliverySheet({ order, onClose }: { order: ShipCard | null; onClose: () => void }) {
  const t = useTranslations('warehouse');
  const tc = useTranslations('common');
  const [step, setStep] = useState<'qty' | 'photo'>('qty');
  const [now, setNow] = useState<CartonsByFlavour>({});
  const [file, setFile] = useState<File | null>(null);
  const cam = useRef<PhotoCaptureHandle>(null);

  const left: CartonsByFlavour = Object.fromEntries((order?.lines ?? []).map((l) => [l.flavour, l.cartons]));
  useEffect(() => {
    setStep('qty');
    setNow(Object.fromEntries((order?.lines ?? []).map((l) => [l.flavour, l.cartons])));
    setFile(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const total = FLAVOURS.reduce((s, f) => s + (now[f] ?? 0), 0);
  const leftTotal = FLAVOURS.reduce((s, f) => s + (left[f] ?? 0), 0);

  const act = useAction((fd: FormData) => api.post<{ stayCartons: number }>(`/warehouse/orders/${order!.id}/part-delivery`, fd), {
    success: (r) => (r.stayCartons > 0 ? t('part.done', { n: r.stayCartons }) : t('note.done', { number: order?.number ?? '' })),
    onDone: onClose,
  });
  useEffect(() => {
    // A quantity problem from the server belongs to the first step.
    if (Object.keys(act.fields).some((k) => k.startsWith('delivered'))) setStep('qty');
  }, [act.fields]);
  if (!order) return null;

  const submit = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append('delivered', JSON.stringify(Object.fromEntries(FLAVOURS.filter((f) => left[f] != null).map((f) => [f, now[f] ?? 0]))));
    fd.append('file', file);
    act.mutate(fd);
  };
  const qtyError = Object.entries(act.fields).find(([k]) => k.startsWith('delivered'))?.[1];

  return step === 'qty' ? (
    <Sheet
      open
      onClose={onClose}
      title={t('part.title')}
      sub={t('part.sub', { customer: order.customerName, number: order.number })}
      footer={
        <Button variant="primary" block onClick={() => setStep('photo')} disabled={total === 0}>
          {t('part.next')}
        </Button>
      }
    >
      <div className="stack tight">
        {order.lines.map((l) => (
          <StepRow key={l.flavour} flavour={l.flavour} value={now[l.flavour] ?? 0} max={l.cartons} onChange={(n) => setNow({ ...now, [l.flavour]: n })} sub={t('part.of', { n: l.cartons })} label={tc('cartonsOf', { flavour: l.flavour.toUpperCase() })} />
        ))}
      </div>
      {qtyError && <span className="an-help error">{qtyError}</span>}
    </Sheet>
  ) : (
    <Sheet
      open
      onClose={onClose}
      dirty={!!file}
      title={t('photo.title')}
      sub={total < leftTotal ? t('photo.subPart', { customer: order.customerName, n: total }) : t('photo.sub', { customer: order.customerName, n: total })}
      footer={<PhotoFooter file={file} cam={cam} busy={act.isPending} onUse={submit} />}
    >
      <PhotoCapture ref={cam} file={file} onFile={setFile} error={act.fields.file} />
      {act.errorText && !qtyError && !act.fields.file && <Banner tone="bad">{act.errorText}</Banner>}
    </Sheet>
  );
}

/** The signed delivery note of one delivery, opened from Delivered (phone) or the eye (desktop). */
export function NoteViewSheet({ row, onClose }: { row: DeliveredRow | null; onClose: () => void }) {
  const t = useTranslations('warehouse');
  if (!row || !row.signedNoteId) return null;
  const url = noteUrl(row.signedNoteId);
  const image = (row.mimeType ?? '').startsWith('image/');
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('note.view')}
      sub={
        <>
          {row.customerName} · <bdi>{row.number}</bdi>
        </>
      }
      footer={
        <a className="an-btn secondary" href={url} target="_blank" rel="noreferrer" style={{ flex: '1 1 0' }}>
          {t('note.open')}
        </a>
      }
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={t('photo.previewAlt')} className="photo-preview" />
      ) : (
        <iframe src={url} title={t('note.view')} style={{ width: '100%', height: '60dvh', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', background: 'var(--paper-bg)' }} />
      )}
    </Sheet>
  );
}
