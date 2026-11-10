'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FLAVOURS, UNITS_PER_CARTON, type CartonsByFlavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useFmt } from '@/lib/format';
import { Banner, Button, CartonsEditor, Segmented, Select, Sheet } from '@/components/ui';
import type { EventDetail } from './types';

const total = (c: CartonsByFlavour) => FLAVOURS.reduce((s, f) => s + (c[f] ?? 0), 0);
const fieldError = (fields: Record<string, string>) => Object.entries(fields).find(([k]) => k.startsWith('cartons'))?.[1];

/** Move cartons to the event or back to the warehouse (FR-EVT-3). */
export function MoveStockSheet({ data, direction, onDirection, open, onClose }: { data: EventDetail; direction: 'to_event' | 'back'; onDirection: (d: 'to_event' | 'back') => void; open: boolean; onClose: () => void }) {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const { num } = useFmt();
  const [cartons, setCartons] = useState<CartonsByFlavour>({});
  useEffect(() => setCartons({}), [open, direction]);
  const max: CartonsByFlavour =
    direction === 'to_event' ? (data.warehouseAvailableCartons ?? {}) : Object.fromEntries(data.stock.map((s) => [s.flavour, s.cartons]));
  const act = useAction(() => api.post<{ cartons: number }>(`/events/${data.event.id}/stock`, { direction, cartons }), {
    success: (r) => (direction === 'to_event' ? t('move.doneTo', { n: r.cartons, name: data.event.name }) : t('move.doneBack', { n: r.cartons })),
    onDone: onClose,
  });
  if (!open) return null;
  const n = total(cartons);
  const err = fieldError(act.fields);
  return (
    <Sheet
      open
      onClose={onClose}
      dirty={n > 0}
      title={direction === 'to_event' ? t('move.titleTo') : t('move.titleBack')}
      sub={data.event.name}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" busy={act.isPending} disabled={n === 0} onClick={() => act.mutate(undefined)}>
            {direction === 'to_event' ? t('move.submitTo') : t('move.submitBack')}
          </Button>
        </>
      }
    >
      <Segmented
        fill
        label={t('move.direction')}
        value={direction}
        onChange={onDirection}
        options={[
          { value: 'to_event', label: t('move.to') },
          { value: 'back', label: t('move.back') },
        ]}
      />
      <span className="body-sm muted">{direction === 'to_event' ? t('move.helpTo') : t('move.helpBack')}</span>
      <CartonsEditor value={cartons} onChange={setCartons} max={max} />
      <div className="row between body-sm">
        <span className="muted">{tc('total')}</span>
        <bdi className="strong num">{t('move.total', { n, u: num(n * UNITS_PER_CARTON) })}</bdi>
      </div>
      {err && <span className="an-help error">{err}</span>}
      {act.errorText && <Banner tone="bad">{act.errorText}</Banner>}
    </Sheet>
  );
}

/** Cartons sold at the event by an invited agent. */
export function SaleSheet({ data, open, onClose }: { data: EventDetail; open: boolean; onClose: () => void }) {
  const t = useTranslations('events');
  const tc = useTranslations('common');
  const { num, money } = useFmt();
  const [agentId, setAgentId] = useState('');
  const [cartons, setCartons] = useState<CartonsByFlavour>({});
  useEffect(() => {
    setCartons({});
    setAgentId(data.agents.length === 1 ? data.agents[0].id : '');
    // Reset only when the sheet opens, not on every background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const max: CartonsByFlavour = Object.fromEntries(data.stock.map((s) => [s.flavour, s.cartons]));
  const name = data.agents.find((a) => a.id === agentId)?.name ?? '';
  const act = useAction(() => api.post<{ cartons: number; commissionCents: number }>(`/events/${data.event.id}/sales`, { agentId, cartons }), {
    success: (r) => t('sale.done', { n: r.cartons, name, amount: money(r.commissionCents) }),
    onDone: onClose,
  });
  if (!open) return null;
  const n = total(cartons);
  const err = fieldError(act.fields);
  return (
    <Sheet
      open
      onClose={onClose}
      dirty={n > 0}
      title={t('sale.title')}
      sub={data.event.name}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" busy={act.isPending} disabled={n === 0 || !agentId} onClick={() => act.mutate(undefined)}>
            {t('sale.submit')}
          </Button>
        </>
      }
    >
      {data.agents.length === 0 ? (
        <Banner>{t('sale.noAgents')}</Banner>
      ) : (
        <>
          <Select label={t('sale.agent')} value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder={t('sale.agentPlaceholder')} options={data.agents.map((a) => ({ value: a.id, label: a.name }))} error={act.fields.agentId} />
          <span className="body-sm muted">{t('sale.help')}</span>
          <CartonsEditor value={cartons} onChange={setCartons} max={max} only={data.stock.filter((s) => s.cartons > 0).map((s) => s.flavour)} />
          <div className="row between body-sm">
            <span className="muted">{tc('total')}</span>
            <bdi className="strong num">{t('move.total', { n, u: num(n * UNITS_PER_CARTON) })}</bdi>
          </div>
          {err && <span className="an-help error">{err}</span>}
        </>
      )}
      {act.errorText && <Banner tone="bad">{act.errorText}</Banner>}
    </Sheet>
  );
}
