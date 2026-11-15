'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Card, CheckCircle, EmptyState, ErrorState, ListCard, PageHeader, PageSkeleton, Pill } from '@/components/ui';
import css from '../warehouse.module.css';
import { NoteViewSheet } from '../_components/DeliverySheets';
import type { DeliveredRow } from '../_components/types';

/** Phone · Delivered (FR-WH-5): one row per signed note, newest first; tap one to see it. */
export default function DeliveredPage() {
  const t = useTranslations('warehouse');
  const tc = useTranslations('common');
  const { isWarehouse } = useSession();
  const { date } = useFmt();
  const [view, setView] = useState<DeliveredRow | null>(null);
  const list = useQuery({ queryKey: ['warehouse', 'delivered', 'all'], queryFn: () => api.get<DeliveredRow[]>('/warehouse/delivered') });
  const rows = list.data ?? [];

  if (list.isLoading) return <PageSkeleton />;

  return (
    <div className={`page ${css.narrow}`}>
      <PageHeader crumbs={isWarehouse ? undefined : [{ label: tc('nav.warehouse'), href: '/warehouse' }, { label: t('deliveredPage.title') }]} title={t('deliveredPage.title')} />
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={CheckCircle} title={t('deliveredPage.empty.title')} text={t('deliveredPage.empty.text')} />
        </Card>
      ) : (
        <>
          <div className="list-cards">
            {rows.map((r) => (
              <ListCard
                key={r.id}
                onClick={() => setView(r)}
                title={r.customerName}
                amount={date(r.deliveredAt)}
                sub={
                  <>
                    <bdi>{r.number}</bdi> · {t('card.cartons', { n: r.deliveredCartons })}
                    {r.part && ` · ${t('deliveredPage.partShort')}`}
                  </>
                }
                status={<Pill tone="good">{t('deliveredPage.signed')}</Pill>}
              />
            ))}
          </div>
          <span className="body-sm muted">{t('deliveredPage.tap')}</span>
        </>
      )}
      <NoteViewSheet row={view} onClose={() => setView(null)} />
    </div>
  );
}
