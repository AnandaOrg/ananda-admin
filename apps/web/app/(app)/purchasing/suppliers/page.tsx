'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button, Card, EmptyState, ErrorState, ListCard, PageHeader, PageSkeleton, Pill, Plus, Search, Table, Truck, searchFilter, type Column } from '@/components/ui';
import { PurchasingTabs, TableFoot, chevronColumn } from '../_components/PurchasingTabs';
import { NewPurchaseSheet } from '../_components/NewPurchaseSheet';
import { SUPPLIER_TONE, SupplierSheet, SupplierView, useCountryName, useFlavourList } from './SupplierSheet';
import type { Supplier, SupplierList } from '../_lib/types';
import css from '../purchasing.module.css';

/** FR-PUR-3: suppliers; /purchasing/suppliers?new=1 opens New supplier. */
export default function SuppliersPage() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const { canEdit, readOnly } = useSession();
  const { date } = useFmt();
  const country = useCountryName();
  const flavours = useFlavourList();
  const editable = canEdit('purchasing') && !readOnly;
  const [viewing, setViewing] = useState<Supplier | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [buyFrom, setBuyFrom] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<SupplierList>('/suppliers') });

  const close = () => {
    setCreating(false);
    setEditing(null);
    if (params.get('new')) router.replace('/purchasing/suppliers');
  };

  if (list.isLoading) return <PageSkeleton />;
  const all = list.data?.items ?? [];
  const rows = searchFilter(all, q, (s) => [s.company, country(s.country), s.contactName]);
  const approved = all.filter((s) => s.status === 'approved').length;
  const last = (s: Supplier) => (s.lastPurchaseNumber ? <span className="nowrap"><bdi>{s.lastPurchaseNumber}</bdi> · {date(s.lastPurchaseOn)}</span> : <span className="subtle">{t('suppliers.never')}</span>);
  const status = (s: Supplier) => <Pill tone={SUPPLIER_TONE[s.status]}>{t(`suppliers.status.${s.status}`)}</Pill>;

  const columns: Column<Supplier>[] = [
    {
      key: 'supplier',
      header: t('suppliers.cols.supplier'),
      render: (s) => (
        <>
          <span className="nm">
            <bdi>{s.company}</bdi>
          </span>
          <span className="sb">{country(s.country)}</span>
        </>
      ),
    },
    { key: 'approved', header: t('suppliers.cols.approved'), render: (s) => flavours(s.approvedFlavours) },
    { key: 'default', header: t('suppliers.cols.default'), render: (s) => flavours(s.defaultFlavours) },
    { key: 'lead', header: t('suppliers.cols.leadTime'), render: (s) => t('suppliers.days', { n: s.leadTimeDays }) },
    { key: 'last', header: t('suppliers.cols.lastPurchase'), render: last },
    { key: 'status', header: tc('status'), render: status },
    chevronColumn<Supplier>(),
  ];

  const newBtn = editable && (
    <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
      {t('suppliers.new')}
    </Button>
  );

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.purchasing'), href: '/purchasing' }, { label: t('tabs.suppliers') }]}
        kicker={t('suppliers.kicker', { n: approved })}
        title={tc('nav.purchasing')}
        actions={
          <>
            <div className={`only-wide ${css.search}`}>
              <Search value={q} onChange={setQ} placeholder={t('suppliers.search')} />
            </div>
            <span className="only-wide">{newBtn}</span>
          </>
        }
      />
      <PurchasingTabs current="suppliers" />
      {list.error ? (
        <ErrorState error={list.error} retry={() => list.refetch()} />
      ) : all.length === 0 ? (
        <Card>
          <EmptyState icon={Truck} title={t('suppliers.empty.title')} text={t('suppliers.empty.text')} action={editable ? <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>{t('suppliers.new')}</Button> : undefined} />
        </Card>
      ) : (
        <>
          <Card flush className="only-wide">
            <Table columns={columns} rows={rows} rowKey={(s) => s.id} picker={{ id: 'suppliers', locked: ['supplier', 'status', 'go'], defaults: ['approved', 'last'], priority: ['approved', 'last', 'default', 'lead'] }} onRow={(s) => setViewing(s)} empty={<span className="muted">{t('empty.searchText', { q })}</span>} />
            <TableFoot>{t('suppliers.foot')}</TableFoot>
          </Card>
          <div className="list-cards only-phone">
            {rows.map((s) => (
              <ListCard
                key={s.id}
                onClick={() => setViewing(s)}
                title={<bdi>{s.company}</bdi>}
                sub={t('suppliers.phoneSub', { country: country(s.country), lead: t('suppliers.days', { n: s.leadTimeDays }), def: flavours(s.defaultFlavours, true) })}
                status={status(s)}
              />
            ))}
            <p className="body-sm muted">{t('suppliers.footShort')}</p>
            {editable && (
              <Button icon={Plus} onClick={() => setCreating(true)}>
                {t('suppliers.new')}
              </Button>
            )}
          </div>
        </>
      )}
      <SupplierView
        supplier={viewing}
        onClose={() => setViewing(null)}
        onEdit={
          editable
            ? (s) => {
                setViewing(null);
                setEditing(s);
              }
            : undefined
        }
        onBuy={
          editable
            ? (s) => {
                setViewing(null);
                setBuyFrom(s.id);
              }
            : undefined
        }
      />
      {editable && <SupplierSheet open={creating || !!editing} supplier={editing} all={all} onClose={close} />}
      {editable && <NewPurchaseSheet open={!!buyFrom} supplierId={buyFrom} onClose={() => setBuyFrom(null)} />}
    </div>
  );
}
