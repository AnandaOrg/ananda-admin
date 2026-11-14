'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { isoDate } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Banner, Button, Sheet, TextField } from '@/components/ui';
import type { EventKind } from './types';

/** A row of choice chips; `multi` lets several be on at once. */
function PickChips({ label, options, isOn, onPick }: { label: string; options: { value: string; label: string }[]; isOn: (v: string) => boolean; onPick: (v: string) => void }) {
  return (
    <div className="an-chips" role="group" aria-label={label} style={{ flexWrap: 'wrap' }}>
      {options.map((o) => (
        <button key={o.value} type="button" className="an-chip" aria-pressed={isOn(o.value)} onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** New event (FR-EVT-2): name, from, to, place, type and invited brokers. */
export function NewEventSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const router = useRouter();
  const today = isoDate();
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [place, setPlace] = useState('');
  const [kind, setKind] = useState<EventKind | null>(null);
  const [brokerIds, setBrokerIds] = useState<string[]>([]);
  const brokers = useQuery({ queryKey: ['brokers-list'], queryFn: () => api.get<{ id: string; name: string }[]>('/customers/brokers'), enabled: open });
  useEffect(() => {
    if (!open) return;
    setName('');
    setStartsOn(today);
    setEndsOn(today);
    setPlace('');
    setKind(null);
    setBrokerIds([]);
  }, [open, today]);
  const act = useAction(() => api.post<{ id: string }>('/events', { name, startsOn, endsOn, place, kind, brokerIds }), {
    success: () => t('form.created'),
    onDone: (r) => {
      onClose();
      router.push(`/events/${r.id}`);
    },
  });
  if (!open) return null;
  const f = act.fields;
  return (
    <Sheet
      open
      onClose={onClose}
      dirty={!!(name || place)}
      title={t('form.title')}
      footer={
        <Button variant="primary" block size="lg" busy={act.isPending} disabled={!name.trim() || !place.trim() || !startsOn || !endsOn || !kind} onClick={() => act.mutate(undefined)}>
          {t('form.create')}
        </Button>
      }
    >
      <TextField label={t('form.name')} placeholder={t('form.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} error={f.name} />
      <div className="form-grid">
        <TextField
          label={t('form.from')}
          type="date"
          value={startsOn}
          onChange={(e) => {
            setStartsOn(e.target.value);
            if (endsOn < e.target.value) setEndsOn(e.target.value);
          }}
          error={f.startsOn}
        />
        <TextField label={t('form.to')} type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} error={f.endsOn} />
      </div>
      <TextField label={t('form.place')} placeholder={t('form.placePlaceholder')} value={place} onChange={(e) => setPlace(e.target.value)} error={f.place} />
      <span className="overline">{t('form.kind')}</span>
      <PickChips label={t('form.kind')} options={(['event', 'festival'] as const).map((k) => ({ value: k, label: t(`kind.${k}`) }))} isOn={(v) => v === kind} onPick={(v) => setKind(v as EventKind)} />
      {f.kind && <span className="an-help error">{f.kind}</span>}
      <span className="overline">{t('form.brokers')}</span>
      {brokers.isSuccess && brokers.data.length === 0 ? (
        <span className="body-sm muted">{t('form.noBrokers')}</span>
      ) : (
        <PickChips
          label={t('form.brokers')}
          options={(brokers.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
          isOn={(v) => brokerIds.includes(v)}
          onPick={(v) => setBrokerIds((x) => (x.includes(v) ? x.filter((y) => y !== v) : [...x, v]))}
        />
      )}
      {f.brokerIds && <span className="an-help error">{f.brokerIds}</span>}
      {act.errorText && <Banner tone="bad">{act.errorText}</Banner>}
    </Sheet>
  );
}
