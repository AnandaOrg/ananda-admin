'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { addDays, exciseCentsForUnits, isoDate, landedUnitCostCents } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { Banner, Button, MoneyField, Segmented, Select, Sheet, Switch, TextField, Totals } from '@/components/ui';
import { EmailDraft, type Draft } from '@/components/EmailDraft';
import { FilePick } from '../_components/FilePick';
import { formWith, type PurchaseDetail } from '../_lib/types';

export type SheetKey = 'receive' | 'freight' | 'ask' | 'on_the_way' | 'invoice' | 'upload';

const VAT_RATES = [0.2, 0.09, 0];
const MODES = ['road', 'sea', 'air', 'rail'] as const;
const TOPICS = ['arrival_date', 'tracking', 'invoice_copy', 'other'] as const;
type Topic = (typeof TOPICS)[number];

function dayPlus(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(addDays(new Date(y, m - 1, d), days));
}

function useFreightFields(detail: PurchaseDetail) {
  const existing = detail.payables.find((p) => p.kind === 'freight');
  const [carrier, setCarrier] = useState(existing?.party ?? detail.shipments[0]?.carrier ?? '');
  const [netCents, setNetCents] = useState<number | null>(existing?.netCents ?? null);
  const [vatRate, setVatRate] = useState(existing?.vatRate ?? 0.2);
  const [invoiceNumber, setInvoiceNumber] = useState(existing?.invoiceNumber ?? '');
  const [payBy, setPayBy] = useState(existing?.dueOn ?? dayPlus(isoDate(), 14));
  const [file, setFile] = useState<File | null>(null);
  return { existing, carrier, setCarrier, netCents, setNetCents, vatRate, setVatRate, invoiceNumber, setInvoiceNumber, payBy, setPayBy, file, setFile };
}

function FreightFields({ f, fields }: { f: ReturnType<typeof useFreightFields>; fields: Record<string, string> }) {
  const t = useTranslations('purchasing');
  const { money } = useFmt();
  const vat = f.netCents != null ? Math.round(f.netCents * f.vatRate) : 0;
  return (
    <>
      <TextField label={t('freight.carrier')} value={f.carrier} onChange={(e) => f.setCarrier(e.target.value)} error={fields.carrier ?? fields['freight.carrier']} />
      <div className="form-grid">
        <MoneyField label={t('freight.amount')} cents={f.netCents} onCents={f.setNetCents} error={fields.amountNetCents ?? fields['freight.amountNetCents']} />
        <Select label={t('freight.vatRate')} value={String(f.vatRate)} onChange={(e) => f.setVatRate(Number(e.target.value))} options={VAT_RATES.map((r) => ({ value: String(r), label: `${Math.round(r * 100)}%` }))} />
      </div>
      {f.netCents != null && <p className="body-sm muted">{t('freight.withVat', { vat: money(vat), total: money(f.netCents + vat) })}</p>}
      <div className="form-grid">
        <TextField label={t('freight.invoiceNumber')} value={f.invoiceNumber} onChange={(e) => f.setInvoiceNumber(e.target.value)} />
        <TextField label={t('freight.payBy')} type="date" value={f.payBy} onChange={(e) => f.setPayBy(e.target.value)} error={fields.payBy ?? fields['freight.payBy']} />
      </div>
      <FilePick label={t('freight.upload')} file={f.file} onFile={f.setFile} />
    </>
  );
}

const freightBody = (f: ReturnType<typeof useFreightFields>) => ({ carrier: f.carrier.trim(), amountNetCents: f.netCents ?? 0, vatRate: f.vatRate, invoiceNumber: f.invoiceNumber.trim() || undefined, payBy: f.payBy });

