'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { Banner, Button, EmptyState, FlavourName, Sheet, Skeleton, Table, type Column } from '@/components/ui';
import { CheckRow } from './Check';
import type { AllocationData } from './types';

type ByFlavour = Record<Flavour, number>;

/** Oldest first while the stock lasts (decision A7); an order that does not fit is skipped. */
function preselect(d: AllocationData): Set<string> {
  const left = { ...d.available };
  const out = new Set<string>();
  for (const o of d.orders) {
    if (o.lines.every((l) => left[l.flavour] >= l.units)) {
      for (const l of o.lines) left[l.flavour] -= l.units;
      out.add(o.id);
    }
  }
  return out;
}

/** FR-INV-3 Allocate: available, needed, waiting orders oldest first and stock after allocation. */
export function AllocateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const { num, dateShort } = useFmt();
  const q = useQuery({ queryKey: ['inventory', 'allocation'], queryFn: () => api.get<AllocationData>('/inventory/allocation'), enabled: open });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) setReady(false);
    else if (q.data && !ready) {
      setPicked(preselect(q.data));
      setReady(true);
    }
  }, [open, q.data, ready]);

  const after = useMemo(() => {
    const out = { ...(q.data?.available ?? { aloha: 0, gaia: 0, santorini: 0, kyoto: 0 }) } as ByFlavour;
    for (const o of q.data?.orders ?? []) if (picked.has(o.id)) for (const l of o.lines) out[l.flavour] -= l.units;
    return out;
  }, [q.data, picked]);
  const short = FLAVOURS.filter((f) => after[f] < 0);

  const allocate = useAction(() => api.post<{ allocated: string[] }>('/inventory/allocate', { orderIds: (q.data?.orders ?? []).filter((o) => picked.has(o.id)).map((o) => o.id) }), {
    success: (r) => t('allocate.done', { n: r.allocated.length }),
    onDone: onClose,
  });

  const flavoursIn = FLAVOURS.filter((f) => (q.data?.unitsNeeded[f] ?? 0) > 0);
  const rows = flavoursIn.map((f) => ({ flavour: f, available: q.data!.available[f], needed: q.data!.unitsNeeded[f], after: after[f] }));
  const cols: Column<(typeof rows)[number]>[] = [
    { key: 'f', header: tc('flavour'), render: (r) => <FlavourName flavour={r.flavour} /> },
    { key: 'a', header: t('allocate.available'), type: 'count', render: (r) => num(r.available) },
    { key: 'n', header: t('allocate.needed'), type: 'count', render: (r) => num(r.needed) },
    { key: 'r', header: t('allocate.after'), type: 'count', render: (r) => <span className={r.after < 0 ? 'bad' : ''}>{num(r.after)}</span> },
  ];
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('allocate.title')}
      sub={q.data ? t('allocate.sub', { n: q.data.orders.length }) : undefined}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={picked.size === 0 || short.length > 0} busy={allocate.isPending} onClick={() => allocate.mutate(undefined)}>
            {t('allocate.cta', { n: picked.size })}
          </Button>
        </>
      }
    >
      {q.isLoading ? (
        <Skeleton h={200} />
      ) : !q.data || q.data.orders.length === 0 ? (
        <EmptyState done title={t('allocate.emptyTitle')} text={t('allocate.emptyText')} />
      ) : (
        <>
          <Table columns={cols} rows={rows} rowKey={(r) => r.flavour} />
          <div className="stack tight">
            <span className="overline">{t('allocate.orders')}</span>
            {q.data.orders.map((o) => (
              <CheckRow
                key={o.id}
                checked={picked.has(o.id)}
                onChange={(v) => toggle(o.id, v)}
                title={<bdi>{o.customerName ?? o.number}</bdi>}
                sub={
                  <>
                    <bdi>{o.number}</bdi>
                    {o.paidAt && ` · ${t('allocate.paidOn', { date: dateShort(o.paidAt) })}`}
                    {o.agentName && ` · ${o.agentName}`}
                    {' · '}
                    {o.lines.map((l) => `${l.flavour.toUpperCase()} ${num(l.cartons)}`).join(', ')}
                  </>
                }
                end={t('allocate.units', { n: num(o.units) })}
              />
            ))}
          </div>
          {short.length > 0 && <Banner tone="bad">{t('allocate.short', { flavours: short.map((f) => f.toUpperCase()).join(', ') })}</Banner>}
          <p className="body-sm muted">{t('allocate.consequence')}</p>
          {allocate.errorText && <Banner tone="bad">{allocate.errorText}</Banner>}
        </>
      )}
    </Sheet>
  );
}
