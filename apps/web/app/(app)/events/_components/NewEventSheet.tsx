'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { isoDate } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Banner, Button, Segmented, Sheet, Switch, TextField } from '@/components/ui';
import type { EventKind } from './types';

/** New event (FR-EVT-2): name, from, to, place, type and invited agents. */
export function NewEventSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const router = useRouter();
  const today = isoDate();
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [place, setPlace] = useState('');
  const [kind, setKind] = useState<EventKind>('event');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const agents = useQuery({ queryKey: ['agents-list'], queryFn: () => api.get<{ id: string; name: string }[]>('/customers/agents'), enabled: open });
  useEffect(() => {
    if (!open) return;
    setName('');
    setStartsOn(today);
    setEndsOn(today);
    setPlace('');
    setKind('event');
    setAgentIds([]);
  }, [open, today]);
  const act = useAction(() => api.post<{ id: string }>('/events', { name, startsOn, endsOn, place, kind, agentIds }), {
    success: () => t('form.created', { name }),
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
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" busy={act.isPending} disabled={!name.trim() || !place.trim() || !startsOn || !endsOn} onClick={() => act.mutate(undefined)}>
            {t('form.create')}
          </Button>
        </>
      }
    >
      <TextField label={t('form.name')} value={name} onChange={(e) => setName(e.target.value)} error={f.name} />
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
      <TextField label={t('form.place')} value={place} onChange={(e) => setPlace(e.target.value)} error={f.place} />
      <div className="an-field">
        <label>{t('form.kind')}</label>
        <Segmented fill label={t('form.kind')} value={kind} onChange={setKind} options={(['event', 'festival'] as const).map((k) => ({ value: k, label: t(`kind.${k}`) }))} />
      </div>
      <div className="an-field">
        <label>{t('form.agents')}</label>
        <span className="an-help">{t('form.agentsHelp')}</span>
        <div className="stack tight">
          {(agents.data ?? []).map((a) => (
            <Switch key={a.id} label={a.name} checked={agentIds.includes(a.id)} onChange={(on) => setAgentIds((x) => (on ? [...x, a.id] : x.filter((y) => y !== a.id)))} />
          ))}
          {agents.isSuccess && agents.data.length === 0 && <span className="body-sm muted">{t('form.noAgents')}</span>}
        </div>
        {f.agentIds && <span className="an-help error">{f.agentIds}</span>}
      </div>
      {act.errorText && <Banner tone="bad">{act.errorText}</Banner>}
    </Sheet>
  );
}
