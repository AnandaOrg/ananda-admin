'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MIN_ORDER_CARTONS, REASONS, UNITS_PER_CARTON, calculateOrder, type CartonsByFlavour, type Flavour } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ActionError, Button, FlavourName, MoneyField, Sheet, TextArea, TextField } from '@/components/ui';
import { FlavourSteppers, Picker, SumBox, firstName } from '../ui';
import type { OrderDetail } from './page';

export type ActionKey = 'correction' | 'cancel' | 'credit_note' | 'special_price' | 'part_outcome' | 'delete';

const cartonsOf = (d: OrderDetail): CartonsByFlavour => Object.fromEntries(d.lines.map((l) => [l.flavour, l.cartons]));

/** One panel per order action; each shows its consequence before it runs (10 Nov prototype sheets). */
export function OrderActionSheet({ action, detail, onClose, onDeleted }: { action: ActionKey | null; detail: OrderDetail; onClose: () => void; onDeleted: () => void }) {
  const t = useTranslations('sales');
  const { money, unit, num } = useFmt();
  const { isAgent } = useSession();
  const o = detail.order;
  const id = o.id;
  const agentFirst = detail.houseSale ? null : firstName(detail.agent.name);

  const [cartons, setCartons] = useState<CartonsByFlavour>(cartonsOf(detail));
  const [credit, setCredit] = useState<CartonsByFlavour>({});
  const [reason, setReason] = useState('');
  const [creditKind, setCreditKind] = useState<'returned' | 'damaged' | 'price_error'>('returned');
  const [text, setText] = useState('');
  const [priceCents, setPriceCents] = useState<number | null>(null);
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<'credit_note' | 'redeliver'>('credit_note');

  // Fresh form every time a panel opens.
  useEffect(() => {
    if (!action) return;
    setCartons(cartonsOf(detail));
    setCredit({});
    setReason('');
    setCreditKind('returned');
    setText('');
    setPriceCents(null);
    setAmountCents(null);
    setOutcome('credit_note');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  const done = { onDone: onClose };
  const correction = useAction(() => api.post<{ applied?: boolean; proforma?: string }>(`/orders/${id}/correction`, { cartons, reason: text }), {
    success: (r) => (r.applied ? t('actions.correction.done', { number: r.proforma ?? '' }) : t('actions.correction.doneAgent')),
    ...done,
  });
  const cancel = useAction(() => api.post(`/orders/${id}/cancel`, { reason, note: text || undefined }), { success: t('actions.cancel.done', { number: o.number }), ...done });
  const creditNote = useAction(
    () =>
      api.post<{ creditNote: string }>(
        `/orders/${id}/credit-note`,
        creditKind === 'price_error' ? { reason: 'price_error', cartons: {}, amountCents, note: text || undefined } : { reason: creditKind, cartons: credit, note: text || undefined },
      ),
    { success: (r) => t('actions.credit_note.done', { number: r.creditNote }), ...done },
  );
  const special = useAction(() => api.post(`/orders/${id}/special-price`, { unitPriceCents: priceCents, reason: text }), { success: t('actions.special_price.done'), ...done });
  const part = useAction(() => api.post(`/orders/${id}/part-outcome`, { outcome, note: text || undefined }), { success: t(`actions.part_outcome.done_${outcome}`), ...done });
  const del = useAction(() => api.del(`/orders/${id}`), { success: t('actions.delete.done'), onDone: onDeleted });

  const before = cartonsOf(detail);
  const newCalc = useMemo(() => calculateOrder(cartons, o.specialUnitPriceCents), [cartons, o.specialUnitPriceCents]);
  const same = (Object.keys({ ...before, ...cartons }) as Flavour[]).every((f) => (before[f] ?? 0) === (cartons[f] ?? 0));
  const creditMax = Object.fromEntries(detail.lines.map((l) => [l.flavour, (l.deliveredCartons ?? l.cartons) - l.creditedCartons])) as CartonsByFlavour;
  const creditNet = detail.lines.reduce((s, l) => s + (credit[l.flavour] ?? 0) * UNITS_PER_CARTON * l.unitPriceCents, 0);
  const creditTotal = creditKind === 'price_error' ? (amountCents ?? 0) : creditNet + Math.round(creditNet * 0.2);
  const flavoursIn = detail.lines.map((l) => l.flavour) as Flavour[];
  const invoiceNo = detail.documents.find((x) => x.type === 'invoice')?.number ?? '';

  if (!action) return null;

  switch (action) {
    case 'correction': {
      const low = !newCalc.meetsMinimum;
      return (
        <Sheet
          open
          onClose={onClose}
          dirty={!same || !!text}
          title={t('actions.correction.heading')}
          sub={t('actions.correction.sub', { number: o.number })}
          footer={
            <Button variant="primary" block disabled={same || low || !text.trim()} busy={correction.isPending} onClick={() => correction.mutate(undefined)}>
              {isAgent ? t('actions.correction.ctaAgent') : t('actions.correction.cta')}
            </Button>
          }
        >
          <FlavourSteppers value={cartons} onChange={setCartons} sub={(f, n) => (n === (before[f] ?? 0) ? t('newSale.units', { n: num(n * UNITS_PER_CARTON) }) : t('actions.correction.was', { n: before[f] ?? 0 }))} />
          <TextField label={agentFirst ? t('actions.correction.reason', { first: agentFirst }) : t('actions.correction.reasonHouse')} placeholder={t('actions.correction.reasonPh')} value={text} onChange={(e) => setText(e.target.value)} error={correction.fields.reason} />
          <SumBox
            rows={[
              [t('actions.correction.total'), <>{money(o.totalCents)} → <b style={{ fontWeight: 600 }}>{money(newCalc.totalCents)}</b></>],
              [t('actions.correction.price'), t('actions.correction.priceValue', { price: unit(newCalc.unitPriceCents), n: num(newCalc.totalCartons) })],
              ...(agentFirst ? [[t('actions.correction.commission', { first: agentFirst }), t('money.commissionValue', { amount: money(newCalc.commissionCents) })] as [string, string]] : []),
            ]}
          />
          {low && <span className="sales-hint bad">{t('actions.correction.low', { min: MIN_ORDER_CARTONS, units: num(MIN_ORDER_CARTONS * UNITS_PER_CARTON) })}</span>}
          <span className="sales-hint">{isAgent ? t('actions.correction.consequenceAgent') : t('actions.correction.consequence')}</span>
          <ActionError action={correction} />
        </Sheet>
      );
    }
    case 'cancel':
      return (
        <Sheet
          open
          onClose={onClose}
          title={t('actions.cancel.heading', { number: o.number })}
          footer={
            <>
              <Button keep onClick={onClose}>
                {t('actions.cancel.keep')}
              </Button>
              <Button variant="primary" className="danger" disabled={!reason || (reason === 'other' && !text.trim())} busy={cancel.isPending} onClick={() => cancel.mutate(undefined)}>
                {t('actions.cancel.cta')}
              </Button>
            </>
          }
        >
          <span className="sales-hint">
            {detail.houseSale ? t('actions.cancel.textHouse') : t('actions.cancel.text', { agent: agentFirst ?? '' })}
            {o.paidCents > 0 && ` ${t('actions.cancel.refund')}`}
          </span>
          <Picker
            label={t('actions.cancel.reason')}
            value={reason || null}
            placeholder={t('actions.cancel.choose')}
            options={REASONS.cancel.map((r) => ({ value: r, label: t(`actions.cancel.reasons.${r}`) }))}
            onChange={setReason}
            error={cancel.fields.reason}
          />
          {reason === 'other' && <TextField label={t('actions.cancel.why')} placeholder={t('actions.cancel.whyPh')} value={text} onChange={(e) => setText(e.target.value)} />}
          <ActionError action={cancel} />
        </Sheet>
      );
    case 'credit_note': {
      const opts = [
        { value: 'returned', label: t('actions.credit_note.returned'), sub: t('actions.credit_note.returnedSub') },
        { value: 'damaged', label: t('actions.credit_note.damaged'), sub: t('actions.credit_note.damagedSub') },
        { value: 'price_error', label: t('actions.credit_note.price'), sub: t('actions.credit_note.priceSub') },
      ];
      const key = creditKind === 'price_error' ? 'price' : creditKind;
      return (
        <Sheet
          open
          onClose={onClose}
          dirty={creditTotal > 0 || !!text}
          title={t('actions.credit_note.title')}
          sub={t('actions.credit_note.sub', { invoice: invoiceNo, customer: detail.customer?.companyName ?? '' })}
          footer={
            <Button variant="primary" block disabled={creditTotal <= 0} busy={creditNote.isPending} onClick={() => creditNote.mutate(undefined)}>
              {t('actions.credit_note.cta')}
            </Button>
          }
        >
          <Picker label={t('actions.credit_note.reason')} value={creditKind} placeholder={t('actions.credit_note.reason')} options={opts} onChange={(v) => setCreditKind(v as typeof creditKind)} />
          {creditKind === 'price_error' ? (
            <MoneyField label={t('actions.credit_note.amount')} cents={amountCents} onCents={setAmountCents} error={creditNote.fields.amountCents} />
          ) : (
            <FlavourSteppers value={credit} onChange={setCredit} only={flavoursIn} max={creditMax} sub={(f) => t('actions.credit_note.of', { n: creditMax[f] ?? 0 })} />
          )}
          <TextField label={t('actions.credit_note.note')} placeholder={t(`actions.credit_note.notePh.${key}`)} value={text} onChange={(e) => setText(e.target.value)} />
          <SumBox rows={[[t('actions.credit_note.credit'), `−${money(creditTotal)}`, 'bad']]}>
            <span className="sales-hint">{t(`actions.credit_note.foot.${key}`)}</span>
          </SumBox>
          <ActionError action={creditNote} />
        </Sheet>
      );
    }
    case 'special_price':
      return (
        <Sheet
          open
          onClose={onClose}
          dirty
          title={t('actions.special_price.title')}
          sub={o.number}
          footer={
            <Button variant="primary" block disabled={!priceCents || !text.trim()} busy={special.isPending} onClick={() => special.mutate(undefined)}>
              {t('actions.special_price.cta')}
            </Button>
          }
        >
          <SumBox rows={[[t('actions.special_price.listPrice'), unit(o.tierUnitPriceCents)], [t('order.colUnits'), num(o.totalUnits)]]} />
          <MoneyField label={t('actions.special_price.price')} cents={priceCents} onCents={setPriceCents} error={special.fields.unitPriceCents} help={t('actions.special_price.priceHelp')} />
          {priceCents != null && priceCents < o.tierUnitPriceCents && (
            <SumBox
              rows={[
                [t('money.commission'), `${money(o.commissionCents)} → ${money(Math.max(0, o.totalUnits * 50 - (o.tierUnitPriceCents - priceCents) * o.totalUnits))}`],
                [t('money.total'), money(Math.round(o.totalUnits * priceCents * 1.2)), 'big'],
              ]}
            />
          )}
          <TextArea label={t('actions.special_price.reason')} value={text} onChange={(e) => setText(e.target.value)} help={t('actions.special_price.reasonHelp')} />
          <ActionError action={special} />
        </Sheet>
      );
    case 'part_outcome': {
      const back = detail.lines.reduce((s, l) => s + l.cartons - (l.deliveredCartons ?? l.cartons), 0);
      return (
        <Sheet
          open
          onClose={onClose}
          title={t('actions.part_outcome.title')}
          sub={o.number}
          footer={
            <Button variant="primary" block busy={part.isPending} onClick={() => part.mutate(undefined)}>
              {t(`actions.part_outcome.cta_${outcome}`)}
            </Button>
          }
        >
          <p>{t('actions.part_outcome.summary', { n: back })}</p>
          <div className="stack tight">
            {detail.lines
              .filter((l) => (l.deliveredCartons ?? l.cartons) < l.cartons)
              .map((l) => (
                <div key={l.flavour} className="sales-tot">
                  <FlavourName flavour={l.flavour} />
                  <span>{t('actions.part_outcome.kept', { kept: l.deliveredCartons ?? 0, sent: l.cartons })}</span>
                </div>
              ))}
          </div>
          <Picker
            value={outcome}
            placeholder=""
            options={(['credit_note', 'redeliver'] as const).map((v) => ({ value: v, label: t(`actions.part_outcome.${v}`), sub: t(`actions.part_outcome.consequence_${v}`) }))}
            onChange={(v) => setOutcome(v as typeof outcome)}
          />
          <TextArea label={t('actions.part_outcome.note')} value={text} onChange={(e) => setText(e.target.value)} />
          <ActionError action={part} />
        </Sheet>
      );
    }
    case 'delete':
      return (
        <Sheet
          open
          onClose={onClose}
          title={t('actions.delete.heading', { number: o.number })}
          footer={
            <>
              <Button keep onClick={onClose}>
                {t('actions.delete.keep')}
              </Button>
              <Button variant="primary" className="danger" busy={del.isPending} onClick={() => del.mutate(undefined)}>
                {t('actions.delete.cta')}
              </Button>
            </>
          }
        >
          <span className="sales-hint">{t('actions.delete.consequence')}</span>
          <ActionError action={del} />
        </Sheet>
      );
  }
}