/** All the actions of a purchase, each in its own side panel. */
export function PurchaseSheet({ sheet, detail, onClose }: { sheet: SheetKey | null; detail: PurchaseDetail; onClose: () => void }) {
  if (!sheet) return null;
  switch (sheet) {
    case 'receive':
      return <ReceiveSheet detail={detail} onClose={onClose} />;
    case 'freight':
      return <FreightSheet detail={detail} onClose={onClose} />;
    case 'ask':
      return <AskSupplierSheet detail={detail} onClose={onClose} />;
    case 'on_the_way':
      return <OnTheWaySheet detail={detail} onClose={onClose} />;
    case 'invoice':
      return <InvoiceSheet detail={detail} onClose={onClose} />;
    case 'upload':
      return <UploadSheet detail={detail} onClose={onClose} />;
  }
}

function ErrorBanner({ a }: { a: { errorText: string | null; fields: Record<string, string> } }) {
  if (!a.errorText) return null;
  return <Banner tone="bad">{a.fields._ ?? a.errorText}</Banner>;
}

/** FR-PUR-7 Mark as received. */
function ReceiveSheet({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const { money, unit, num } = useFmt();
  const p = detail.purchase;
  const [arrivedOn, setArrivedOn] = useState(isoDate());
  const [counted, setCounted] = useState<Record<string, string>>(Object.fromEntries(detail.lines.map((l) => [l.flavour, String(l.units)])));
  const [hasInvoice, setHasInvoice] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDueOn, setInvoiceDueOn] = useState('');
  const [invoiceNet, setInvoiceNet] = useState<number | null>(p.goodsCents);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [hasFreight, setHasFreight] = useState(false);
  const f = useFreightFields(detail);

  useEffect(() => setInvoiceDueOn(dayPlus(arrivedOn, detail.supplier.paymentTermsDays)), [arrivedOn, detail.supplier.paymentTermsDays]);

  const units = detail.lines.reduce((s, l) => s + Math.max(0, parseInt(counted[l.flavour] || '0', 10) || 0), 0);
  const goods = hasInvoice && invoiceNet != null ? invoiceNet : p.goodsCents;
  const freight = hasFreight ? (f.netCents ?? 0) : p.freightCents;
  const excise = exciseCentsForUnits(units);
  const landed = landedUnitCostCents(goods, freight, excise, units);
  const short = detail.lines.some((l) => (parseInt(counted[l.flavour] || '0', 10) || 0) !== l.units);

  const receive = useAction(
    () =>
      api.post<{ waitingOrders: number }>(
        `/purchases/${p.id}/receive`,
        formWith(
          {
            arrivedOn,
            unitsReceived: Object.fromEntries(detail.lines.map((l) => [l.flavour, Math.max(0, parseInt(counted[l.flavour] || '0', 10) || 0)])),
            ...(hasInvoice ? { supplierInvoiceNumber: invoiceNumber.trim() || undefined, supplierInvoiceDueOn: invoiceDueOn || undefined, invoiceNetCents: invoiceNet ?? undefined } : {}),
            ...(hasFreight ? { freight: freightBody(f) } : {}),
          },
          { supplierInvoice: hasInvoice ? invoiceFile : null, carrierInvoice: hasFreight ? f.file : null },
        ),
      ),
    { success: (r) => (r.waitingOrders > 0 ? t('receive.doneWaiting', { n: r.waitingOrders }) : t('receive.done')), onDone: onClose },
  );

  const invoiceIncomplete = hasInvoice && !invoiceNumber.trim() && !invoiceFile;
  const freightIncomplete = hasFreight && (!f.carrier.trim() || f.netCents == null || !f.payBy);

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('receive.title')}
      sub={<bdi>{p.number}</bdi>}
      dirty
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={units <= 0 || invoiceIncomplete || freightIncomplete} busy={receive.isPending} onClick={() => receive.mutate(undefined)}>
            {t('receive.cta')}
          </Button>
        </>
      }
    >
      <TextField label={t('receive.arrivedOn')} type="date" value={arrivedOn} max={isoDate()} onChange={(e) => setArrivedOn(e.target.value)} error={receive.fields.arrivedOn} />
      <div className="stack tight">
        <span className="overline">{t('receive.counted')}</span>
        {detail.lines.map((l) => (
          <TextField
            key={l.flavour}
            label={t('receive.unitsOf', { flavour: l.flavour.toUpperCase() })}
            inputMode="numeric"
            value={counted[l.flavour]}
            onChange={(e) => setCounted({ ...counted, [l.flavour]: e.target.value.replace(/\D/g, '') })}
            help={t('receive.ordered', { n: num(l.units), c: num(l.cartons) })}
          />
        ))}
        {receive.fields.unitsReceived && <p className="an-help error">{receive.fields.unitsReceived}</p>}
        {short && <p className="body-sm muted">{t('receive.shortHelp')}</p>}
      </div>

      <Switch checked={hasInvoice} onChange={setHasInvoice} label={t('receive.hasInvoice')} />
      {hasInvoice ? (
        <>
          <div className="form-grid">
            <TextField label={t('invoice.number')} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} error={receive.fields.supplierInvoiceNumber} />
            <TextField label={t('invoice.dueOn')} type="date" value={invoiceDueOn} onChange={(e) => setInvoiceDueOn(e.target.value)} error={receive.fields.supplierInvoiceDueOn} />
          </div>
          <MoneyField label={t('invoice.amount')} cents={invoiceNet} onCents={setInvoiceNet} help={t('invoice.amountHelp', { amount: money(p.goodsCents) })} />
          <FilePick label={t('invoice.upload')} file={invoiceFile} onFile={setInvoiceFile} />
        </>
      ) : (
        <p className="body-sm muted">{t('receive.laterInvoice')}</p>
      )}

      <Switch checked={hasFreight} onChange={setHasFreight} label={t('receive.hasFreight')} />
      {hasFreight && <FreightFields f={f} fields={receive.fields} />}

      <Totals
        lines={[
          [tc('units'), num(units)],
          [t('costs.goods'), money(goods)],
          [t('costs.freight'), money(freight)],
          [t('costs.excise'), money(excise)],
          [t('costs.inventory'), money(goods + freight + excise)],
        ]}
        big={[t('costs.landed'), unit(landed, 4)]}
      />
      <p className="body-sm muted">{t('receive.consequence', { n: num(units), orders: detail.waiting.length })}</p>
      <ErrorBanner a={receive} />
    </Sheet>
  );
}

