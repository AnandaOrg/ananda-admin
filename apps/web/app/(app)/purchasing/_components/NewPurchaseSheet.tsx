'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, UNITS_PER_CARTON, addDays, cartonsTotal, isoDate, type CartonsByFlavour, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { Banner, Button, CartonsEditor, EmptyState, Select, Sheet, TextArea, TextField, Totals, Truck } from '@/components/ui';
import type { SupplierList } from '../_lib/types';

/** FR-PUR-2: approved supplier (the default preselected), expected date, cartons per flavour. */
export function NewPurchaseSheet({ open, onClose, flavour }: { open: boolean; onClose: () => void; flavour?: Flavour | null }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const router = useRouter();
  const { money, unit, num, date } = useFmt();
  const list = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<SupplierList>('/suppliers'), enabled: open });
  const approved = useMemo(() => (list.data?.items ?? []).filter((s) => s.status === 'approved'), [list.data]);

  const [supplierId, setSupplierId] = useState('');
  const [expectedOn, setExpectedOn] = useState('');
  const [cartons, setCartons] = useState<CartonsByFlavour>({});
  const [note, setNote] = useState('');

  // Preselect the default supplier: for the flavour asked for, else the one that is default most often.
  useEffect(() => {
    if (!open || supplierId || !approved.length) return;
    const byFlavour = flavour ? list.data?.defaults[flavour] : null;
    const most = [...approved].sort((a, b) => b.defaultFlavours.length - a.defaultFlavours.length)[0];
    const pick = approved.find((s) => s.id === byFlavour) ?? most;
    setSupplierId(pick.id);
    setExpectedOn(isoDate(addDays(new Date(), pick.leadTimeDays)));
  }, [open, approved, flavour, list.data, supplierId]);

  const supplier = approved.find((s) => s.id === supplierId);
  const allowed = FLAVOURS.filter((f) => supplier?.approvedFlavours.includes(f));
  const clean = Object.fromEntries(allowed.filter((f) => (cartons[f] ?? 0) > 0).map((f) => [f, cartons[f]])) as CartonsByFlavour;
  const totalCartons = cartonsTotal(clean);
  const units = totalCartons * UNITS_PER_CARTON;
  const goodsCents = supplier ? Math.round(units * supplier.unitPriceCents) : 0;

  const reset = () => {
    setSupplierId('');
    setCartons({});
    setNote('');
  };
  const create = useAction(() => api.post<{ id: string; number: string }>('/purchases', { supplierId, expectedOn, cartons: clean, note: note || undefined }), {
    success: (r) => t('new.done', { number: r.number }),
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
      dirty={totalCartons > 0}
      footer={
        <>
          <Button onClick={close}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={!supplier || totalCartons === 0 || !expectedOn} busy={create.isPending} onClick={() => create.mutate(undefined)}>
            {t('new.cta')}
          </Button>
        </>
      }
    >
      {list.isSuccess && approved.length === 0 ? (
        <EmptyState icon={Truck} title={t('new.noSupplier.title')} text={t('new.noSupplier.text')} action={<Button variant="primary" onClick={() => router.push('/purchasing/suppliers?new=1')}>{t('suppliers.new')}</Button>} />
      ) : (
        <>
          <Select
            label={t('new.supplier')}
            value={supplierId}
            placeholder={t('new.supplierPlaceholder')}
            onChange={(e) => {
              const s = approved.find((x) => x.id === e.target.value);
              setSupplierId(e.target.value);
              if (s) setExpectedOn(isoDate(addDays(new Date(), s.leadTimeDays)));
            }}
            options={approved.map((s) => ({ value: s.id, label: s.defaultFlavours.length ? t('new.supplierDefault', { name: s.company, flavours: s.defaultFlavours.map((f) => f.toUpperCase()).join(', ') }) : s.company }))}
            error={create.fields.supplierId}
            help={supplier ? t('new.supplierHelp', { days: supplier.leadTimeDays, price: unit(supplier.unitPriceCents, 4), terms: supplier.paymentTermsDays }) : undefined}
          />
          <TextField label={t('new.expectedOn')} type="date" value={expectedOn} min={isoDate()} onChange={(e) => setExpectedOn(e.target.value)} error={create.fields.expectedOn} help={expectedOn ? t('new.expectedHelp', { date: date(expectedOn) }) : undefined} />
          {supplier && <CartonsEditor value={cartons} onChange={setCartons} only={allowed} />}
          {create.fields.cartons && <p className="an-help error">{create.fields.cartons}</p>}
          <Totals
            lines={[
              [tc('cartons'), num(totalCartons)],
              [tc('units'), num(units)],
              [t('new.unitPrice'), supplier ? unit(supplier.unitPriceCents, 4) : '—'],
            ]}
            big={[t('new.goods'), money(goodsCents)]}
          />
          <p className="body-sm muted">{t('new.consequence')}</p>
          <TextArea label={tc('noteOptional')} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          {create.errorText && !Object.keys(create.fields).length && <Banner tone="bad">{create.errorText}</Banner>}
        </>
      )}
    </Sheet>
  );
}
