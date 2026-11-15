'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, UNITS_PER_CARTON, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { ActionError, Banner, Button, Check, EmptyState, Icon, Lock, Package, Pill, Sheet, Skeleton } from '@/components/ui';
import type { AllocationData, InventoryOverview } from './types';
import css from '../inventory.module.css';

type ByFlavour = Record<Flavour, number>;
type Order = AllocationData['orders'][number];

/** Paid orders first, then the oldest; each order gets all its cartons, so nothing ships half-filled. */
function sorted(d: AllocationData): Order[] {
  const time = (o: Order) => (o.since ? Date.parse(o.since) : 0);
  return [...d.orders].sort((a, b) => Number(!!b.paidAt) - Number(!!a.paidAt) || time(a) - time(b));
}

/** Suggested ticks: in the suggested order while the stock lasts; an order that does not fit is skipped. */
function preselect(d: AllocationData): Set<string> {
  const left = { ...d.available };
  const out = new Set<string>();
  for (const o of sorted(d)) {
    if (o.lines.every((l) => left[l.flavour] >= l.units)) {
      for (const l of o.lines) left[l.flavour] -= l.units;
      out.add(o.id);
    }
  }
  return out;
}

/**
 * Allocate: shown only when orders wait; enabled only when stock can cover one; says why when it can't.
 */
export function AllocateButton({ waiting, next, onOpen }: { waiting: InventoryOverview['waiting']; next: InventoryOverview['nextPurchase']; onOpen: () => void }) {
  const t = useTranslations('inventory');
  const n = waiting.orders;
  if (!n) return null;
  if (!waiting.canAllocate) {
    const why = next ? t('allocate.lockedWhy', { number: next.number }) : t('allocate.lockedWhyNone');
    return (
      <Button size="sm" icon={Lock} disabled title={why} aria-label={`${next ? t('allocate.locked', { n, number: next.number }) : t('allocate.lockedNone', { n })}. ${why}`}>
        {next ? t('allocate.locked', { n, number: next.number }) : t('allocate.lockedNone', { n })}
      </Button>
    );
  }
  return (
    <Button size="sm" variant="primary" icon={Package} onClick={onOpen}>
      {t('allocate.open', { n })}
    </Button>
  );
}

/** FR-INV-3 Allocate: tick which waiting orders get the stock; cartons used per flavour update as you tick. */
export function AllocateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('inventory');
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

  const used = useMemo(() => {
    const out: ByFlavour = { aloha: 0, gaia: 0, santorini: 0, kyoto: 0 };
    for (const o of q.data?.orders ?? []) if (picked.has(o.id)) for (const l of o.lines) out[l.flavour] += l.cartons;
    return out;
  }, [q.data, picked]);
  const availCartons = (f: Flavour) => Math.floor((q.data?.available[f] ?? 0) / UNITS_PER_CARTON);
  const short = FLAVOURS.filter((f) => used[f] > availCartons(f));

  const allocate = useAction(() => api.post<{ allocated: string[] }>('/inventory/allocate', { orderIds: sorted(q.data!).filter((o) => picked.has(o.id)).map((o) => o.id) }), {
    success: (r) => t('allocate.done', { n: r.allocated.length }),
    onDone: onClose,
  });

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const d = q.data;

  return (
    <Sheet open={open} onClose={onClose} title={d?.fromPurchase ? t('allocate.titleFrom', { number: d.fromPurchase }) : t('allocate.title')}>
      {q.isLoading ? (
        <Skeleton h={200} />
      ) : !d || d.orders.length === 0 ? (
        <EmptyState done title={t('allocate.emptyTitle')} text={t('allocate.emptyText')} />
      ) : (
        <>
          <p className={`body-sm muted ${css.para}`}>
            {t('allocate.intro')}
          </p>
          {sorted(d).map((o) => {
            const on = picked.has(o.id);
            const cartons = o.lines.reduce((s, l) => s + l.cartons, 0);
            return (
              <button
                key={o.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(o.id)}
                className={`${css.box} ${css.opt} ${on ? css.optOn : ''}`}
              >
                <span className={`row ${css.optMain}`}>
                  <span aria-hidden className={`${css.check} ${on ? css.checkOn : ''}`}>
                    {on && <Icon as={Check} size="sm" />}
                  </span>
                  <bdi className={`body-strong ${css.optName}`}>{o.customerName ?? o.number}</bdi>
                </span>
                <span className={`body-sm strong ${css.optEnd}`}>{t('allocate.cartons', { n: num(cartons) })}</span>
                <span className={`body-sm muted ${css.optSub}`}>
                  <bdi>{o.number}</bdi>
                  {o.since && ` · ${t('allocate.since', { date: dateShort(o.since) })}`}
                </span>
                <span className={css.optEnd}>{o.paidAt ? <Pill tone="good">{t('allocate.paid')}</Pill> : <Pill tone="warn">{t('allocate.notPaid')}</Pill>}</span>
              </button>
            );
          })}
          <div className={`${css.box} ${css.avail}`}>
            <span className="overline">{d.fromPurchase ? t('allocate.fromCartons', { number: d.fromPurchase }) : t('allocate.availableCartons')}</span>
            {FLAVOURS.map((f) => (
              <div key={f} className="row between body">
                <span className="row">
                  <i aria-hidden className={`${css.dot} ${css[f]}`} />
                  {f.toUpperCase()}
                </span>
                <span className={used[f] > availCartons(f) ? 'bad' : ''}>
                  <bdi>{t('allocate.usedOf', { used: num(used[f]), of: num(availCartons(f)) })}</bdi>
                  <span className="muted"> · {t('allocate.left', { n: num(availCartons(f) - used[f]) })}</span>
                </span>
              </div>
            ))}
          </div>
          {short.length > 0 && <Banner tone="bad">{t('allocate.short', { flavours: short.map((f) => f.toUpperCase()).join(', ') })}</Banner>}
          <p className={`caption muted ${css.para}`}>
            {t('allocate.consequence', { days: d.stockHoldDays })}
          </p>
          <ActionError action={allocate} />
          <Button variant="primary" block size="lg" disabled={picked.size === 0 || short.length > 0} busy={allocate.isPending} onClick={() => allocate.mutate(undefined)}>
            {t('allocate.cta', { n: picked.size })}
          </Button>
        </>
      )}
    </Sheet>
  );
}