/** FR-PUR-8 Edit freight, with the effect on inventory cost and landed unit cost. */
function FreightSheet({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const { money, unit } = useFmt();
  const p = detail.purchase;
  const fig = detail.figures;
  const f = useFreightFields(detail);
  const newFreight = f.netCents ?? 0;
  const newInventory = fig.goodsCents + newFreight + fig.exciseCents;
  const newLanded = landedUnitCostCents(fig.goodsCents, newFreight, fig.exciseCents, fig.units);
  const save = useAction(() => api.post(`/purchases/${p.id}/freight`, formWith(freightBody(f), { file: f.file })), { success: t('freight.done'), onDone: onClose });
  const diff = (from: string, to: string) => (from === to ? to : (
    <span className="diff">
      <span className="from">{from}</span>
      <span>{to}</span>
    </span>
  ));

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('freight.title')}
      sub={<bdi>{p.number}</bdi>}
      dirty
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={!f.carrier.trim() || f.netCents == null || !f.payBy} busy={save.isPending} onClick={() => save.mutate(undefined)}>
            {t('freight.cta')}
          </Button>
        </>
      }
    >
      <FreightFields f={f} fields={save.fields} />
      <Totals
        lines={[
          [t('costs.freight'), diff(money(fig.freightCents), money(newFreight))],
          [t('costs.inventory'), diff(money(fig.inventoryCostCents), money(newInventory))],
        ]}
        big={[fig.landedEstimated ? t('costs.landedEstimate') : t('costs.landed'), diff(unit(fig.landedUnitCostCents, 4), unit(newLanded, 4))]}
      />
      <p className="body-sm muted">{t('freight.consequence')}</p>
      {f.existing && f.existing.paidCents > 0 && <Banner>{t('freight.alreadyPaid', { amount: money(f.existing.paidCents) })}</Banner>}
      <ErrorBanner a={save} />
    </Sheet>
  );
}

