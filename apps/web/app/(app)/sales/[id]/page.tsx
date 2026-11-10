'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { orderFlowIndex, type Flavour, type OrderStatus } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import {
  Banner,
  Button,
  Card,
  CaretDown,
  DocRow,
  Eye,
  ErrorState,
  FileText,
  FlavourName,
  KeyValue,
  MenuButton,
  OrderStatusPill,
  PageHeader,
  PageSkeleton,
  Phone,
  Pill,
  ProgressSteps,
  Table,
  Totals,
  EnvelopeOpen,
  Receipt,
  Camera,
} from '@/components/ui';
import { OrderActionSheet, type ActionKey } from './OrderActions';

export interface OrderDetail {
  order: {
    id: string;
    number: string;
    status: OrderStatus;
    customerId: string | null;
    createdAt: string;
    requestSentAt: string | null;
    paidAt: string | null;
    sentToWarehouseAt: string | null;
    deliveredAt: string | null;
    invoicedAt: string | null;
    cancelledAt: string | null;
    cancelReason: string | null;
    paymentDueOn: string | null;
    proformaExpiresAt: string | null;
    reservedUntil: string | null;
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
  };
  lines: { id: string; flavour: Flavour; cartons: number; units: number; unitPriceCents: number; lineNetCents: number; deliveredCartons: number | null; creditedCartons: number; remainingCartons: number }[];
  tier: { minCartons: number; maxCartons: number; unitPriceCents: number } | null;
  customer: { id: string; companyName: string; vatNumber: string; vatValid: boolean | null; contactName: string; phone: string; invoiceEmail: string; deliveryAddress: string; city: string | null; paymentTermsDays: number } | null;
  agent: { id: string; name: string; email: string };
  payments: { id: string; receivedOn: string; amountCents: number; method: string; bankReference: string | null }[];
  documents: { id: string; type: string; number: string | null; createdAt: string; totalCents: number | null; language: string; supersededById: string | null; fileName: string | null; label: string | null }[];
  pendingApproval: { id: string; type: string; reason: string | null; payload: Record<string, unknown>; createdAt: string } | null;
  approvals: { id: string; type: string; status: string; declineReason: string | null; declineMessage: string | null; decidedAt: string | null }[];
  commission: { status: string; amountCents: number }[];
  waitingFor: { flavour: Flavour; neededUnits: number; availableUnits: number; purchase: { id: string; number: string; expectedOn: string } | null }[];
  timeline: { id: string; at: string; actorName: string | null; action: string; meta: Record<string, unknown> | null }[];
  actions: string[];
}

