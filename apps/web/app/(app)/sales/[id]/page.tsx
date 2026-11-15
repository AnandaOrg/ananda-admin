'use client';

import { use, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, PAYMENT_METHODS, isoDate, orderFlowIndex, tierFor, type Flavour, type OrderStatus, type OrderUploadKind } from '@ananda/shared';
import { api } from '@/lib/api';
import { iso, useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import {
  ActionError,
  ArrowCounterClockwise,
  Banner,
  Bank,
  Button,
  Card,
  Check,
  CheckCircle,
  Count,
  EnvelopeSimple,
  Eye,
  FileText,
  FLAVOUR_VAR,
  Icon,
  Lock,
  MinusCircle,
  MoneyField,
  NotePencil,
  PageHeader,
  PageState,
  Phone,
  Pill,
  Table,
  Tag,
  TextField,
  Truck,
  TwoStepField,
  UploadSimple,
  DateField,
} from '@/components/ui';
import { SalesStatus, Picker, SumBox, firstName } from '../ui';
import { NewSaleSheet } from '../NewSaleSheet';
import { OrderActionSheet, type ActionKey } from './OrderActions';
import { DocPanel, type DocItem } from './DocPanel';
import { UploadSheet } from './UploadSheet';

export interface OrderDoc {
  id: string;
  type: 'proforma' | 'invoice' | 'credit_note' | 'purchase_order' | 'delivery_note' | 'upload';
  number: string | null;
  createdAt: string;
  totalCents: number | null;
  language: string;
  supersededById: string | null;
  fileName: string | null;
  mimeType: string | null;
  label: string | null;
  createdById: string | null;
  createdByName: string | null;
  uploadKind: OrderUploadKind | null;
  description: string | null;
  reason: string | null;
  references: string | null;
  replaces: string | null;
  priceAdjustment: boolean;
  openedAt: string | null;
}

export interface OrderDetail {
  order: {
    id: string;
    number: string;
    status: OrderStatus;
    customerId: string | null;
    brokerId: string;
    createdAt: string;
    requestSentAt: string | null;
    paidAt: string | null;
    sentToWarehouseAt: string | null;
    deliveredAt: string | null;
    invoicedAt: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    paymentDueOn: string | null;
    holdReleasedAt: string | null;
    allocated: boolean;
    totalCartons: number;
    totalUnits: number;
    tierUnitPriceCents: number;
    unitPriceCents: number;
    specialUnitPriceCents: number | null;
    netCents: number;
    vatCents: number;
    totalCents: number;
    paidCents: number;
    creditedCents: number;
    commissionCents: number;
    outstandingCents: number;
    daysLate: number;
    note: string | null;
    partDeliveryOutcome: 'credit_note' | 'redeliver' | null;
    paymentTerms?: 'before_shipping' | 'half_before_shipping' | 'after_delivery_30';
  };
  lines: { id: string; flavour: Flavour; cartons: number; units: number; unitPriceCents: number; lineNetCents: number; deliveredCartons: number | null; creditedCartons: number; remainingCartons: number }[];
  tier: { minCartons: number; maxCartons: number; unitPriceCents: number } | null;
  customer: {
    id: string;
    companyName: string;
    vatNumber: string;
    vatValid: boolean | null;
    contactName: string;
    phone: string;
    invoiceEmail: string;
    deliveryAddress: string;
    city: string | null;
    paymentTermsDays: number;
    paymentTerms?: 'before_shipping' | 'half_before_shipping' | 'after_delivery_30';
    proformaLanguage: string;
  } | null;
  broker: { id: string; name: string; email: string };
  houseSale: boolean;
  payments: { id: string; receivedOn: string; amountCents: number; method: string; bankReference: string | null; createdAt: string; confirmedByName: string | null }[];
  documents: OrderDoc[];
  pendingApproval: { id: string; type: string; reason: string | null; payload: Record<string, unknown>; createdAt: string } | null;
  approvals: { id: string; type: string; status: string; declineReason: string | null; declineMessage: string | null; decidedAt: string | null; payload: Record<string, unknown> }[];
  commission: { status: string; amountCents: number }[];
  waitingFor: { flavour: Flavour; neededUnits: number; availableUnits: number; purchase: { id: string; number: string; expectedOn: string } | null }[];
  timeline: { id: string; at: string; actorName: string | null; action: string; meta: Record<string, unknown> | null }[];
  cancelNote: string | null;
  paper: { company: Record<string, string>; bank: { bank: string; iban: string }; brand?: { logo?: string | null; footer?: string | null }; language?: string };
  actions: string[];
}

const METHOD_SUB: Record<string, string> = { bank_transfer: 'methodBank', cash: 'methodCash', card: 'methodCard', other: 'methodOther' };

/**
 * The order page (10 Nov prototype, S-0008): the customer as title and one status; the five-step flow
 * where each step unlocks the next; what's in it; money, customer and every document on the right.
 * Only the actions possible now: Correction or Cancel before shipping, Credit note after the invoice.
 */
export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const router = useRouter();
  const search = useSearchParams();
  const { canView, isBroker } = useSession();
  const { money, unit, num, date } = useFmt();
  const [action, setAction] = useState<ActionKey | null>(null);
  const [doc, setDoc] = useState<DocItem | null>(null);
  const [upload, setUpload] = useState(false);
  const [edit, setEdit] = useState(search.get('edit') === '1');
  const q = useQuery({ queryKey: ['orders', id], queryFn: () => api.get<OrderDetail>(`/orders/${id}`) });

  // Confirm payment, inline in step 2.
  const [receivedOn, setReceivedOn] = useState(isoDate());
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [method, setMethod] = useState<string>('bank_transfer');
  const [bankReference, setBankReference] = useState('');
  const [code, setCode] = useState('');
  useEffect(() => {
    if (q.data && amountCents == null) {
      const x = q.data.order;
      const dep = Math.ceil((x.totalCents - x.creditedCents) / 2);
      // 50% now: the first payment asked for is the deposit.
      setAmountCents(x.paymentTerms === 'half_before_shipping' && x.paidCents < dep ? dep - x.paidCents : x.outstandingCents);
    }
  }, [q.data, amountCents]);

  const sendRequest = useAction(() => api.post(`/orders/${id}/send`), { success: t('flow.toast.sent'), errorToast: true });
  const confirm = useAction(() => api.post<{ full: boolean }>(`/orders/${id}/confirm-payment`, { receivedOn, amountCents, method, bankReference: bankReference || undefined }, { code }), {
    success: (r) => (r.full ? (q.data?.order.paymentTerms === 'after_delivery_30' ? t('flow.toast.paidAfter') : t('flow.toast.paid')) : t('flow.toast.partPaid')),
    onDone: () => {
      setCode('');
      setAmountCents(null);
      setBankReference('');
    },
  });
  const toWarehouse = useAction(() => api.post(`/orders/${id}/send-to-warehouse`), { success: t('flow.toast.sentWh'), errorToast: true });
  const invoice = useAction(() => api.post<{ invoice: string }>(`/orders/${id}/invoice`), { success: (r) => t('flow.toast.invoiced', { number: iso(r.invoice) }), errorToast: true });
  const uncancel = useAction(() => api.post(`/orders/${id}/uncancel`), { success: t('order.undone', { number: q.data?.order.number ?? '' }), errorToast: true });

  if (!q.data) return <PageState query={q} notFound={{ title: t('order.notFound'), text: t('order.notFoundText'), back: { label: t('order.back'), href: '/sales' } }} />;
  const d = q.data;
  const o = d.order;
  const can = (a: string) => d.actions.includes(a);
  const cancelled = o.status === 'cancelled';
  // Payment terms (customer card, fixed when the payment request was sent).
  const terms = o.paymentTerms ?? 'before_shipping';
  const after = terms === 'after_delivery_30';
  const half = terms === 'half_before_shipping';
  const deposit = Math.ceil((o.totalCents - o.creditedCents) / 2);
  const depositIn = half && o.paidCents >= deposit;
  const paidFull = o.paidCents > 0 && o.paidCents >= o.totalCents - o.creditedCents;
  // 30 days after delivery: request → warehouse → delivered → invoice → payment.
  const afterIndex = () => (o.status === 'draft' ? 0 : o.status === 'ready_to_send' || o.status === 'waiting_for_stock' ? 1 : o.status === 'at_warehouse' ? 2 : o.status === 'delivered' || o.status === 'delivered_part' ? 3 : paidFull ? 5 : 4);
  const step = cancelled ? (o.requestSentAt ? 1 : 0) : after ? afterIndex() : orderFlowIndex(o.status);
  const customerName = d.customer?.companyName ?? t('noCustomer');
  const brokerFirst = d.houseSale ? null : firstName(d.broker.name);

  // ---------- Documents, in order: proformas, payments, warehouse order, signed note, invoice, credit notes, uploads ----------
  const numberOf = (docId: string | null) => d.documents.find((x) => x.id === docId)?.number ?? null;
  const items: (DocItem & { at: string; icon: typeof FileText; title: string; sub: string })[] = [];
  for (const x of d.documents) {
    const at = x.createdAt;
    if (x.type === 'proforma') {
      const corrected = !!x.replaces;
      items.push({ kind: 'doc', doc: x, replacedBy: numberOf(x.supersededById), at, icon: FileText, title: corrected ? t('docs.correctedProforma', { number: x.number ?? '' }) : t('docs.proforma', { number: x.number ?? '' }), sub: x.supersededById ? t('docs.replacedBy', { date: date(at) }) : t('docs.sentToCustomer', { date: date(at) }) });
    } else if (x.type === 'invoice') items.push({ kind: 'doc', doc: x, at, icon: FileText, title: t('docs.invoice', { number: x.number ?? '' }), sub: t('docs.emailed', { date: date(at) }) });
    else if (x.type === 'credit_note') items.push({ kind: 'doc', doc: x, at, icon: MinusCircle, title: t('docs.creditNote', { number: x.number ?? '' }), sub: t('docs.creditSub', { reason: t.has(`docs.reasons.${x.reason}`) ? t(`docs.reasons.${x.reason}`) : (x.reason ?? ''), amount: money(x.totalCents ?? 0) }) });
    else if (x.type === 'delivery_note') items.push({ kind: 'file', doc: x, at, icon: CheckCircle, title: t('docs.deliveryNote'), sub: t('docs.byWarehouse', { date: date(at) }) });
    else if (x.type === 'upload') {
      const kind = x.uploadKind ? t(`docs.kinds.${x.uploadKind}`) : (x.label ?? x.fileName ?? '');
      items.push({ kind: 'file', doc: x, at, icon: x.uploadKind === 'payment_proof' ? Bank : FileText, title: x.uploadKind === 'other' && x.description ? x.description : kind, sub: t('docs.uploadedBy', { date: date(at), name: x.createdByName ?? '' }) });
    }
  }
  const proformaNo = d.documents.filter((x) => x.type === 'proforma' && !x.supersededById).at(-1)?.number ?? null;
  for (const p of d.payments) items.push({ kind: 'payment', payment: p, proforma: proformaNo, at: p.createdAt, icon: Bank, title: t('docs.payment', { amount: money(p.amountCents) }), sub: t('docs.confirmedBy', { date: date(p.receivedOn), name: p.confirmedByName ?? '' }) });
  if (o.sentToWarehouseAt) items.push({ kind: 'warehouse', at: o.sentToWarehouseAt, icon: Truck, title: t('docs.warehouse'), sub: t('docs.noPrices', { date: date(o.sentToWarehouseAt) }) });
  items.sort((a, b) => a.at.localeCompare(b.at));

  // ---------- Flow ----------
  const lastPay = d.payments.at(-1);
  const corrected = d.documents.filter((x) => x.type === 'proforma' && x.replaces).at(-1);
  const deliveredDoc = d.documents.filter((x) => x.type === 'delivery_note').at(-1);
  const invoiceDoc = d.documents.find((x) => x.type === 'invoice');
  const methodOptions = PAYMENT_METHODS.map((m) => ({ value: m, label: t(`method.${m}`), sub: t(`flow.${METHOD_SUB[m]}`) }));

  const confirmForm = (
    <div className="act">
      <div className="sales-grid2">
        <DateField label={t('flow.dateReceived')} value={receivedOn} max={isoDate()} onChange={setReceivedOn} />
        <MoneyField label={t('flow.amount')} cents={amountCents} onCents={setAmountCents} error={confirm.fields.amountCents} />
      </div>
      <Picker label={t('flow.paidBy')} value={method} options={methodOptions} placeholder={t('flow.paidBy')} onChange={setMethod} />
      <TextField label={t('flow.reference')} placeholder={t('flow.referencePh')} value={bankReference} onChange={(e) => setBankReference(e.target.value)} />
      <TwoStepField value={code} onChange={setCode} error={confirm.fields.code} />
      <Button variant="primary" block disabled={code.length !== 6 || !amountCents} busy={confirm.isPending} onClick={() => confirm.mutate(undefined)}>
        {t('flow.confirm')}
      </Button>
      <ActionError action={confirm} />
    </div>
  );

  type FlowStep = { title: string; detail: ReactNode; act?: ReactNode };
  const steps: FlowStep[] = [
    {
      title: t('flow.payment_request'),
      detail: o.requestSentAt ? (corrected ? t('flow.correctedOn', { date: date(o.requestSentAt), corrected: date(corrected.createdAt) }) : t('flow.sentOn', { date: date(o.requestSentAt) })) : t('flow.notSent'),
      act: can('send_payment_request') ? (
        <div className="act">
          <Button variant="primary" block busy={sendRequest.isPending} onClick={() => sendRequest.mutate(undefined)}>
            {t('flow.sendRequest')}
          </Button>
        </div>
      ) : undefined,
    },
    {
      title: t('flow.confirm_payment'),
      detail:
        paidFull && lastPay
          ? t('flow.paidDone', { amount: money(o.paidCents), date: date(lastPay.receivedOn), name: lastPay.confirmedByName ?? '' })
          : (() => {
              const rule = after ? (o.paymentDueOn ? t('flow.dueAfter', { date: date(o.paymentDueOn) }) : t('flow.afterDelivery')) : half ? t('flow.minimumHalf') : t('flow.minimum');
              const paid = depositIn ? t('flow.depositIn', { amount: money(o.paidCents), left: money(o.outstandingCents) }) : o.paidCents > 0 ? t('flow.partPaid', { amount: money(o.paidCents), left: money(o.outstandingCents) }) : null;
              if (!can('confirm_payment') && o.requestSentAt) return o.daysLate > 0 ? t('flow.lateNotPaid', { late: t('status.late', { n: o.daysLate }) }) : (paid ?? (after ? rule : t('flow.waitingCustomer')));
              return paid ? `${rule} · ${paid}` : rule;
            })(),
      act: can('confirm_payment') ? confirmForm : undefined,
    },
    {
      title: t('flow.send_to_warehouse'),
      detail: o.sentToWarehouseAt
        ? t('flow.sentWh', { date: date(o.sentToWarehouseAt) })
        : o.status === 'waiting_for_stock'
          ? d.waitingFor.find((w) => w.purchase)
            ? t('flow.waitingStockFrom', { purchase: d.waitingFor.find((w) => w.purchase)!.purchase!.number })
            : t('flow.waitingStock')
          : o.status === 'ready_to_send'
            ? t('flow.stockHint')
            : after
              ? t('flow.unlocksAfterRequest')
              : half
                ? depositIn
                  ? t('flow.unlocksRest', { left: money(o.outstandingCents) })
                  : t('flow.unlocksAfterFull')
                : t('flow.unlocksAfterPayment'),
      act: can('send_to_warehouse') ? (
        <div className="act">
          <Button variant="primary" icon={Truck} block busy={toWarehouse.isPending} onClick={() => toWarehouse.mutate(undefined)}>
            {t('actions.send_to_warehouse.cta')}
          </Button>
          <ActionError action={toWarehouse} />
        </div>
      ) : can('allocate') && canView('inventory') ? (
        <div className="act">
          <Button icon={Tag} writes onClick={() => router.push('/inventory?allocate=1')}>
            {t('order.allocate')}
          </Button>
        </div>
      ) : undefined,
    },
    {
      title: t('flow.delivered'),
      detail: o.deliveredAt ? (o.status === 'delivered_part' || deliveredDoc?.reason ? t('flow.deliveredPart', { date: date(o.deliveredAt) }) : t('flow.deliveredOn', { date: date(o.deliveredAt) })) : o.status === 'at_warehouse' ? t('flow.waitingNote') : t('flow.afterNote'),
    },
    {
      title: t('flow.invoice'),
      detail: invoiceDoc ? t('flow.invoiced', { number: invoiceDoc.number ?? '' }) : o.status === 'delivered' || o.status === 'delivered_part' ? undefined : after ? t('flow.whenDeliveredAfter') : t('flow.whenPaidDelivered'),
      act:
        can('part_outcome') ? (
          <div className="act">
            <Button variant="primary" block onClick={() => setAction('part_outcome')}>
              {t('flow.partOutcome')}
            </Button>
          </div>
        ) : can('issue_invoice') ? (
          <div className="act">
            <Button variant="primary" icon={FileText} block busy={invoice.isPending} onClick={() => invoice.mutate(undefined)}>
              {t('flow.issue')}
            </Button>
            <ActionError action={invoice} />
          </div>
        ) : undefined,
    },
  ];
  if (after) steps.push(...steps.splice(1, 1)); // the payment comes last

  const flow = (
    <ol className="an-steps sales-flow">
      {steps.map((s, i) => {
        const done = i < step;
        const now = i === step && !cancelled;
        return (
          <li key={i} className={`an-ps ${done ? 'done' : now ? 'now' : 'lock'}`} aria-current={now ? 'step' : undefined}>
            <span className="c">{done ? <Icon as={Check} size="sm" /> : now ? i + 1 : <Icon as={Lock} size="sm" />}</span>
            <span className="t">{s.title}</span>
            {s.detail && <span className="d">{s.detail}</span>}
            {now && s.act}
          </li>
        );
      })}
    </ol>
  );

  // ---------- What's in it ----------
  const tier = tierFor(o.totalCartons);
  const lineNote = o.specialUnitPriceCents
    ? t('order.specialNote', { n: num(o.totalCartons), price: unit(o.specialUnitPriceCents), list: unit(o.tierUnitPriceCents) })
    : tier
      ? t('order.tierNote', { n: num(o.totalCartons), tier: t('newSale.tier', { from: num(tier.minCartons), to: num(tier.maxCartons) }) })
      : '';
  const linesByFlavour = FLAVOURS.map((f) => d.lines.find((l) => l.flavour === f)).filter(Boolean) as OrderDetail['lines'];
  const flav = (f: Flavour) => (
    <span className="sales-flav">
      <i className="dot" style={{ background: FLAVOUR_VAR[f] }} aria-hidden />
      {f.toUpperCase()}
    </span>
  );

  // ---------- Money ----------
  const credits = d.documents.filter((x) => x.type === 'credit_note');
  const refund = Math.max(0, o.paidCents - (o.totalCents - o.creditedCents));
  const moneyRows: [ReactNode, ReactNode, ('big' | 'bad' | 'good' | 'warn')?][] = [
    [t('money.total'), money(o.totalCents)],
    ...(half ? [[t('money.deposit'), money(deposit), depositIn ? 'good' : undefined] as [string, string, 'good' | undefined]] : []),
    [t('money.paid'), money(o.paidCents), o.paidCents > 0 && o.paidCents >= o.totalCents - o.creditedCents ? 'good' : undefined],
    ...(after && o.paymentDueOn && o.outstandingCents > 0 ? [[t('money.due'), date(o.paymentDueOn), o.daysLate > 0 ? 'bad' : undefined] as [string, string, 'bad' | undefined]] : []),
    ...(o.paidCents > 0 && o.outstandingCents > 0 ? [[t('money.stillToPay'), money(o.outstandingCents)] as [string, string]] : []),
    ...credits.map((c) => [`${c.number} · ${t.has(`docs.reasons.${c.reason}`) ? t(`docs.reasons.${c.reason}`) : (c.reason ?? '')}`, `−${money(c.totalCents ?? 0)}`, 'bad'] as [string, string, 'bad']),
  ];
  const commissionRow: [string, string] = [t('money.commission'), d.houseSale || cancelled ? (cancelled ? money(0) : t('money.none')) : t('money.commissionValue', { amount: money(o.commissionCents) })];
  const hint = ['payment_to_confirm', 'waiting_for_stock', 'ready_to_send', 'draft'].includes(o.status) ? t('order.hintBefore') : o.status === 'invoiced' ? t('order.hintInvoiced') : t('order.hintShipped');
  const moneyBox = (
    <>
      <SumBox rows={moneyRows} plain>
        {credits.length > 0 && refund > 0 && (
          <>
            <hr className="sales-rule" />
            <div className="sales-tot">
              <span style={{ color: 'var(--text)' }}>{t('money.toRefund')}</span>
              <b className="warn-dot">
                <bdi>{money(refund)}</bdi>
              </b>
            </div>
          </>
        )}
        <div className="sales-tot">
          <span>{commissionRow[0]}</span>
          <bdi>{commissionRow[1]}</bdi>
        </div>
      </SumBox>
    </>
  );

  // ---------- Actions possible now ----------
  const writeActs = (phone: boolean) => {
    const out: ReactNode[] = [];
    const sz = phone ? 'md' : 'sm';
    if (can('edit')) out.push(<Button key="e" size={sz} icon={NotePencil} writes onClick={() => setEdit(true)}>{t('order.editDraft')}</Button>);
    if (can('special_price')) out.push(<Button key="sp" size={sz} icon={Tag} writes onClick={() => setAction('special_price')}>{t('order.specialPrice')}</Button>);
    if (can('delete')) out.push(<Button key="d" size={sz} writes className="sales-danger" onClick={() => setAction('delete')}>{t('order.deleteDraft')}</Button>);
    if (can('correction')) out.push(<Button key="c" size={sz} icon={NotePencil} writes onClick={() => setAction('correction')}>{t('order.correction')}</Button>);
    if (can('cancel')) out.push(<Button key="x" size={sz} writes className="sales-danger" onClick={() => setAction('cancel')}>{t('order.cancel')}</Button>);
    if (can('credit_note')) out.push(<Button key="cn" size={sz} icon={FileText} writes onClick={() => setAction('credit_note')}>{t('order.creditNote')}</Button>);
    return out;
  };
  const uploadBtn = (phone: boolean) =>
    can('upload') ? (
      <Button size={phone ? 'md' : 'sm'} icon={UploadSimple} writes block={phone} onClick={() => setUpload(true)}>
        {t('order.upload')}
      </Button>
    ) : null;

  const pending = d.pendingApproval;
  const lastDecline = d.approvals.find((a) => a.status === 'declined');
  const kicker = d.houseSale ? (
    t('order.kickerHouse', { number: o.number, date: date(o.createdAt) })
  ) : (
    <span className="sales-kick">
      <span>{t('order.kicker', { number: o.number, date: date(o.createdAt) })}</span>
      <Pill tone="blue">{d.broker.name}</Pill>
    </span>
  );

  const documentsCard = (
    <Card
      className="o5"
      title={
        <span className="sales-docs-h">
          {t('order.documents')}
          {items.length > 0 && <Count n={items.length} />}
        </span>
      }
    >
      {items.length === 0 ? (
        <p className="body-sm subtle">{t('order.noDocuments')}</p>
      ) : (
        <div className="sales-docs">
          {items.map((it, i) => (
            <div key={i} className="an-doc">
              <span className="ico">
                <Icon as={it.icon} />
              </span>
              <span className="grow">
                <span className="t">{it.title}</span>
                <span className="sub">{it.sub}</span>
              </span>
              <span className="row">
                <button type="button" className="an-iconbtn" aria-label={t('docs.open', { name: it.title })} onClick={() => setDoc(it)}>
                  <Icon as={Eye} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {can('upload') && (
        <div className="stack tight only-wide" style={{ marginTop: 'var(--space-3)' }}>
          {uploadBtn(false)}
          <span className="sales-hint">{t('order.uploadHint')}</span>
        </div>
      )}
    </Card>
  );

  const custTerms = d.customer?.paymentTerms;
  const termsText = custTerms && custTerms !== 'before_shipping' ? t(`order.termsKind.${custTerms}`) : t('order.termsFull');

  return (
    <div className="page sales-order">
      <PageHeader
        crumbs={[{ label: tc('nav.sales'), href: '/sales' }, { label: o.number }]}
        kicker={<span className="only-wide">{kicker}</span>}
        title={
          <span className="sales-title">
            {customerName}
            <SalesStatus status={o.status} daysLate={o.daysLate} page />
          </span>
        }
        actions={
          (writeActs(false).length > 0 || can('upload')) && (
            <span className="only-wide row" style={{ gap: 'var(--space-2)' }}>
              {writeActs(false)}
            </span>
          )
        }
      />
      <p className="sales-sub only-phone">{d.houseSale ? t('order.kickerHouse', { number: o.number, date: date(o.createdAt) }) : t('order.kickerPhone', { number: o.number, date: date(o.createdAt), broker: d.broker.name })}</p>

      {cancelled && (
        <div className="sales-cancelled" role="status">
          <span>
            <b>{t('order.cancelledTitle')}</b>
            <span className="m">
              {d.houseSale ? t('order.cancelledTextHouse') : t('order.cancelledText', { broker: brokerFirst ?? '' })}
              {o.cancelReason && ` ${t('order.cancelledReason', { reason: t.has(`actions.cancel.reasons.${o.cancelReason}`) ? t(`actions.cancel.reasons.${o.cancelReason}`) : o.cancelReason })}`}
              {d.cancelNote && ` · ${d.cancelNote}`}
            </span>
          </span>
          {can('uncancel') && (
            <Button size="sm" icon={ArrowCounterClockwise} writes busy={uncancel.isPending} onClick={() => uncancel.mutate(undefined)}>
              {t('order.undo')}
            </Button>
          )}
        </div>
      )}
      {o.status === 'waiting_for_stock' && d.waitingFor.length > 0 && (
        <Banner sub={d.waitingFor.map((w) => `${w.flavour.toUpperCase()}: ${t('order.short', { need: num(w.neededUnits), have: num(w.availableUnits) })}${w.purchase ? ` · ${w.purchase.number} ${t('order.expected', { date: date(w.purchase.expectedOn) })}` : ` · ${t('order.noPurchase')}`}`).join('\n')}>
          {t('order.waitingTitle')}
        </Banner>
      )}
      {pending && <Banner sub={pending.reason ?? undefined}>{t(`order.pending.${pending.type}`)}</Banner>}
      {o.status === 'draft' && lastDecline && (
        <Banner tone="bad" sub={[lastDecline.declineReason && tc(`reasons.decline.${lastDecline.declineReason}`), lastDecline.declineMessage].filter(Boolean).join(' · ')}>
          {t('order.declined')}
        </Banner>
      )}
      {o.holdReleasedAt && o.status === 'payment_to_confirm' && !o.allocated && <Banner>{t('order.holdReleased', { date: date(o.holdReleasedAt) })}</Banner>}

      <div className="sales-cols">
        <div className="sales-col">
          <Card className={`o1 ${cancelled ? 'sales-flow-off' : ''}`} title={t('order.flow')}>
            <p className="sales-sub only-wide">{t('order.flowSub')}</p>
            {flow}
          </Card>
          <Card className="o3" title={t('order.lines')}>
            <div className="only-wide">
              <Table
                rowKey={(l) => l.id}
                rows={linesByFlavour}
                columns={[
                  { key: 'f', header: t('order.colFlavour'), render: (l) => flav(l.flavour) },
                  { key: 'c', header: t('order.colCartons'), type: 'count', render: (l) => <>{l.deliveredCartons != null && l.deliveredCartons !== l.cartons ? `${num(l.deliveredCartons)} / ${num(l.cartons)}` : num(l.cartons)}</> },
                  { key: 'u', header: t('order.colUnits'), type: 'count', render: (l) => num(l.units) },
                  { key: 'p', header: t('order.colPrice'), type: 'amount', render: (l) => unit(l.unitPriceCents) },
                  { key: 't', header: t('order.colLine'), type: 'amount', render: (l) => money(l.lineNetCents) },
                ]}
              />
              {lineNote && <p className="caption muted" style={{ marginTop: 'var(--space-3)' }}>{lineNote}</p>}
            </div>
            <div className="only-phone stack tight">
              {linesByFlavour.map((l) => (
                <div key={l.id} className="sales-tot">
                  {flav(l.flavour)}
                  <span>
                    {t('order.phoneCartons', { n: num(l.cartons) })} <span className="muted">· {money(l.lineNetCents)}</span>
                  </span>
                </div>
              ))}
              <hr className="sales-rule" />
              <div className="sales-tot">
                <span>{t('order.phoneLinesFoot', { c: num(o.totalCartons), u: num(o.totalUnits) })}</span>
                <span>{t('order.phoneUnit', { price: unit(o.unitPriceCents) })}</span>
              </div>
            </div>
          </Card>
        </div>
        <div className="sales-col">
          <Card className="o2" title={t('order.money')}>
            <div className="only-wide stack tight">
              <span className="sales-money-num">
                <bdi>{money(o.totalCents)}</bdi>
              </span>
              <span className="sales-sub">{t('order.inclVat', { n: o.totalCartons })}</span>
            </div>
            {moneyBox}
            {!cancelled && <div className="sales-note only-wide">{hint}</div>}
          </Card>
          {d.customer && (
            <Card className="o4" title={t('order.customer')}>
              <dl className="an-kv sales-kv">
                <dt>{t('order.vat')}</dt>
                <dd>
                  <bdi>{d.customer.vatNumber}</bdi>
                  {d.customer.vatValid != null && ` · ${d.customer.vatValid ? t('order.vatValid') : t('order.vatInvalid')}`}
                </dd>
                <dt>{t('order.contact')}</dt>
                <dd>
                  {d.customer.contactName}
                  {d.customer.phone && (
                    <>
                      {' · '}
                      <bdi>{d.customer.phone}</bdi>
                    </>
                  )}
                </dd>
                <dt>{t('order.deliversTo')}</dt>
                <dd>{d.customer.deliveryAddress}</dd>
                <dt>{t('order.terms')}</dt>
                <dd>{termsText}</dd>
              </dl>
              <div className="sales-row2">
                {d.customer.phone && (
                  <a className="an-btn secondary sm" href={`tel:${d.customer.phone}`}>
                    <Icon as={Phone} size="sm" /> {t('order.call')}
                  </a>
                )}
                <a className="an-btn secondary sm" href={`mailto:${d.customer.invoiceEmail}?subject=${encodeURIComponent(o.number)}`} style={{ flex: '0 0 auto' }}>
                  <Icon as={EnvelopeSimple} size="sm" /> {t('order.email')}
                </a>
              </div>
            </Card>
          )}
          {documentsCard}
        </div>
      </div>

      <div className="only-phone sales-acts">
        {!cancelled && (
          <>
            {writeActs(true).length > 0 && <div className="sales-row2">{writeActs(true)}</div>}
            {writeActs(true).length > 0 || o.status === 'invoiced' ? <span className="sales-hint">{hint}</span> : <div className="sales-note">{hint}</div>}
          </>
        )}
        {can('upload') && (
          <>
            {uploadBtn(true)}
            <span className="sales-hint">{t('order.uploadHint')}</span>
          </>
        )}
      </div>

      <OrderActionSheet action={action} detail={d} onClose={() => setAction(null)} onDeleted={() => router.replace('/sales')} />
      <DocPanel item={doc} detail={d} onClose={() => setDoc(null)} />
      <UploadSheet open={upload} detail={d} onClose={() => setUpload(false)} />
      {edit && can('edit') && (
        <NewSaleSheet
          open
          onClose={() => {
            setEdit(false);
            if (search.get('edit')) router.replace(`/sales/${id}`);
          }}
          draft={{ id, number: o.number, customerId: o.customerId, brokerId: null, cartons: Object.fromEntries(d.lines.map((l) => [l.flavour, l.cartons])), specialUnitPriceCents: o.specialUnitPriceCents }}
        />
      )}
    </div>
  );
}