/** FR-PUR-9 Ask supplier: topic, recipient and a pre-written e-mail with the purchase details. */
function AskSupplierSheet({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const { num, date } = useFmt();
  const p = detail.purchase;
  const s = detail.supplier;
  const [topic, setTopic] = useState<Topic>(p.daysLate > 0 ? 'arrival_date' : p.status === 'received' && !p.supplierInvoiceReceived ? 'invoice_copy' : 'tracking');
  const [to, setTo] = useState(s.ordersEmail);
  const linesText = useMemo(() => detail.lines.map((l) => `- ${l.flavour.toUpperCase()}: ${t('ask.lineText', { c: num(l.cartons), u: num(l.units) })}`).join('\n'), [detail.lines, t, num]);
  const make = (tp: Topic): Draft => ({
    subject: t(`ask.subject.${tp}`, { number: p.number }),
    body: t(`ask.body.${tp}`, {
      name: s.contactName || s.company,
      number: p.number,
      ordered: date(p.orderedOn),
      expected: date(p.expectedOn),
      lines: linesText,
      days: p.daysLate,
    }),
  });
  const [draft, setDraft] = useState<Draft>(() => make(topic));
  const send = useAction(() => api.post<{ followUpOn: string }>(`/purchases/${p.id}/messages`, { topic, to: to.trim(), subject: draft.subject, body: draft.body }), {
    success: (r) => t('ask.done', { date: date(r.followUpOn) }),
    onDone: onClose,
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('ask.title')}
      sub={
        <>
          <bdi>{p.number}</bdi> · <bdi>{s.company}</bdi>
        </>
      }
      dirty
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={!to.trim() || !draft.subject.trim() || !draft.body.trim()} busy={send.isPending} onClick={() => send.mutate(undefined)}>
            {t('ask.cta')}
          </Button>
        </>
      }
    >
      <div className="an-field">
        <label>{t('ask.topic')}</label>
        <div className="an-chips" role="group" aria-label={t('ask.topic')} style={{ flexWrap: 'wrap' }}>
          {TOPICS.map((tp) => (
            <button
              key={tp}
              type="button"
              className="an-chip"
              aria-pressed={topic === tp}
              onClick={() => {
                setTopic(tp);
                setDraft(make(tp));
              }}
            >
              {t(`ask.topics.${tp}`)}
            </button>
          ))}
        </div>
      </div>
      <TextField label={t('ask.to')} type="email" value={to} onChange={(e) => setTo(e.target.value)} error={send.fields.to} />
      <EmailDraft value={draft} onChange={setDraft} />
      <p className="body-sm muted">{t('ask.followUp', { n: detail.followUpDays })}</p>
      <ErrorBanner a={send} />
    </Sheet>
  );
}