const PRIMARY: Record<string, ActionKey | 'allocate' | 'edit' | 'send_payment_request'> = {
  draft: 'send_payment_request',
  payment_to_confirm: 'confirm_payment',
  waiting_for_stock: 'allocate',
  ready_to_send: 'send_to_warehouse',
  delivered: 'issue_invoice',
  delivered_part: 'part_outcome',
};

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('sales');
  const tc = useTranslations('common');
  const router = useRouter();
  const search = useSearchParams();
  const { canView } = useSession();
  const { money, unit, num, date, dateTime } = useFmt();
  const [action, setAction] = useState<ActionKey | null>(null);
  const q = useQuery({ queryKey: ['orders', id], queryFn: () => api.get<OrderDetail>(`/orders/${id}`) });
  const sendRequest = useAction(() => api.post(`/orders/${id}/send`), { success: t('form.sent') });

  useEffect(() => {
    if (search.get('confirm') && q.data?.actions.includes('confirm_payment')) setAction('confirm_payment');
  }, [search, q.data]);

  if (q.isLoading) return <PageSkeleton />;
  if (!q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const o = d.order;
  const step = orderFlowIndex(o.status);
  const can = (a: string) => d.actions.includes(a);

  const run = (a: string) => {
    if (a === 'edit') router.push(`/sales/${id}/edit`);
    else if (a === 'send_payment_request') sendRequest.mutate(undefined);
    else if (a === 'allocate') router.push('/inventory?allocate=1');
    else setAction(a as ActionKey);
  };

  const primary = PRIMARY[o.status];
  const primaryOk = primary && can(primary);
  const secondary = d.actions.filter((a) => a !== primary && a !== 'send_payment_request');

  const stepAction = (label: string) =>
    primaryOk ? (
      <Button size="sm" variant="primary" onClick={() => run(primary)}>
        {label}
      </Button>
    ) : undefined;

  const steps = [
    { label: t('flow.payment_request'), detail: o.requestSentAt ? date(o.requestSentAt) : t('flow.notSent'), action: o.status === 'draft' ? stepAction(t('flow.sendRequest')) : undefined },
    { label: t('flow.confirm_payment'), detail: o.paidAt ? date(o.paidAt) : o.paidCents > 0 ? t('flow.partPaid', { amount: money(o.paidCents) }) : o.paymentDueOn ? t('flow.dueOn', { date: date(o.paymentDueOn) }) : undefined, action: stepAction(t('actions.confirm_payment.title')) },
    { label: t('flow.send_to_warehouse'), detail: o.sentToWarehouseAt ? date(o.sentToWarehouseAt) : o.status === 'waiting_for_stock' ? tc('orderStatus.waiting_for_stock') : undefined, action: stepAction(o.status === 'waiting_for_stock' ? t('flow.allocate') : t('actions.send_to_warehouse.title')) },
    { label: t('flow.delivered'), detail: o.deliveredAt ? date(o.deliveredAt) : o.status === 'at_warehouse' ? t('flow.atWarehouse') : undefined },
    { label: t('flow.invoice'), detail: o.invoicedAt ? date(o.invoicedAt) : undefined, action: o.status === 'delivered' || o.status === 'delivered_part' ? stepAction(o.status === 'delivered_part' ? t('actions.part_outcome.title') : t('actions.issue_invoice.title')) : undefined },
  ];

  const docIcon = (type: string) => (type === 'delivery_note' ? Camera : type === 'invoice' || type === 'credit_note' ? Receipt : FileText);
  const docHref = (doc: OrderDetail['documents'][number]) => (doc.type === 'delivery_note' || doc.type === 'upload' ? `/api/documents/${doc.id}/file` : `/api/documents/${doc.id}/print`);
  const lastDecline = d.approvals.find((a) => a.status === 'declined');

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.sales'), href: '/sales' }, { label: o.number }]}
        kicker={
          <>
            {t('order.created', { date: date(o.createdAt) })} · {d.agent.name}
          </>
        }
        title={
          <span className="row wrap" style={{ gap: 'var(--space-3)' }}>
            <bdi>{o.number}</bdi>
            <OrderStatusPill status={o.status} daysLate={o.daysLate} />
            {d.pendingApproval && <Pill tone="warn">{t('order.correctionPending')}</Pill>}
          </span>
        }
        actions={
          <>
            {secondary.length > 0 && (
              <MenuButton
                items={secondary.map((a) => ({ key: a, label: t(`actions.${a}.title`), onSelect: () => run(a) }))}
                trigger={({ open, toggle, ref }) => (
                  <button ref={ref} type="button" className="an-btn secondary sm" aria-expanded={open} onClick={toggle}>
                    {t('order.moreActions')}
                    <CaretDown className="an-ic sm" aria-hidden />
                  </button>
                )}
              />
            )}
            {primaryOk && (
              <Button size="sm" variant="primary" onClick={() => run(primary)}>
                {primary === 'send_payment_request' ? t('flow.sendRequest') : primary === 'allocate' ? t('flow.allocate') : t(`actions.${primary}.title`)}
              </Button>
            )}
          </>
        }
      />

      {o.status === 'waiting_for_stock' && d.waitingFor.length > 0 && (
        <Banner
          sub={d.waitingFor
            .map((w) => `${w.flavour.toUpperCase()}: ${t('order.short', { need: num(w.neededUnits), have: num(w.availableUnits) })}${w.purchase ? ` · ${w.purchase.number} ${t('order.expected', { date: date(w.purchase.expectedOn) })}` : ` · ${t('order.noPurchase')}`}`)
            .join('\n')}
          action={canView('inventory') ? { label: t('flow.allocate'), href: '/inventory?allocate=1' } : undefined}
        >
          {t('order.waitingTitle')}
        </Banner>
      )}
      {sendRequest.errorText && <Banner tone="bad">{sendRequest.errorText}</Banner>}
      {d.pendingApproval && <Banner sub={d.pendingApproval.reason ?? undefined}>{t(`order.pending.${d.pendingApproval.type}`)}</Banner>}
      {o.status === 'draft' && lastDecline && <Banner tone="bad" sub={[lastDecline.declineReason && tc(`reasons.decline.${lastDecline.declineReason}`), lastDecline.declineMessage].filter(Boolean).join(' · ')}>{t('order.declined')}</Banner>}
      {o.holdReleasedAt && o.status === 'payment_to_confirm' && !o.allocated && <Banner>{t('order.holdReleased', { date: date(o.holdReleasedAt) })}</Banner>}
      {o.status === 'cancelled' && <Banner tone="bad">{t('order.cancelled', { date: date(o.cancelledAt), reason: o.cancelReason ? tc(`reasons.cancel.${o.cancelReason}`) : '' })}</Banner>}

      <div className="cols side">
        <div className="stack loose">
          {o.status !== 'cancelled' && (
            <Card title={t('order.flow')}>
              <ProgressSteps steps={steps} current={step} />
            </Card>
          )}
          <Card flush title={t('order.lines')}>
            <Table
              rowKey={(l) => l.id}
              rows={d.lines}
              columns={[
                { key: 'f', header: tc('flavour'), render: (l) => <FlavourName flavour={l.flavour} /> },
                { key: 'c', header: tc('cartons'), type: 'count', render: (l) => (l.deliveredCartons != null && l.deliveredCartons !== l.cartons ? t('order.deliveredOf', { d: l.deliveredCartons, c: l.cartons }) : num(l.cartons)) },
                { key: 'u', header: tc('units'), type: 'count', render: (l) => num(l.units) },
                { key: 'p', header: tc('unitPrice'), type: 'amount', render: (l) => unit(l.unitPriceCents) },
                { key: 't', header: tc('totalExclVat'), type: 'amount', render: (l) => money(l.lineNetCents) },
              ]}
            />
            <p className="caption muted" style={{ padding: 'var(--space-3) var(--card-padding) var(--card-padding)' }}>
              {o.specialUnitPriceCents
                ? t('order.specialPrice', { price: unit(o.specialUnitPriceCents), list: unit(o.tierUnitPriceCents) })
                : d.tier
                  ? t('order.tierNote', { from: num(d.tier.minCartons), to: num(d.tier.maxCartons), price: unit(d.tier.unitPriceCents), n: num(o.totalCartons) })
                  : t('form.belowMinimum', { n: 42 - o.totalCartons, min: 42 })}
            </p>
          </Card>
          {d.payments.length > 0 && (
            <Card flush title={t('order.payments')}>
              <Table
                rowKey={(p) => p.id}
                rows={d.payments}
                columns={[
                  { key: 'd', header: tc('date'), render: (p) => date(p.receivedOn) },
                  { key: 'm', header: t('actions.confirm_payment.paidBy'), render: (p) => t(`method.${p.method}`) },
                  { key: 'r', header: t('actions.confirm_payment.reference'), render: (p) => <bdi>{p.bankReference ?? '—'}</bdi> },
                  { key: 'a', header: tc('amount'), type: 'amount', render: (p) => money(p.amountCents) },
                ]}
              />
            </Card>
          )}
          <Card title={t('order.history')}>
            <div className="stack tight">
              {d.timeline.map((e) => (
                <div key={e.id} className="row between body-sm">
                  <span>
                    {t.has(`timeline.${e.action}`) ? t(`timeline.${e.action}`) : e.action.replace(/_/g, ' ')}
                    <span className="muted"> · {e.actorName}</span>
                  </span>
                  <span className="muted nowrap">{dateTime(e.at)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="stack loose">
          <Card title={t('order.money')}>
            <Totals
              lines={[
                [tc('totalExclVat'), money(o.netCents)],
                [tc('vat'), money(o.vatCents)],
                [t('money.paid'), money(o.paidCents)],
                ...(o.creditedCents ? [[t('money.credited'), money(o.creditedCents)] as [string, string]] : []),
                [t('money.commission'), money(o.commissionCents)],
              ]}
              big={[tc('totalInclVat'), money(o.totalCents)]}
            />
            <p className="caption muted">
              {o.status === 'draft'
                ? t('money.noteDraft')
                : o.outstandingCents > 0
                  ? t('money.noteOwed', { amount: money(o.outstandingCents) })
                  : t('money.notePaid', { status: d.commission.some((c) => c.status === 'paid') ? t('money.commissionPaid') : t('money.commissionReady') })}
            </p>
          </Card>
          {d.customer && (
            <Card title={tc('customer')}>
              <Link href={`/customers/${d.customer.id}`} className="body-lg strong">
                {d.customer.companyName}
              </Link>
              <KeyValue
                items={[
                  [
                    t('order.vat'),
                    <span key="v" className="row wrap">
                      <bdi>{d.customer.vatNumber}</bdi>
                      {d.customer.vatValid != null && <Pill tone={d.customer.vatValid ? 'good' : 'bad'}>{d.customer.vatValid ? t('order.vatValid') : t('order.vatInvalid')}</Pill>}
                    </span>,
                  ],
                  [t('order.contact'), d.customer.contactName],
                  [t('order.deliverTo'), d.customer.deliveryAddress],
                  [t('order.terms'), t('form.termsDays', { n: d.customer.paymentTermsDays })],
                ]}
              />
              <div className="an-panel-f" style={{ position: 'static', margin: 0, padding: 0, background: 'none' }}>
                <a className="an-btn secondary sm" href={`tel:${d.customer.phone}`}>
                  <Phone className="an-ic sm" aria-hidden /> {tc('call')}
                </a>
                <a className="an-btn secondary sm" href={`mailto:${d.customer.invoiceEmail}?subject=${encodeURIComponent(o.number)}`}>
                  <EnvelopeOpen className="an-ic sm" aria-hidden /> {tc('email')}
                </a>
              </div>
            </Card>
          )}
          <Card title={t('order.documents')}>
            {d.documents.length === 0 ? (
              <p className="body-sm subtle">{t('order.noDocuments')}</p>
            ) : (
              <div>
                {d.documents.map((doc) => (
                  <DocRow
                    key={doc.id}
                    icon={docIcon(doc.type)}
                    title={
                      <>
                        {tc(`docType.${doc.type}`)} {doc.number && <bdi>{doc.number}</bdi>}
                        {doc.supersededById && <span className="badge-soft" style={{ marginInlineStart: 6 }}>{t('order.replaced')}</span>}
                      </>
                    }
                    sub={[date(doc.createdAt), doc.totalCents != null ? money(doc.totalCents) : null, doc.type !== 'delivery_note' ? doc.language.toUpperCase() : null].filter(Boolean).join(' · ')}
                    actions={
                      <a className="an-iconbtn" href={docHref(doc)} target="_blank" rel="noreferrer" aria-label={`${tc('view')} ${tc(`docType.${doc.type}`)} ${doc.number ?? ''}`}>
                        <Eye className="an-ic" aria-hidden />
                      </a>
                    }
                  />
                ))}
              </div>
            )}
          </Card>
          {o.note && (
            <Card title={tc('note')}>
              <p className="body-sm">{o.note}</p>
            </Card>
          )}
        </div>
      </div>

      <OrderActionSheet action={action} detail={d} onClose={() => setAction(null)} onDeleted={() => router.replace('/sales')} />
    </div>
  );
}
