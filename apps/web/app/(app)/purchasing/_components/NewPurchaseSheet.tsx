'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, UNITS_PER_CARTON, addDays, cartonsTotal, isoDate, type CartonsByFlavour, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { ActionError, Button, CaretDown, CartonsEditor, EmptyState, MenuButton, Sheet, ShoppingCart, TextField, Totals } from '@/components/ui';
import type { Supplier, SupplierList } from '../_lib/types';
import css from '../purchasing.module.css';
import { DateField } from '../../money/_components/date-field';

const DEFAULT_CARTONS = 100;

/** Approved suppliers as a dropdown: each with what it is the default for, and a way to manage them. */
export function SupplierPicker({ suppliers, value, onChange, error }: { suppliers: Supplier[]; value: string; onChange: (id: string) => void; error?: string }) {
  const t = useTranslations('purchasing');
  const router = useRouter();
  const { dateShort } = useFmt();
  const cur = suppliers.find((s) => s.id === value);
  const box = useRef<HTMLDivElement>(null);
  const detail = (s: Supplier) => {
    const def = s.defaultFlavours.length === FLAVOURS.length ? t('new.defaultAll') : s.defaultFlavours.length ? t('new.defaultSome', { flavours: s.defaultFlavours.map((f) => f.toUpperCase()).join(', ') }) : t('new.approvedOnly');
    const last = s.lastPurchaseNumber ? t('new.lastPurchase', { number: s.lastPurchaseNumber, date: dateShort(s.lastPurchaseOn) }) : t('new.noPurchases');
    return `${def} · ${last}`;
  };
  return (
    <div className={`an-field ${css.fieldRel}`} ref={box}>
      <label>{t('new.supplier')}</label>
      <MenuButton
        align="start"
        items={[]}
        trigger={({ open, toggle, ref }) => (
          <button ref={ref} type="button" className={`an-input an-dd ${css.dd}`} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
            <bdi>{cur?.company ?? t('new.supplierPlaceholder')}</bdi>
            <CaretDown className={`an-ic sm ${css.ddCaret}`} aria-hidden />
          </button>
        )}
        panel={(close) => (
          <div className={`an-pop menu ${css.pop}`} role="listbox" style={{ inlineSize: box.current?.offsetWidth }}>
            {suppliers.map((s) => (
              <button
                key={s.id}
                type="button"
                className="an-mi"
                role="option"
                aria-selected={s.id === value}
                onClick={() => {
                  onChange(s.id);
                  close();
                }}
              >
                <b className="strong">
                  <bdi>{s.company}</bdi>
                </b>
                <small>{detail(s)}</small>
              </button>
            ))}
            <button type="button" className="an-mi" onClick={() => router.push('/purchasing/suppliers')}>
              <small>{t('new.manage')}</small>
            </button>
          </div>
        )}
      />
      {error && <span className="an-help error">{error}</span>}
    </div>
  );
}

/** FR-PUR-2: approved supplier (the default preselected), expected date, cartons per flavour. */
export function NewPurchaseSheet({ open, onClose, flavour, nextNumber, supplierId: presetSupplier }: { open: boolean; onClose: () => void; flavour?: Flavour | null; nextNumber?: string; supplierId?: string | null }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const router = useRouter();
  const { num, unit } = useFmt();
  const list = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<SupplierList>('/suppliers'), enabled: open });
  const next = useQuery({ queryKey: ['purchases', ''], queryFn: () => api.get<{ nextNumber: string }>('/purchases'), enabled: open && !nextNumber });
  const approved = useMemo(() => (list.data?.items ?? []).filter((s) => s.status === 'approved'), [list.data]);

  const [supplierId, setSupplierId] = useState('');
  const [expectedOn, setExpectedOn] = useState('');
  const [cartons, setCartons] = useState<CartonsByFlavour>({});

  // Preselect: the supplier asked for, else the default for the flavour asked for, else the one that is default most often.
  useEffect(() => {
    if (!open || supplierId || !approved.length) return;
    const byFlavour = flavour ? list.data?.defaults[flavour] : null;
    const most = [...approved].sort((a, b) => b.defaultFlavours.length - a.defaultFlavours.length)[0];
    const pick = approved.find((s) => s.id === presetSupplier) ?? approved.find((s) => s.id === byFlavour) ?? most;
    choose(pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, approved, flavour, presetSupplier, list.data, supplierId]);

  function choose(s: Supplier) {
    setSupplierId(s.id);
    setExpectedOn(isoDate(addDays(new Date(), s.leadTimeDays)));
    const only = FLAVOURS.filter((f) => s.approvedFlavours.includes(f));
    setCartons(Object.fromEntries(only.map((f) => [f, flavour ? (f === flavour ? DEFAULT_CARTONS * 2 : 0) : DEFAULT_CARTONS])) as CartonsByFlavour);
  }

  const supplier = approved.find((s) => s.id === supplierId);
  const allowed = FLAVOURS.filter((f) => supplier?.approvedFlavours.includes(f));
  const clean = Object.fromEntries(allowed.filter((f) => (cartons[f] ?? 0) > 0).map((f) => [f, cartons[f]])) as CartonsByFlavour;
  const totalCartons = cartonsTotal(clean);
  const units = totalCartons * UNITS_PER_CARTON;
  const number = nextNumber ?? next.data?.nextNumber;

  const reset = () => {
    setSupplierId('');
    setCartons({});
  };
  const create = useAction(() => api.post<{ id: string; number: string }>('/purchases', { supplierId, expectedOn, cartons: clean }), {
    success: () => t('new.done'),
    successAction: (r) => ({ label: tc('view'), href: `/purchasing/${r.id}` }),
    onDone: (r) => {
      reset();
      onClose();
      router.push(`/purchasing/${r.id}`);
    },
  });

  const close = () => {
    reset();
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('new.title')}
      footer={
        approved.length > 0 || !list.isSuccess ? (
          <Button variant="primary" block disabled={!supplier || totalCartons === 0 || !expectedOn} busy={create.isPending} onClick={() => create.mutate(undefined)}>
            {number ? t('new.ctaNumber', { number }) : t('new.cta')}
          </Button>
        ) : undefined
      }
    >
      {list.isSuccess && approved.length === 0 ? (
        <EmptyState icon={ShoppingCart} title={t('new.noSupplier.title')} text={t('new.noSupplier.text')} action={<Button variant="primary" onClick={() => router.push('/purchasing/suppliers?new=1')}>{t('suppliers.new')}</Button>} />
      ) : (
        <>
          <SupplierPicker suppliers={approved} value={supplierId} onChange={(id) => choose(approved.find((s) => s.id === id)!)} error={create.fields.supplierId} />
          <DateField label={t('new.expectedOn')} value={expectedOn} min={isoDate()} onChange={setExpectedOn} error={create.fields.expectedOn} />
          <div className="stack tight">
            <label>{t('new.cartons')}</label>
            {supplier && <CartonsEditor value={cartons} onChange={setCartons} only={allowed} />}
            {create.fields.cartons && <p className="an-help error">{create.fields.cartons}</p>}
          </div>
          <Totals
            lines={[
              [t('new.units'), num(units)],
              [t('new.purchasePrice'), supplier ? t('new.aUnit', { price: unit(supplier.unitPriceCents, 4) }) : '—'],
              [t('new.transportExcise'), t('new.addedOnReceipt')],
            ]}
          />
          <p className="body-sm muted">{t('new.consequence')}</p>
          {!Object.keys(create.fields).length && <ActionError action={create} />}
        </>
      )}
    </Sheet>
  );
}