/** Mark as on the way, with the shipment when it is known. */
function OnTheWaySheet({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const p = detail.purchase;
  const [expectedOn, setExpectedOn] = useState(p.expectedOn);
  const [addShipment, setAddShipment] = useState(detail.shipments.length === 0);
  const [carrier, setCarrier] = useState('');
  const [mode, setMode] = useState<(typeof MODES)[number]>('road');
  const [route, setRoute] = useState(`${detail.supplier.country} → Sofia`);
  const [departOn, setDepartOn] = useState(isoDate());
  const mark = useAction(
    () =>
      api.post(`/purchases/${p.id}/on-the-way`, {
        expectedOn,
        shipment: addShipment && carrier.trim() ? { carrier: carrier.trim(), mode, route: route.trim() || undefined, departOn, arriveOn: expectedOn } : undefined,
      }),
    { success: t('onTheWay.done'), onDone: onClose },
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('onTheWay.title')}
      sub={<bdi>{p.number}</bdi>}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={addShipment && !carrier.trim()} busy={mark.isPending} onClick={() => mark.mutate(undefined)}>
            {t('onTheWay.cta')}
          </Button>
        </>
      }
    >
      <TextField label={t('onTheWay.expectedOn')} type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} error={mark.fields.expectedOn} />
      <Switch checked={addShipment} onChange={setAddShipment} label={t('onTheWay.addShipment')} />
      {addShipment && (
        <>
          <TextField label={t('freight.carrier')} value={carrier} onChange={(e) => setCarrier(e.target.value)} error={mark.fields['shipment.carrier']} />
          <div className="an-field">
            <label>{t('shipments.mode')}</label>
            <Segmented fill label={t('shipments.mode')} value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: t(`shipments.modes.${m}`) }))} />
          </div>
          <TextField label={t('shipments.route')} value={route} onChange={(e) => setRoute(e.target.value)} />
          <TextField label={t('onTheWay.departOn')} type="date" value={departOn} onChange={(e) => setDepartOn(e.target.value)} />
        </>
      )}
      <ErrorBanner a={mark} />
    </Sheet>
  );
}

/** Supplier invoice that arrives after (or before) the goods. */
function InvoiceSheet({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const { money } = useFmt();
  const p = detail.purchase;
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [dueOn, setDueOn] = useState(dayPlus(p.arrivedOn ?? isoDate(), detail.supplier.paymentTermsDays));
  const [net, setNet] = useState<number | null>(p.goodsCents);
  const [file, setFile] = useState<File | null>(null);
  const save = useAction(() => api.post(`/purchases/${p.id}/invoice`, formWith({ invoiceNumber: invoiceNumber.trim(), dueOn, netCents: net ?? undefined }, { file })), { success: t('invoice.done'), onDone: onClose });
  const vat = Math.round((net ?? 0) * detail.figures.supplierVatRate);
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('invoice.title')}
      sub={<bdi>{p.number}</bdi>}
      dirty
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={!invoiceNumber.trim() || !dueOn || net == null} busy={save.isPending} onClick={() => save.mutate(undefined)}>
            {t('invoice.cta')}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <TextField label={t('invoice.number')} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} error={save.fields.invoiceNumber} />
        <TextField label={t('invoice.dueOn')} type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} error={save.fields.dueOn} />
      </div>
      <MoneyField label={t('invoice.amount')} cents={net} onCents={setNet} error={save.fields.netCents} help={t('invoice.amountHelp', { amount: money(p.goodsCents) })} />
      <FilePick label={t('invoice.upload')} file={file} onFile={setFile} />
      <Totals lines={[[tc('totalExclVat'), money(net ?? 0)], [t('invoice.vat', { rate: Math.round(detail.figures.supplierVatRate * 100) }), money(vat)]]} big={[tc('totalInclVat'), money((net ?? 0) + vat)]} />
      <p className="body-sm muted">{p.status === 'received' ? t('invoice.consequenceReceived') : t('invoice.consequence')}</p>
      <ErrorBanner a={save} />
    </Sheet>
  );
}

function UploadSheet({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const up = useAction(() => api.post(`/purchases/${detail.purchase.id}/documents`, formWith({ label: label.trim() || undefined }, { file })), { success: t('docs.done'), onDone: onClose });
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('docs.upload')}
      sub={<bdi>{detail.purchase.number}</bdi>}
      footer={
        <>
          <Button onClick={onClose}>{tc('cancel')}</Button>
          <Button variant="primary" disabled={!file} busy={up.isPending} onClick={() => up.mutate(undefined)}>
            {t('docs.cta')}
          </Button>
        </>
      }
    >
      <TextField label={t('docs.label')} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('docs.labelPlaceholder')} />
      <FilePick label={t('docs.file')} file={file} onFile={setFile} />
      <ErrorBanner a={up} />
    </Sheet>
  );
}
