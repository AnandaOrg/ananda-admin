'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, type Flavour } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { Button, Card, ClockCounterClockwise, EmptyState, ErrorState, ListCard, Skeleton, Table, type Column } from '@/components/ui';

export interface Movement {
  id: string;
  at: string;
  flavours: Flavour[];
  lines: { flavour: Flavour; units: number }[];
  units: number;
  kind: string;
  reason: string | null;
  note: string | null;
  atEvent: boolean;
  by: string | null;
  orderId: string | null;
  orderNumber: string | null;
  customerName: string | null;
  purchaseId: string | null;
  purchaseNumber: string | null;
  eventName: string | null;
}

/** FR-INV-5: every change to stock, newest first (when, flavour, units ±, why, by). */
export function Movements() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const { num, date } = useFmt();
  const [limit, setLimit] = useState(100);
  const query = qs({ limit });
  const q = useQuery({ queryKey: ['inventory', 'movements', query], queryFn: () => api.get<{ items: Movement[]; next: string | null }>(`/inventory/movements${query}`), placeholderData: (prev) => prev });

  const signed = (n: number) => (n > 0 ? `+${num(n)}` : `−${num(Math.abs(n))}`);
  const flavours = (m: Movement) => (m.flavours.length === FLAVOURS.length ? t('movements.allFlavours') : m.flavours.map((f) => f.toUpperCase()).join(', '));
  const reason = (m: Movement) => {
    if (!m.reason) return null;
    if (t.has(`adjust.reasons.${m.reason}`)) return t(`adjust.reasons.${m.reason}`);
    if (tc.has(`reasons.adjustment.${m.reason}`)) return tc(`reasons.adjustment.${m.reason}`);
    return m.reason;
  };
  const ref = (m: Movement) => (m.orderNumber || m.purchaseNumber ? <bdi>{m.orderNumber ?? m.purchaseNumber}</bdi> : null);
  const why = (m: Movement) => {
    const r = ref(m);
    const ev = m.eventName ? <bdi>{m.eventName}</bdi> : null;
    switch (m.kind) {
      case 'purchase_receipt':
        return t.rich('movements.why.received', { ref: () => r });
      case 'dispatch':
        return (
          <>
            {t.rich('movements.why.shipped', { ref: () => r })}
            {m.customerName && (
              <>
                {' · '}
                <bdi>{m.customerName}</bdi>
              </>
            )}
          </>
        );
      case 'return':
        return t.rich('movements.why.returned', { ref: () => r });
      case 'credit_return':
        return t.rich('movements.why.creditReturn', { ref: () => r });
      case 'event_out':
        return t.rich('movements.why.toEvent', { ev: () => ev });
      case 'event_in':
        return t.rich('movements.why.fromEvent', { ev: () => ev });
      case 'event_sale':
        return t.rich('movements.why.eventSale', { ev: () => ev });
      default: {
        // Adjustments: the reason, then the note (a count adjustment notes which count it came from).
        const parts = [reason(m) ?? t('kinds.adjustment'), m.note].filter(Boolean);
        return parts.join(' · ');
      }
    }
  };

  const cols: Column<Movement>[] = [
    { key: 'when', header: t('movements.when'), type: 'date', render: (m) => <bdi>{date(m.at)}</bdi> },
    { key: 'flavour', header: tc('flavour'), render: flavours },
    { key: 'units', header: tc('units'), type: 'count', render: (m) => <bdi className={m.units < 0 ? 'bad' : 'good'}>{signed(m.units)}</bdi> },
    { key: 'why', header: t('movements.whyCol'), main: true, render: why },
    { key: 'by', header: t('movements.by'), render: (m) => (m.by ? <bdi>{m.by}</bdi> : <span className="muted">{t('movements.system')}</span>) },
  ];
  const items = q.data?.items ?? [];

  if (q.isLoading) return <Skeleton h={320} />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (items.length === 0)
    return (
      <Card>
        <EmptyState icon={ClockCounterClockwise} title={t('movements.emptyTitle')} text={t('movements.emptyText')} />
      </Card>
    );
  return (
    <>
      <Card flush className="only-wide">
        <Table columns={cols} rows={items} rowKey={(m) => m.id} />
      </Card>
      <div className="list-cards only-phone">
        {items.map((m) => (
          <ListCard
            key={m.id}
            title={why(m)}
            amount={<span className={m.units < 0 ? 'bad' : 'good'}>{signed(m.units)}</span>}
            sub={
              <>
                {date(m.at)} · {flavours(m)}
                {m.by && (
                  <>
                    {' · '}
                    <bdi>{m.by}</bdi>
                  </>
                )}
              </>
            }
          />
        ))}
      </div>
      {q.data?.next && limit < 500 && (
        <div className="row end">
          <Button busy={q.isFetching} onClick={() => setLimit(limit + 100)}>
            {t('movements.more')}
          </Button>
        </div>
      )}
    </>
  );
}
