'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { MIN_ORDER_CARTONS, calculateOrder, type CartonsByFlavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Banner, Button, Card, CartonsEditor, KeyValue, PageHeader, Select, TextArea, Totals } from '@/components/ui';

interface CustomerOption {
  id: string;
  companyName: string;
  status: string;
  mine: boolean;
}

export interface DraftValues {
  id?: string;
  number?: string;
  customerId: string | null;
  cartons: CartonsByFlavour;
  note: string;
  specialUnitPriceCents?: number | null;
}

/** New sale and draft editing (FR-SALE-2). Totals are computed live with the shared rules. */
export function SaleForm({ initial }: { initial: DraftValues }) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const router = useRouter();
  const { money, unit, num } = useFmt();
  const { isAgent } = useSession();
  const [customerId, setCustomerId] = useState<string | null>(initial.customerId);
  const [cartons, setCartons] = useState<CartonsByFlavour>(initial.cartons);
  const [note, setNote] = useState(initial.note);

  const customers = useQuery({ queryKey: ['customers', 'picker'], queryFn: () => api.get<{ items: CustomerOption[] }>('/customers') });
  const customer = useQuery({
    queryKey: ['customers', customerId, 'terms'],
    queryFn: () => api.get<{ customer: { paymentTermsDays: number; proformaLanguage: string } }>(`/customers/${customerId}`),
    enabled: !!customerId,
  });
  // Sales start only for approved customers the user may sell to (FR-CUST-3, FR-CUST-5).
  const options = (customers.data?.items ?? []).filter((c) => c.mine && (c.status === 'active' || c.status === 'late' || (!isAgent && c.status === 'free_to_claim')));
  const calc = useMemo(() => calculateOrder(cartons, initial.specialUnitPriceCents), [cartons, initial.specialUnitPriceCents]);

  const body = () => ({ customerId, cartons, note: note || undefined });
  const save = useAction(
    async () => {
      if (initial.id) {
        await api.patch(`/orders/${initial.id}`, body());
        return { id: initial.id };
      }
      return api.post<{ id: string }>('/orders', body());
    },
    { success: t('form.saved'), onDone: (r) => router.push(`/sales/${r.id}`) },
  );
  const send = useAction(
    async () => {
      const id = initial.id ?? (await api.post<{ id: string }>('/orders', body())).id;
      if (initial.id) await api.patch(`/orders/${id}`, body());
      await api.post(`/orders/${id}/send`);
      return { id };
    },
    { success: t('form.sent'), onDone: (r) => router.push(`/sales/${r.id}`) },
  );
  const canSend = !!customerId && calc.meetsMinimum;
  const error = save.errorText || send.errorText;

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.sales'), href: '/sales' }, { label: initial.number ?? tc('newSale') }]}
        title={initial.number ? t('form.editTitle', { number: initial.number }) : tc('newSale')}
      />
      <div className="cols side">
        <div className="stack loose">
          <Card title={tc('customer')}>
            <Select
              label={t('form.customer')}
              value={customerId ?? ''}
              onChange={(e) => setCustomerId(e.target.value || null)}
              placeholder={t('form.chooseCustomer')}
              options={options.map((c) => ({ value: c.id, label: c.companyName }))}
              help={isAgent ? t('form.customerHelpAgent') : t('form.customerHelp')}
              error={save.fields.customerId || send.fields.customerId}
            />
          </Card>
          <Card title={t('form.cartonsTitle')}>
            <CartonsEditor value={cartons} onChange={setCartons} />
            {!calc.meetsMinimum && <Banner>{t('form.belowMinimum', { n: calc.cartonsShort, min: MIN_ORDER_CARTONS })}</Banner>}
          </Card>
          <Card title={tc('noteOptional')}>
            <TextArea label={t('form.noteLabel')} value={note} onChange={(e) => setNote(e.target.value)} help={t('form.noteHelp')} />
          </Card>
        </div>
        <div className="stack loose" style={{ position: 'sticky', top: 'var(--page-margin)' }}>
          <Card title={t('form.summary')}>
            <KeyValue
              items={[
                [tc('cartons'), <bdi key="c">{t('form.cartonsOfMin', { n: num(calc.totalCartons), min: MIN_ORDER_CARTONS })}</bdi>],
                [tc('units'), num(calc.totalUnits)],
                [t('form.tier'), <bdi key="t">{t('form.tierRange', { from: num(calc.tier.minCartons), to: num(calc.tier.maxCartons) })}</bdi>],
                [tc('unitPrice'), <bdi key="u">{unit(calc.unitPriceCents)}</bdi>],
                [t('form.terms'), customer.data ? t('form.termsDays', { n: customer.data.customer.paymentTermsDays }) : '—'],
              ]}
            />
            {calc.tier.requiresAdvanceOrCommitment && <Banner>{t('form.advanceNeeded')}</Banner>}
            <hr className="divider" />
            <Totals lines={[[tc('totalExclVat'), money(calc.netCents)], [tc('vat'), money(calc.vatCents)]]} big={[tc('totalInclVat'), money(calc.totalCents)]} />
            <p className="body-sm muted">{t('form.commission', { amount: money(calc.commissionCents) })}</p>
            {error && <Banner tone="bad">{error}</Banner>}
            <div className="stack tight">
              <Button variant="primary" block disabled={!canSend} onClick={() => send.mutate(undefined)} busy={send.isPending}>
                {t('form.sendRequest')}
              </Button>
              <Button block onClick={() => save.mutate(undefined)} busy={save.isPending}>
                {tc('saveDraft')}
              </Button>
            </div>
            {!canSend && <p className="caption muted">{!customerId ? t('form.needCustomer') : t('form.needCartons', { n: calc.cartonsShort })}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
