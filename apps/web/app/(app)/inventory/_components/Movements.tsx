'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, STOCK_MOVEMENT_KINDS, type Flavour } from '@ananda/shared';
import { api, qs } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { Button, Card, ClockCounterClockwise, EmptyState, ErrorState, FlavourName, ListCard, SelectPill, Skeleton, SlidersHorizontal, Table, Tag, type Column } from '@/components/ui';

interface Movement {
  id: string;
  at: string;
  flavour: Flavour;
  units: number;
  kind: string;
  reason: string | null;
  note: string | null;
  atEvent: boolean;
  by: string | null;
  orderId: string | null;
  orderNumber: string | null;
  purchaseId: string | null;
  purchaseNumber: string | null;
  eventName: string | null;
}

/** FR-INV-5: ledger newest first (when, flavour, units ±, why, by whom). */
export function Movements() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const { num, dateTime, dateShort } = useFmt();
  const [flavour, setFlavour] = useState<Flavour | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);
  const query = qs({ flavour, kind, limit });
  const q = useQuery({ queryKey: ['inventory', 'movements', query], queryFn: () => api.get<{ items: Movement[]; next: string | null }>(`/inventory/movements${query}`), placeholderData: (prev) => prev });

  const signed = (n: number) => (n > 0 ? `+${num(n)}` : num(n));
  const why = (m: Movement) => {
    const base = t(`kinds.${m.kind}`);
    const ref = m.orderNumber ? (
      <Link href={`/sales/${m.orderId}`} className="link">
        <bdi>{m.orderNumber}</bdi>
      </Link>
    ) : m.purchaseNumber ? (
      <Link href={`/purchasing/${m.purchaseId}`} className="link">
        <bdi>{m.purchaseNumber}</bdi>
      </Link>
    ) : m.eventName ? (
      <bdi>{m.eventName}</bdi>
    ) : null;
    // Only adjustment reasons are shown; other modules store technical keys there.
    const reason = m.kind === 'adjustment' && m.reason ? (tc.has(`reasons.adjustment.${m.reason}`) ? tc(`reasons.adjustment.${m.reason}`) : m.reason) : null;
    const note = m.note && m.note !== m.purchaseNumber && m.note !== m.orderNumber ? m.note : null;
    return (
      <>
        <span>
          {base}
          {ref && <> · {ref}</>}
          {reason && ` · ${reason}`}
          {m.atEvent && ` · ${t('movements.eventStock')}`}
        </span>
        {note && <span className="sb">{note}</span>}
      </>
    );
  };

  const cols: Column<Movement>[] = [
    { key: 'when', header: t('movements.when'), render: (m) => <span className="nowrap">{dateTime(m.at)}</span> },
    { key: 'flavour', header: tc('flavour'), render: (m) => <FlavourName flavour={m.flavour} /> },
    { key: 'units', header: tc('units'), type: 'count', render: (m) => <bdi className={m.units < 0 ? '' : 'good'}>{signed(m.units)}</bdi> },
    { key: 'why', header: t('movements.why'), render: why },
    { key: 'by', header: t('movements.by'), render: (m) => m.by ?? <span className="muted">{t('movements.system')}</span> },
  ];
  const items = q.data?.items ?? [];

  return (
    <>
      <div className="toolbar">
        <SelectPill
          icon={Tag}
          label={tc('flavour')}
          value={flavour ? flavour.toUpperCase() : t('movements.anyFlavour')}
          items={[{ key: 'any', label: t('movements.anyFlavour'), selected: !flavour, onSelect: () => setFlavour(null) }, ...FLAVOURS.map((f) => ({ key: f, label: f.toUpperCase(), selected: f === flavour, onSelect: () => setFlavour(f) }))]}
        />
        <SelectPill
          icon={SlidersHorizontal}
          label={t('movements.why')}
          value={kind ? t(`kinds.${kind}`) : t('movements.anyKind')}
          items={[{ key: 'any', label: t('movements.anyKind'), selected: !kind, onSelect: () => setKind(null) }, ...STOCK_MOVEMENT_KINDS.map((k) => ({ key: k, label: t(`kinds.${k}`), selected: k === kind, onSelect: () => setKind(k) }))]}
        />
      </div>
      {q.isLoading ? (
        <Skeleton h={320} />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={ClockCounterClockwise} title={t('movements.emptyTitle')} text={t('movements.emptyText')} />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={cols} rows={items} rowKey={(m) => m.id} />
          </Card>
          <div className="list-cards only-phone">
            {items.map((m) => (
              <ListCard
                key={m.id}
                href={m.orderId ? `/sales/${m.orderId}` : m.purchaseId ? `/purchasing/${m.purchaseId}` : undefined}
                title={<FlavourName flavour={m.flavour} />}
                amount={signed(m.units)}
                sub={
                  <>
                    {dateShort(m.at)} · {t(`kinds.${m.kind}`)}
                    {(m.orderNumber || m.purchaseNumber) && (
                      <>
                        {' · '}
                        <bdi>{m.orderNumber ?? m.purchaseNumber}</bdi>
                      </>
                    )}
                    {m.by && ` · ${m.by}`}
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
      )}
    </>
  );
}
