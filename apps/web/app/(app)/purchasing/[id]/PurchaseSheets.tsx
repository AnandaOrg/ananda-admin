'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { addDays, isoDate } from '@ananda/shared';
import { api, type ApiError } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { ActionError, Banner, Button, MoneyField, Segmented, Sheet, Switch, TextField } from '@/components/ui';
import { EmailDraft, type Draft } from '@/components/EmailDraft';
import { FilePick } from '../_components/FilePick';
import { formWith, type PurchaseDetail } from '../_lib/types';
import css from '../purchasing.module.css';
import { DateField } from '../../money/_components/date-field';

export type SheetKey = 'receive' | 'freight' | 'ask' | 'on_the_way' | 'invoice';

const MODES = ['road', 'sea', 'air', 'rail'] as const;
const FREIGHT_STEPS = [-50000, -10000, 10000, 50000];
const FREIGHT_PAY_DAYS = 14;

function dayPlus(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(addDays(new Date(y, m - 1, d), days));
}

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
  }
}

function ErrorBanner({ a }: { a: { error: ApiError | null; retry: () => void; errorText: string | null; fields: Record<string, string> } }) {
  if (!a.error) return null;
  return <ActionError action={a} message={a.fields._ ?? a.errorText} />;
}

/** Invoice number and amount incl. VAT, shown once the supplier's invoice file is chosen (or always with `always`). */
function InvoiceFields({ number, setNumber, gross, setGross, fields }: { number: string; setNumber: (v: string) => void; gross: number | null; setGross: (v: number | null) => void; fields: Record<string, string> }) {
  const t = useTranslations('purchasing');
  return (
    <div className="form-grid">
      <TextField label={t('invoice.number')} value={number} onChange={(e) => setNumber(e.target.value)} error={fields.supplierInvoiceNumber ?? fields.invoiceNumber} />
      <MoneyField label={t('invoice.amountInclVat')} cents={gross} onCents={setGross} error={fields.invoiceNetCents ?? fields.netCents} />
    </div>
  );
}

/** Carrier invoice: a dropped file, then who carried it and the freight before VAT. */
function CarrierFields({ detail, file, setFile, carrier, setCarrier, net, setNet, fields }: { detail: PurchaseDetail; file: File | null; setFile: (f: File | null) => void; carrier: string; setCarrier: (v: string) => void; net: number | null; setNet: (v: number | null) => void; fields: Record<string, string> }) {
  const t = useTranslations('purchasing');
  void detail;
  return (
    <>
      <FilePick label={t('receive.carrierInvoice')} file={file} onFile={setFile} />
      {file && (
        <div className="form-grid">
          <TextField label={t('freight.carrier')} value={carrier} onChange={(e) => setCarrier(e.target.value)} error={fields['freight.carrier'] ?? fields.carrier} />
          <MoneyField label={t('freight.amount')} cents={net} onCents={setNet} error={fields['freight.amountNetCents'] ?? fields.amountNetCents} />
        </div>
      )}
    </>
  );
}

