'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, type StatusTone } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, EmptyState, ErrorState, FlavourName, ListCard, PageHeader, PageSkeleton, Pill, Plus, Table, Truck, type Column } from '@/components/ui';
import { PurchasingTabs } from '../_components/PurchasingTabs';
import { SupplierSheet } from './SupplierSheet';
import type { Supplier, SupplierList } from '../_lib/types';

const TONE: Record<Supplier['status'], StatusTone> = { approved: 'good', pending: 'warn', inactive: 'mute' };

/** FR-PUR-3: suppliers; /purchasing/suppliers?new=1 opens New supplier. */
export default function SuppliersPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { canEdit, readOnly } = useSession();
  const { date, unit } = useFmt();
  const editable = canEdit('purchasing') && !readOnly;
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const list = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<SupplierList>('/suppliers') });

  const close = () => {
    setCreating(false);
    setEditing(null);
    if (params.get('new')) router.replace('/purchasing/suppliers');
  };

  if (list.isLoading) return <PageSkeleton />;
  const rows = list.data?.items ?? [];
  const flavours = (fs: string[]) =>
    fs.length === 0 ? (
      <span className="subtle">—</span>
    ) : fs.length === FLAVOURS.length ? (
      t('suppliers.allFlavours')
    ) : (
      <span className="row wrap" style={{ gap: 'var(--space-3)' }}>
        {FLAVOURS.filter((f) => fs.includes(f)).map((f) => (
          <FlavourName key={f} flavour={f} />
        ))}
      </span>
    );

  const columns: Column<Supplier>[] = [
    {
      key: 'supplier',
      header: t('suppliers.cols.supplier'),
      render: (s) => (
        <>
          <span className="nm">
            <bdi>{s.company}</bdi>
          </span>
          <span className="sb">
            <bdi>{s.country}</bdi> · <bdi>{unit(s.unitPriceCents, 4)}</bdi> {t('suppliers.perUnit')}
          </span>
        </>
      ),
    },
    { key: 'approved', header: t('suppliers.cols.approved'), render: (s) => flavours(s.approvedFlavours) },
    { key: 'default', header: t('suppliers.cols.default'), render: (s) => flavours(s.defaultFlavours) },
    { key: 'lead', header: t('suppliers.cols.leadTime'), type: 'count', render: (s) => t('suppliers.days', { n: s.leadTimeDays }) },
    { key: 'last', header: t('suppliers.cols.lastPurchase'), render: (s) => (s.lastPurchaseOn ? <span className="nowrap">{date(s.lastPurchaseOn)}</span> : <span className="subtle">{t('suppliers.never')}</span>) },
    { key: 'status', header: tc('status'), render: (s) => <Pill tone={TONE[s.status]}>{t(`suppliers.status.${s.status}`)}</Pill> },
  ];

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.purchasing'), href: '/purchasing' }, { label: t('tabs.suppliers') }]}
        kicker={t('suppliers.kicker', { n: rows.filter((s) => s.status === 'approved').length })}
        title={t('tabs.suppliers')}
        actions={
          editable ? (
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              {t('suppliers.new')}
            </Button>
          ) : undefined
        }
      />
      <PurchasingTabs current="suppliers" />
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={Truck} title={t('suppliers.empty.title')} text={t('suppliers.empty.text')} action={editable ? <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>{t('suppliers.new')}</Button> : undefined} />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(s) => s.id} onRow={editable ? (s) => setEditing(s) : undefined} />
          </Card>
          <div className="list-cards only-phone">
            {rows.map((s) => (
              <ListCard
                key={s.id}
                onClick={editable ? () => setEditing(s) : undefined}
                title={<bdi>{s.company}</bdi>}
                amount={t('suppliers.days', { n: s.leadTimeDays })}
                sub={
                  <>
                    <bdi>{s.country}</bdi> · {s.defaultFlavours.length ? t('suppliers.defaultFor', { flavours: s.defaultFlavours.map((f) => f.toUpperCase()).join(', ') }) : t('suppliers.approvedFor', { n: s.approvedFlavours.length })}
                  </>
                }
                status={<Pill tone={TONE[s.status]}>{t(`suppliers.status.${s.status}`)}</Pill>}
              />
            ))}
          </div>
        </>
      )}
      {editable && <SupplierSheet open={creating || !!editing} supplier={editing} all={rows} onClose={close} />}
    </div>
  );
}
