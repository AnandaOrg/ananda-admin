'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { MIN_ORDER_CARTONS, PRICE_TIERS, calculateOrder, type CartonsByFlavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { iso, useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ActionError, Button, Info, Icon, Sheet } from '@/components/ui';
import { FlavourSteppers, Picker, SumBox, firstName, unitsOf } from './ui';

interface CustomerOption {
  id: string;
  companyName: string;
  status: string;
  mine: boolean;
  brokerId: string | null;
  brokerName: string | null;
  ownedUntil: string | null;
  lastOrderAt: string | null;
}

interface Draft {
  customerId: string | null;
  brokerId: string | null;
  cartons: CartonsByFlavour;
}

export interface ExistingDraft extends Draft {
  id: string;
  number: string;
  specialUnitPriceCents?: number | null;
}

// "Closing New sale with something filled in keeps it": kept for this browser tab, per user.
const KEY = 'ananda.newSale';
let memo: Record<string, Draft> = {};
function loadKept(userId: string): Draft | null {
  if (memo[userId]) return memo[userId];
  try {
    const raw = sessionStorage.getItem(`${KEY}.${userId}`);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function keep(userId: string, d: Draft | null) {
  if (d) memo[userId] = d;
  else delete memo[userId];
  try {
    if (d) sessionStorage.setItem(`${KEY}.${userId}`, JSON.stringify(d));
    else sessionStorage.removeItem(`${KEY}.${userId}`);
  } catch {
    /* storage blocked: the in-memory copy still works */
  }
}
const filled = (d: Draft) => !!d.customerId || Object.values(d.cartons).some((n) => (n ?? 0) > 0);
const EMPTY: Draft = { customerId: null, brokerId: null, cartons: {} };

/**
 * New sale (FR-SALE-2): the same form for Admins and brokers, in cartons of 24, as a side panel on
 * desktop and a bottom sheet on the phone. Also edits a draft (`draft`).
 */
export function NewSaleSheet({ open, onClose, onDone, customerId, draft }: { open: boolean; onClose: () => void; onDone?: (r: { id: string; number: string; sent: boolean }) => void; customerId?: string | null; draft?: ExistingDraft }) {
  const t = useTranslations('sales');
  const { money, unit, num, date } = useFmt();
  const { me, isBroker } = useSession();
  const userId = me.user.id;
  const [v, setV] = useState<Draft>(EMPTY);
  const [restored, setRestored] = useState(false);
  const saved = useRef(false);

  useEffect(() => {
    if (!open) return;
    saved.current = false;
    if (draft) {
      setV({ customerId: draft.customerId, brokerId: draft.brokerId, cartons: draft.cartons });
      setRestored(false);
      return;
    }
    const kept = loadKept(userId);
    if (kept && filled(kept) && (!customerId || kept.customerId === customerId)) {
      setV(kept);
      setRestored(true);
    } else {
      setV({ ...EMPTY, customerId: customerId ?? null });
      setRestored(false);
    }
  }, [open, draft, customerId, userId]);

  const customers = useQuery({ queryKey: ['customers', 'picker'], queryFn: () => api.get<{ items: CustomerOption[] }>('/customers'), enabled: open });
  const brokers = useQuery({ queryKey: ['brokers-list'], queryFn: () => api.get<{ id: string; name: string }[]>('/customers/brokers'), enabled: open && !isBroker });
  // Sales start only for approved customers the user may sell to (FR-CUST-3, FR-CUST-5).
  const options = (customers.data?.items ?? []).filter((c) => c.mine && (c.status === 'active' || c.status === 'late' || (!isBroker && c.status === 'free_to_claim')));
  const cust = options.find((c) => c.id === v.customerId) ?? null;
  const card = useQuery({
    queryKey: ['customers', v.customerId, 'terms'],
    queryFn: () => api.get<{ customer: { paymentTerms?: string } }>(`/customers/${v.customerId}`),
    enabled: open && !!v.customerId,
  });
  const termsKey = card.data?.customer.paymentTerms ?? 'before_shipping';
  const free = cust?.status === 'free_to_claim';
  const house = !!cust && !free && !cust.brokerId;
  const brokerId = v.brokerId ?? (cust ? (cust.brokerId ?? (house ? 'none' : null)) : null);
  const brokerName = brokerId === 'none' ? null : (brokers.data?.find((a) => a.id === brokerId)?.name ?? (brokerId === cust?.brokerId ? cust?.brokerName : null));

  const calc = useMemo(() => calculateOrder(v.cartons, draft?.specialUnitPriceCents), [v.cartons, draft?.specialUnitPriceCents]);
  const low = !calc.meetsMinimum;
  const next = PRICE_TIERS.find((x) => x.minCartons > Math.max(calc.totalCartons, MIN_ORDER_CARTONS - 1));

  const close = () => {
    if (!draft && !saved.current) keep(userId, filled(v) ? v : null);
    onClose();
  };

  const body = () => ({ customerId: v.customerId, cartons: v.cartons, ...(isBroker || !brokerId ? {} : { brokerId }) });
  const finish = (r: { id: string; number: string; sent: boolean }) => {
    saved.current = true;
    if (!draft) keep(userId, null);
    setRestored(false);
    onDone?.(r);
    onClose();
  };
  const custName = cust?.companyName ?? '';
  const sentMsg = (n: string) => t('newSale.sent', { number: iso(n) });
  const save = useAction(
    async () => {
      if (draft) {
        await api.patch(`/orders/${draft.id}`, body());
        return { id: draft.id, number: draft.number, sent: false };
      }
      const r = await api.post<{ id: string; number: string }>('/orders', body());
      return { ...r, sent: false };
    },
    { success: (r) => t('newSale.saved', { number: iso(r.number) }), onDone: finish },
  );
  const send = useAction(
    async () => {
      let r: { id: string; number: string };
      if (draft) {
        await api.patch(`/orders/${draft.id}`, body());
        r = { id: draft.id, number: draft.number };
      } else r = await api.post<{ id: string; number: string }>('/orders', body());
      await api.post(`/orders/${r.id}/send`);
      return { ...r, sent: true };
    },
    { success: (r) => sentMsg(r.number), onDone: finish },
  );
  const busy = save.isPending || send.isPending;

  const custOptions = options.map((c) => ({
    value: c.id,
    label: c.companyName,
    sub: isBroker
      ? c.lastOrderAt
        ? t('newSale.lastOrder', { date: date(c.lastOrderAt) })
        : t('newSale.noOrders')
      : c.status === 'free_to_claim'
        ? t('newSale.freeToClaim')
        : !c.brokerId
          ? t('newSale.houseCustomer')
          : `${c.brokerName} · ${c.lastOrderAt ? t('newSale.lastOrder', { date: date(c.lastOrderAt) }) : t('newSale.noOrders')}`,
  }));
  const brokerOptions = [
    ...(brokers.data ?? []).map((a) => ({ value: a.id, label: a.name, sub: a.id === cust?.brokerId && !free ? t('newSale.ownsCustomer') : undefined })),
    { value: 'none', label: t('newSale.noBrokerOption'), sub: t('newSale.noCommission') },
  ];
  const ownerHint = !cust
    ? null
    : free
      ? t('newSale.freeHint')
      : house && brokerId === 'none'
        ? t('newSale.houseHint')
        : brokerId === cust.brokerId
          ? cust.ownedUntil
            ? t('newSale.ownsUntil', { name: firstName(cust.brokerName), date: date(cust.ownedUntil) })
            : t('newSale.ownsNoDate', { name: firstName(cust.brokerName) })
          : cust.brokerName
            ? t('newSale.changedFrom', { from: cust.brokerName, first: firstName(cust.brokerName), to: brokerName ? firstName(brokerName) : t('newSale.noOne') })
            : t('newSale.houseHint');

  const commissionLabel = brokerName && brokerId !== 'none' ? t('newSale.commissionOf', { first: firstName(brokerName) }) : t('newSale.commission');
  const commissionValue = brokerId === 'none' ? t('newSale.none') : t('newSale.commissionValue', { amount: money(calc.commissionCents) });

  return (
    <Sheet
      open={open}
      onClose={close}
      title={draft ? t('newSale.editTitle', { number: draft.number }) : t('newSale.title')}
      sub={restored ? undefined : isBroker ? t('newSale.subBroker') : t('newSale.sub')}
      footer={
        <>
          <Button writes disabled={!v.customerId || calc.totalCartons === 0} busy={save.isPending} onClick={() => !busy && save.mutate(undefined)}>
            {t('newSale.saveDraft')}
          </Button>
          <Button variant="primary" disabled={!v.customerId || low || (!isBroker && !brokerId && !!cust)} busy={send.isPending} onClick={() => !busy && send.mutate(undefined)}>
            {t('newSale.send')}
          </Button>
        </>
      }
    >
      {restored && (
        <div className="sales-note info" role="status">
          <Icon as={Info} size="sm" />
          <span style={{ flex: 1 }}>{t('newSale.restored')}</span>
          <button
            type="button"
            className="an-errlink"
            onClick={() => {
              keep(userId, null);
              setV({ ...EMPTY });
              setRestored(false);
            }}
          >
            {t('newSale.startFresh')}
          </button>
        </div>
      )}
      <Picker
        label={t('newSale.customer')}
        value={v.customerId}
        placeholder={customers.isLoading ? '…' : options.length ? t('newSale.chooseCustomer') : t('newSale.noCustomers')}
        options={custOptions}
        onChange={(id) => setV({ ...v, customerId: id, brokerId: null })}
        error={save.fields.customerId || send.fields.customerId}
      />
      {!isBroker && cust && (
        <>
          <Picker label={t('newSale.broker')} value={brokerId} placeholder={t('newSale.chooseBroker')} options={brokerOptions} onChange={(a) => setV({ ...v, brokerId: a })} error={save.fields.brokerId || send.fields.brokerId} />
          {ownerHint && <span className="sales-hint">{ownerHint}</span>}
        </>
      )}
      <span className="sgrp">{t('newSale.cartons')}</span>
      <FlavourSteppers value={v.cartons} onChange={(c) => setV({ ...v, cartons: c })} sub={(_, n) => t('newSale.units', { n: num(unitsOf(n)) })} />
      {calc.totalCartons > 0 && low && <div className="sales-note warn">{t('newSale.minimum', { min: MIN_ORDER_CARTONS, n: calc.cartonsShort })}</div>}
      <SumBox
        rows={[
          [t('newSale.price'), t('newSale.priceLine', { price: unit(calc.unitPriceCents), tier: low ? t('newSale.priceListFrom', { min: MIN_ORDER_CARTONS }) : t('newSale.tier', { from: num(calc.tier.minCartons), to: num(calc.tier.maxCartons) }) })],
          ...(next && !low ? [[t('newSale.nextPrice'), t('newSale.nextLine', { price: unit(next.unitPriceCents), from: num(next.minCartons), n: num(next.minCartons - calc.totalCartons) })] as [string, string]] : []),
          [t('newSale.terms'), t.has(`newSale.termsKind.${termsKey}`) ? t(`newSale.termsKind.${termsKey}`) : t('newSale.termsValue')],
          [t('newSale.total'), money(calc.totalCents), 'big'],
          [commissionLabel, commissionValue],
        ]}
      />
      {calc.tier.requiresAdvanceOrCommitment && !low && <span className="sales-hint">{t('newSale.advance')}</span>}
      <ActionError action={send.error ? send : save} />
    </Sheet>
  );
}