/** FR-PUR-7 Mark as received: goods go into stock, the landed cost is worked out; the invoice can come later. */
function ReceiveSheet({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const { num } = useFmt();
  const p = detail.purchase;
  const s = detail.supplier;
  const rate = detail.figures.supplierVatRate;
  const freightBill = detail.payables.find((x) => x.kind === 'freight');
  const [arrivedOn, setArrivedOn] = useState(isoDate());
  const [counted, setCounted] = useState<Record<string, string>>(Object.fromEntries(detail.lines.map((l) => [l.flavour, String(l.units)])));
  const [perFlavour, setPerFlavour] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [gross, setGross] = useState<number | null>(Math.round(p.goodsCents * (1 + rate)));
  const [carrierFile, setCarrierFile] = useState<File | null>(null);
  const [carrier, setCarrier] = useState(freightBill?.party ?? detail.shipments[0]?.carrier ?? '');
  const [freightNet, setFreightNet] = useState<number | null>(freightBill?.netCents ?? (p.freightCents || null));

  const units = detail.lines.reduce((sum, l) => sum + Math.max(0, parseInt(counted[l.flavour] || '0', 10) || 0), 0);
  const hasInvoice = !!invoiceFile || !!invoiceNumber.trim();
  const withFreight = !!carrierFile && !!carrier.trim() && freightNet != null;

  const receive = useAction(
    () =>
      api.post<{ waitingOrders: number }>(
        `/purchases/${p.id}/receive`,
        formWith(
          {
            arrivedOn,
            unitsReceived: Object.fromEntries(detail.lines.map((l) => [l.flavour, Math.max(0, parseInt(counted[l.flavour] || '0', 10) || 0)])),
            ...(hasInvoice ? { supplierInvoiceNumber: invoiceNumber.trim() || undefined, invoiceNetCents: gross != null ? Math.round(gross / (1 + rate)) : undefined } : {}),
            ...(withFreight ? { freight: { carrier: carrier.trim(), amountNetCents: freightNet ?? 0, vatRate: freightBill?.vatRate ?? 0.2, invoiceNumber: freightBill?.invoiceNumber ?? undefined, payBy: freightBill?.dueOn ?? dayPlus(arrivedOn, FREIGHT_PAY_DAYS) } } : {}),
          },
          { supplierInvoice: invoiceFile, carrierInvoice: carrierFile },
        ),
      ),
    {
      success: (r) => (r.waitingOrders > 0 ? t('receive.doneWaiting', { n: r.waitingOrders }) : hasInvoice ? t('receive.done') : t('receive.doneNoInvoice')),
      successAction: (r) => (r.waitingOrders > 0 ? { label: t('detail.allocate'), href: '/inventory?allocate=1' } : undefined),
      onDone: onClose,
    },
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('receive.titleNumber', { number: p.number })}
      dirty={hasInvoice || !!carrierFile}
      footer={
        <Button variant="primary" block disabled={units <= 0 || (!!carrierFile && !withFreight)} busy={receive.isPending} onClick={() => receive.mutate(undefined)}>
          {hasInvoice ? t('receive.cta') : t('receive.ctaNoInvoice')}
        </Button>
      }
    >
      <p className="body-sm muted">{t('receive.lead')}</p>
      <div className="form-grid">
        <DateField label={t('receive.arrived')} value={arrivedOn} max={isoDate()} onChange={setArrivedOn} error={receive.fields.arrivedOn} />
        <TextField label={t('receive.counted')} value={num(units)} readOnly />
      </div>
      {!perFlavour ? (
        <button type="button" className={`link body-sm ${css.textLink}`} onClick={() => setPerFlavour(true)}>
          {t('receive.countDiffers')}
        </button>
      ) : (
        <div className="form-grid">
          {detail.lines.map((l) => (
            <TextField
              key={l.flavour}
              label={t('receive.unitsOf', { flavour: l.flavour.toUpperCase() })}
              inputMode="numeric"
              value={counted[l.flavour]}
              onChange={(e) => setCounted({ ...counted, [l.flavour]: e.target.value.replace(/\D/g, '') })}
              help={t('receive.ordered', { n: num(l.units) })}
            />
          ))}
        </div>
      )}
      {receive.fields.unitsReceived && <p className="an-help error">{receive.fields.unitsReceived}</p>}

      <label>{t('receive.supplierInvoice')}</label>
      <FilePick zone file={invoiceFile} onFile={setInvoiceFile} placeholder={t('receive.dropInvoice')} />
      {invoiceFile && <InvoiceFields number={invoiceNumber} setNumber={setInvoiceNumber} gross={gross} setGross={setGross} fields={receive.fields} />}
      <CarrierFields detail={detail} file={carrierFile} setFile={setCarrierFile} carrier={carrier} setCarrier={setCarrier} net={freightNet} setNet={setFreightNet} fields={receive.fields} />
      {!hasInvoice && <p className="body-sm muted">{t('receive.laterInvoice', { supplier: s.company })}</p>}
      <ErrorBanner a={receive} />
    </Sheet>
  );
}

