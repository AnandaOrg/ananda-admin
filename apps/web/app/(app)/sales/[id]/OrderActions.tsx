'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PAYMENT_METHODS, REASONS, UNITS_PER_CARTON, calculateOrder, isoDate, type CartonsByFlavour, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { Banner, Button, CartonsEditor, FlavourName, MoneyField, ReasonChips, Select, Sheet, TextArea, TextField, Totals, TwoStepField } from '@/components/ui';
import type { OrderDetail } from './page';

export type ActionKey = 'confirm_payment' | 'send_to_warehouse' | 'issue_invoice' | 'correction' | 'cancel' | 'credit_note' | 'special_price' | 'part_outcome' | 'delete';

const cartonsOf = (d: OrderDetail): CartonsByFlavour => Object.fromEntries(d.lines.map((l) => [l.flavour, l.cartons]));

/** One side panel per order action; each shows its consequence before it runs. */
export function OrderActionSheet({ action, detail, onClose, onDeleted }: { action: ActionKey | null; detail: OrderDetail; onClose: () => void; onDeleted: () => void }) {
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const { money, unit, num } = useFmt();
  const o = detail.order;
  const id = o.id;

  // Confirm payment (FR-SALE-6)
  const [receivedOn, setReceivedOn] = useState(isoDate());
  const [amountCents, setAmountCents] = useState<number | null>(o.outstandingCents);
  const [method, setMethod] = useState<string>('bank_transfer');
  const [bankReference, setBankReference] = useState('');
  const [code, setCode] = useState('');
  // Correction, credit note, cancel, special price
  const [cartons, setCartons] = useState<CartonsByFlavour>(cartonsOf(detail));
  const [credit, setCredit] = useState<CartonsByFlavour>({});
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [priceCents, setPriceCents] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<'credit_note' | 'redeliver'>('credit_note');

  const done = { onDone: onClose };
  const confirm = useAction(() => api.post(`/orders/${id}/confirm-payment`, { receivedOn, amountCents, method, bankReference: bankReference || undefined }, { code }), { success: t('actions.confirm_payment.done'), ...done });
  const toWarehouse = useAction(() => api.post(`/orders/${id}/send-to-warehouse`), { success: t('actions.send_to_warehouse.done'), ...done });
  const invoice = useAction(() => api.post<{ invoice: string }>(`/orders/${id}/invoice`), { success: (r) => t('actions.issue_invoice.done', { number: r.invoice }), ...done });
  const correction = useAction(() => api.post(`/orders/${id}/correction`, { cartons, reason: text }), { success: t('actions.correction.done'), ...done });
  const cancel = useAction(() => api.post(`/orders/${id}/cancel`, { reason, note: text || undefined }), { success: t('actions.cancel.done'), ...done });
  const creditNote = useAction(() => api.post<{ creditNote: string }>(`/orders/${id}/credit-note`, { reason, cartons: credit, note: text || undefined }), { success: (r) => t('actions.credit_note.done', { number: r.creditNote }), ...done });
  const special = useAction(() => api.post(`/orders/${id}/special-price`, { unitPriceCents: priceCents, reason: text }), { success: t('actions.special_price.done'), ...done });
  const part = useAction(() => api.post(`/orders/${id}/part-outcome`, { outcome, note: text || undefined }), { success: t(`actions.part_outcome.done_${outcome}`), ...done });
  const del = useAction(() => api.del(`/orders/${id}`), { success: t('actions.delete.done'), onDone: onDeleted });

  const newCalc = useMemo(() => calculateOrder(cartons, o.specialUnitPriceCents), [cartons, o.specialUnitPriceCents]);
  const creditMax = Object.fromEntries(detail.lines.map((l) => [l.flavour, (l.deliveredCartons ?? l.cartons) - l.creditedCartons])) as CartonsByFlavour;
  const creditNet = detail.lines.reduce((s, l) => s + (credit[l.flavour] ?? 0) * UNITS_PER_CARTON * l.unitPriceCents, 0);
  const creditVat = Math.round(creditNet * 0.2);
  const flavoursIn = detail.lines.map((l) => l.flavour) as Flavour[];

  const all = [confirm, toWarehouse, invoice, correction, cancel, creditNote, special, part, del];
  const err = all.find((a) => a.errorText)?.errorText;
  const errBanner = err ? <Banner tone="bad">{err}</Banner> : null;
  const foot = (primary: React.ReactNode) => (
    <>
      <Button onClick={onClose}>{tc('cancel')}</Button>
      {primary}
    </>
  );

  if (!action) return null;
  const title = t(`actions.${action}.title`);
  const sub = <bdi>{o.number}</bdi>;

  switch (action) {
    case 'confirm_payment':
      return (
        <Sheet
          open
          onClose={onClose}
          title={title}
          sub={sub}
          dirty
          footer={foot(
            <Button variant="primary" disabled={code.length !== 6 || !amountCents} busy={confirm.isPending} onClick={() => confirm.mutate(undefined)}>
              {t('actions.confirm_payment.cta')}
            </Button>,
          )}
        >
          <Totals lines={[[tc('totalInclVat'), money(o.totalCents)], [t('money.paid'), money(o.paidCents)]]} big={[t('money.toPay'), money(o.outstandingCents)]} />
          <TextField label={t('actions.confirm_payment.receivedOn')} type="date" value={receivedOn} max={isoDate()} onChange={(e) => setReceivedOn(e.target.value)} />
          <MoneyField label={tc('amount')} cents={amountCents} onCents={setAmountCents} error={confirm.fields.amountCents} help={amountCents != null && amountCents < o.outstandingCents ? t('actions.confirm_payment.partHelp') : undefined} />
          <Select label={t('actions.confirm_payment.paidBy')} value={method} onChange={(e) => setMethod(e.target.value)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))} />
          <TextField label={t('actions.confirm_payment.reference')} value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
          <TwoStepField value={code} onChange={setCode} />
          <p className="body-sm muted">{t('actions.confirm_payment.consequence')}</p>
          {errBanner}
        </Sheet>
      );
    case 'send_to_warehouse':
      return (
        <Sheet open onClose={onClose} title={title} sub={sub} footer={foot(<Button variant="primary" busy={toWarehouse.isPending} onClick={() => toWarehouse.mutate(undefined)}>{t('actions.send_to_warehouse.cta')}</Button>)}>
          <div className="stack tight">
            {detail.lines.map((l) => (
              <div key={l.flavour} className="row between">
                <FlavourName flavour={l.flavour} />
                <span>{tc('cartonsUnits', { c: num(l.cartons), u: num(l.units) })}</span>
              </div>
            ))}
          </div>
          <p className="body-sm muted">{t('actions.send_to_warehouse.consequence')}</p>
          {errBanner}
        </Sheet>
      );
    case 'issue_invoice':
      return (
        <Sheet open onClose={onClose} title={title} sub={sub} footer={foot(<Button variant="primary" busy={invoice.isPending} onClick={() => invoice.mutate(undefined)}>{t('actions.issue_invoice.cta')}</Button>)}>
          <Totals lines={[[tc('totalExclVat'), money(o.netCents)], [tc('vat'), money(o.vatCents)]]} big={[tc('totalInclVat'), money(o.totalCents)]} />
          {o.status === 'delivered_part' && <Banner>{t('actions.issue_invoice.partNote')}</Banner>}
          <p className="body-sm muted">{t('actions.issue_invoice.consequence')}</p>
          {errBanner}
        </Sheet>
      );
    case 'correction':
      return (
        <Sheet open onClose={onClose} title={title} sub={sub} dirty footer={foot(<Button variant="primary" disabled={!text.trim() || !newCalc.meetsMinimum} busy={correction.isPending} onClick={() => correction.mutate(undefined)}>{t('actions.correction.cta')}</Button>)}>
          <CartonsEditor value={cartons} onChange={setCartons} />
          <Totals
            lines={[
              [t('actions.correction.cartons'), `${num(o.totalCartons)} → ${num(newCalc.totalCartons)}`],
              [t('money.commission'), `${money(o.commissionCents)} → ${money(newCalc.commissionCents)}`],
            ]}
            big={[tc('totalInclVat'), `${money(o.totalCents)} → ${money(newCalc.totalCents)}`]}
          />
          {!newCalc.meetsMinimum && <Banner>{t('form.belowMinimum', { n: newCalc.cartonsShort, min: 42 })}</Banner>}
          <TextArea label={tc('reason')} value={text} onChange={(e) => setText(e.target.value)} help={t('actions.correction.reasonHelp')} />
          <p className="body-sm muted">{t('actions.correction.consequence')}</p>
          {errBanner}
        </Sheet>
      );
    case 'cancel':
      return (
        <Sheet open onClose={onClose} title={title} sub={sub} footer={foot(<Button variant="primary" disabled={!reason} busy={cancel.isPending} onClick={() => cancel.mutate(undefined)}>{t('actions.cancel.cta')}</Button>)}>
          <ReasonChips reasons={REASONS.cancel} value={reason} onChange={setReason} label={tc('reason')} ns="cancel" />
          <TextArea label={tc('noteOptional')} value={text} onChange={(e) => setText(e.target.value)} />
          {o.paidCents > 0 && <Banner tone="bad">{t('actions.cancel.paidWarning', { amount: money(o.paidCents) })}</Banner>}
          <p className="body-sm muted">{t('actions.cancel.consequence')}</p>
          {errBanner}
        </Sheet>
      );
    case 'credit_note':
      return (
        <Sheet open onClose={onClose} title={title} sub={sub} dirty footer={foot(<Button variant="primary" disabled={!reason || creditNet <= 0} busy={creditNote.isPending} onClick={() => creditNote.mutate(undefined)}>{t('actions.credit_note.cta')}</Button>)}>
          <ReasonChips reasons={REASONS.credit} value={reason} onChange={setReason} label={tc('reason')} ns="credit" />
          <CartonsEditor value={credit} onChange={setCredit} max={creditMax} only={flavoursIn} />
          <TextArea label={t('actions.credit_note.noteForCustomer')} value={text} onChange={(e) => setText(e.target.value)} />
          <Totals lines={[[tc('totalExclVat'), money(creditNet)], [tc('vat'), money(creditVat)]]} big={[t('actions.credit_note.total'), money(creditNet + creditVat)]} />
          <p className="body-sm muted">{t('actions.credit_note.consequence')}</p>
          {errBanner}
        </Sheet>
      );
    case 'special_price':
      return (
        <Sheet open onClose={onClose} title={title} sub={sub} dirty footer={foot(<Button variant="primary" disabled={!priceCents || !text.trim()} busy={special.isPending} onClick={() => special.mutate(undefined)}>{t('actions.special_price.cta')}</Button>)}>
          <Totals lines={[[t('actions.special_price.listPrice'), unit(o.tierUnitPriceCents)], [tc('units'), num(o.totalUnits)]]} />
          <MoneyField label={t('actions.special_price.price')} cents={priceCents} onCents={setPriceCents} error={special.fields.unitPriceCents} help={t('actions.special_price.priceHelp')} />
          {priceCents != null && priceCents < o.tierUnitPriceCents && (
            <Totals
              lines={[[t('money.commission'), `${money(o.commissionCents)} → ${money(Math.max(0, o.totalUnits * 50 - (o.tierUnitPriceCents - priceCents) * o.totalUnits))}`]]}
              big={[tc('totalInclVat'), money(Math.round(o.totalUnits * priceCents * 1.2))]}
            />
          )}
          <TextArea label={tc('reason')} value={text} onChange={(e) => setText(e.target.value)} help={t('actions.special_price.reasonHelp')} />
          {errBanner}
        </Sheet>
      );
    case 'part_outcome': {
      const back = detail.lines.reduce((s, l) => s + l.cartons - (l.deliveredCartons ?? l.cartons), 0);
      return (
        <Sheet open onClose={onClose} title={title} sub={sub} footer={foot(<Button variant="primary" busy={part.isPending} onClick={() => part.mutate(undefined)}>{t(`actions.part_outcome.cta_${outcome}`)}</Button>)}>
          <p>{t('actions.part_outcome.summary', { n: back })}</p>
          <div className="stack tight">
            {detail.lines
              .filter((l) => (l.deliveredCartons ?? l.cartons) < l.cartons)
              .map((l) => (
                <div key={l.flavour} className="row between">
                  <FlavourName flavour={l.flavour} />
                  <span>{t('actions.part_outcome.kept', { kept: l.deliveredCartons ?? 0, sent: l.cartons })}</span>
                </div>
              ))}
          </div>
          <div className="an-chips fill" role="radiogroup">
            {(['credit_note', 'redeliver'] as const).map((v) => (
              <button key={v} type="button" className="an-chip" aria-pressed={outcome === v} onClick={() => setOutcome(v)}>
                {t(`actions.part_outcome.${v}`)}
              </button>
            ))}
          </div>
          <p className="body-sm muted">{t(`actions.part_outcome.consequence_${outcome}`)}</p>
          <TextArea label={tc('noteOptional')} value={text} onChange={(e) => setText(e.target.value)} />
          {errBanner}
        </Sheet>
      );
    }
    case 'delete':
      return (
        <Sheet open onClose={onClose} title={title} sub={sub} footer={foot(<Button variant="primary" busy={del.isPending} onClick={() => del.mutate(undefined)}>{tc('delete')}</Button>)}>
          <p>{t('actions.delete.consequence')}</p>
          {errBanner}
        </Sheet>
      );
  }
}