/** The supplier's invoice after the goods: creates the bill on Payables. */
function InvoiceSheet({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const p = detail.purchase;
  const rate = detail.figures.supplierVatRate;
  const freightBill = detail.payables.find((x) => x.kind === 'freight');
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState('');
  const [gross, setGross] = useState<number | null>(Math.round(p.goodsCents * (1 + rate)));
  const [carrierFile, setCarrierFile] = useState<File | null>(null);
  const [carrier, setCarrier] = useState(freightBill?.party ?? detail.shipments[0]?.carrier ?? '');
  const [freightNet, setFreightNet] = useState<number | null>(freightBill?.netCents ?? (p.freightCents || null));
  const dueOn = dayPlus(p.arrivedOn ?? isoDate(), detail.supplier.paymentTermsDays);
  const withFreight = !!carrierFile && !!carrier.trim() && freightNet != null;

  const save = useAction(
    async () => {
      await api.post(`/purchases/${p.id}/invoice`, formWith({ invoiceNumber: number.trim() || file?.name || p.number, dueOn, netCents: gross != null ? Math.round(gross / (1 + rate)) : undefined }, { file }));
      if (withFreight) await api.post(`/purchases/${p.id}/freight`, formWith({ carrier: carrier.trim(), amountNetCents: freightNet ?? 0, vatRate: freightBill?.vatRate ?? 0.2, invoiceNumber: freightBill?.invoiceNumber ?? undefined, payBy: freightBill?.dueOn ?? dayPlus(isoDate(), FREIGHT_PAY_DAYS) }, { file: carrierFile }));
    },
    { success: t('invoice.done', { number: p.number }), successAction: { label: tc('view'), href: '/purchasing/payables' }, onDone: onClose },
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('invoice.titleNumber', { number: p.number })}
      dirty={!!file}
      footer={
        <Button variant="primary" block disabled={!file || !number.trim() || gross == null || (!!carrierFile && !withFreight)} busy={save.isPending} onClick={() => save.mutate(undefined)}>
          {t('invoice.cta')}
        </Button>
      }
    >
      <p className="body-sm muted">{t('invoice.lead', { supplier: detail.supplier.company })}</p>
      <label>{t('receive.supplierInvoice')}</label>
      <FilePick zone file={file} onFile={setFile} placeholder={t('receive.dropInvoice')} />
      {file && <InvoiceFields number={number} setNumber={setNumber} gross={gross} setGross={setGross} fields={save.fields} />}
      <CarrierFields detail={detail} file={carrierFile} setFile={setCarrierFile} carrier={carrier} setCarrier={setCarrier} net={freightNet} setNet={setFreightNet} fields={save.fields} />
      <ErrorBanner a={save} />
    </Sheet>
  );
}

/** FR-PUR-8 Edit freight: the landed unit cost is recalculated. */
function FreightSheet({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const { money } = useFmt();
  const p = detail.purchase;
  const existing = detail.payables.find((x) => x.kind === 'freight');
  const [net, setNet] = useState<number | null>(existing?.netCents ?? detail.figures.freightCents);
  const [carrier, setCarrier] = useState(existing?.party ?? detail.shipments[0]?.carrier ?? '');
  const [file, setFile] = useState<File | null>(null);
  const save = useAction(
    () =>
      api.post(
        `/purchases/${p.id}/freight`,
        formWith({ carrier: carrier.trim(), amountNetCents: net ?? 0, vatRate: existing?.vatRate ?? 0.2, invoiceNumber: existing?.invoiceNumber ?? undefined, payBy: existing?.dueOn ?? dayPlus(isoDate(), FREIGHT_PAY_DAYS) }, { file }),
      ),
    { success: t('freight.done'), onDone: onClose },
  );
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('freight.titleNumber', { number: p.number })}
      dirty={net !== (existing?.netCents ?? detail.figures.freightCents) || !!file}
      footer={
        <Button variant="primary" block disabled={!carrier.trim() || net == null} busy={save.isPending} onClick={() => save.mutate(undefined)}>
          {t('freight.cta')}
        </Button>
      }
    >
      <p className="body-sm muted">{t('freight.lead', { supplier: detail.supplier.company.replace(/\.+$/, '') })}</p>
      <MoneyField key={net ?? 'x'} label={t('freight.amount')} cents={net} onCents={setNet} error={save.fields.amountNetCents} />
      <div className={`an-chips ${css.chipRow}`} role="group" aria-label={t('freight.amount')}>
        {FREIGHT_STEPS.map((v) => (
          <button key={v} type="button" className="an-chip" onClick={() => setNet(Math.max(0, (net ?? 0) + v))}>
            {v > 0 ? '+' : '−'}
            {money(Math.abs(v), true)}
          </button>
        ))}
      </div>
      <TextField label={t('freight.carrier')} value={carrier} onChange={(e) => setCarrier(e.target.value)} error={save.fields.carrier} />
      <FilePick label={t('freight.upload')} file={file} onFile={setFile} />
      {existing && existing.paidCents > 0 && <Banner>{t('freight.alreadyPaid', { amount: money(existing.paidCents) })}</Banner>}
      <ErrorBanner a={save} />
    </Sheet>
  );
}

/** FR-PUR-9 Ask supplier: a pre-written e-mail with the purchase details; a follow-up shows if there is no answer. */
function AskSupplierSheet({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const { date } = useFmt();
  const p = detail.purchase;
  const s = detail.supplier;
  const topic = p.status === 'received' ? (p.supplierInvoiceReceived ? 'other' : 'invoice_copy') : 'arrival_date';
  const initial = useMemo<Draft>(() => ({ subject: t(`ask.subject.${topic}`, { number: p.number }), body: t(`ask.body.${topic}`, { number: p.number, expected: date(p.expectedOn), ordered: date(p.orderedOn) }) }), [t, topic, p.number, p.expectedOn, p.orderedOn, date]);
  const [draft, setDraft] = useState<Draft>(initial);
  const to = s.ordersEmail;
  const send = useAction(() => api.post<{ followUpOn: string }>(`/purchases/${p.id}/messages`, { topic, to, subject: draft.subject, body: draft.body }), {
    success: t('ask.done'),
    onDone: onClose,
  });
  const dirty = draft.subject !== initial.subject || draft.body !== initial.body;
  return (
    <Sheet
      open
      onClose={onClose}
      title={t('ask.mailTitle')}
      dirty={dirty}
      footer={
        <>
          <Button onClick={onClose}>{tc('discard')}</Button>
          <Button variant="primary" disabled={!draft.subject.trim() || !draft.body.trim()} busy={send.isPending} onClick={() => send.mutate(undefined)}>
            {t('ask.cta')}
          </Button>
        </>
      }
    >
      <EmailDraft value={draft} onChange={setDraft} to={`${s.company} · ${to}`} />
      <p className="body-sm muted">{t('ask.fromNote')}</p>
      <ErrorBanner a={send} />
    </Sheet>
  );
}

/** Mark as on the way, with the shipment when it is known. */
function OnTheWaySheet({ detail, onClose }: { detail: PurchaseDetail; onClose: () => void }) {
  const t = useTranslations('purchasing');
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
        <Button variant="primary" block disabled={addShipment && !carrier.trim()} busy={mark.isPending} onClick={() => mark.mutate(undefined)}>
          {t('onTheWay.cta')}
        </Button>
      }
    >
      <DateField label={t('onTheWay.expectedOn')} value={expectedOn} onChange={setExpectedOn} error={mark.fields.expectedOn} />
      <Switch checked={addShipment} onChange={setAddShipment} label={t('onTheWay.addShipment')} />
      {addShipment && (
        <>
          <TextField label={t('freight.carrier')} value={carrier} onChange={(e) => setCarrier(e.target.value)} error={mark.fields['shipment.carrier']} />
          <div className="an-field">
            <label>{t('shipments.mode')}</label>
            <Segmented fill label={t('shipments.mode')} value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m, label: t(`shipments.modes.${m}`) }))} />
          </div>
          <TextField label={t('shipments.route')} value={route} onChange={(e) => setRoute(e.target.value)} />
          <DateField label={t('onTheWay.departOn')} value={departOn} onChange={setDepartOn} />
        </>
      )}
      <ErrorBanner a={mark} />
    </Sheet>
  );
}
