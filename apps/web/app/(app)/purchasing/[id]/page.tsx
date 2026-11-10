'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { isoDate } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import {
  Banner,
  Button,
  Card,
  CheckCircle,
  DocRow,
  EmptyState,
  FLAVOUR_VAR,
  EnvelopeOpen,
  ErrorState,
  Eye,
  FileText,
  FlavourName,
  HourglassMedium,
  KeyValue,
  KpiTile,
  ListRow,
  NotePencil,
  PageHeader,
  PageSkeleton,
  ProgressSteps,
  Receipt,
  Table,
  Totals,
  Truck,
  UploadSimple,
  type Column,
} from '@/components/ui';
import { PurchaseStatusPill, PayableStatusPill, useKindLabel } from '../_components/PurchaseStatus';
import { RecordPaymentSheet } from '../_components/RecordPaymentSheet';
import { PurchaseSheet, type SheetKey } from './PurchaseSheets';
import type { Payable, PurchaseDetail } from '../_lib/types';

const STEP_KEYS = ['ordered', 'on_the_way', 'supplier_invoice', 'paid_supplier', 'landed_cost'] as const;

/** FR-PUR-6: purchase page. */
export default function PurchasePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const { canEdit, can, readOnly } = useSession();
  const { money, unit, num, date, dateShort } = useFmt();
  const kind = useKindLabel();
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  const [paying, setPaying] = useState<Payable | null>(null);
  const q = useQuery({ queryKey: ['purchases', id], queryFn: () => api.get<PurchaseDetail>(`/purchases/${id}`) });
  const resolve = useAction((messageId: string) => api.post(`/purchases/${id}/messages/${messageId}/resolve`), { success: t('messages.resolved') });

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const p = d.purchase;
  const fig = d.figures;
  const editable = canEdit('purchasing') && !readOnly;
  const has = (a: string) => editable && d.actions.includes(a);
  const today = isoDate();
  const received = p.status === 'received';

  const stepsDone = STEP_KEYS.map((k) => d.steps[k].done);
  const current = stepsDone.findIndex((x) => !x);
  const steps = STEP_KEYS.map((k) => ({
    done: d.steps[k].done,
    label: t(`steps.${k}`),
    detail: d.steps[k].on ? dateShort(d.steps[k].on) : k === 'on_the_way' && p.status === 'ordered' ? t('steps.expected', { date: dateShort(p.expectedOn) }) : undefined,
  }));

  const lineCols: Column<PurchaseDetail['lines'][number]>[] = [
    { key: 'flavour', header: tc('flavour'), render: (l) => <FlavourName flavour={l.flavour} /> },
    { key: 'cartons', header: tc('cartons'), type: 'count', render: (l) => num(l.cartons) },
    { key: 'units', header: t('lines.ordered'), type: 'count', render: (l) => num(l.units) },
    { key: 'received', header: t('lines.received'), type: 'count', render: (l) => (l.unitsReceived == null ? <span className="subtle">—</span> : <span className={l.unitsReceived !== l.units ? 'warn' : ''}>{num(l.unitsReceived)}</span>) },
    { key: 'price', header: tc('unitPrice'), type: 'amount', render: (l) => <bdi>{unit(l.unitPriceCents, 4)}</bdi> },
    { key: 'amount', header: tc('amount'), type: 'amount', render: (l) => <bdi>{money(l.lineCents)}</bdi> },
  ];

  const openMessages = d.messages.filter((m) => !m.resolvedAt);

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.purchasing'), href: '/purchasing' }, { label: p.number }]}
        kicker={<bdi>{d.supplier.company}</bdi>}
        title={<bdi>{p.number}</bdi>}
        actions={
          <>
            <a className="an-btn secondary sm" href={`/api/purchases/${p.id}/order`} target="_blank" rel="noreferrer">
              <FileText className="an-ic sm" aria-hidden />
              {t('detail.purchaseOrder')}
            </a>
            {has('ask') && (
              <Button size="sm" icon={EnvelopeOpen} onClick={() => setSheet('ask')}>
                {t('ask.title')}
              </Button>
            )}
            {has('on_the_way') && (
              <Button size="sm" icon={Truck} onClick={() => setSheet('on_the_way')}>
                {t('onTheWay.title')}
              </Button>
            )}
            {has('receive') && (
              <Button size="sm" variant="primary" icon={CheckCircle} onClick={() => setSheet('receive')}>
                {t('receive.title')}
              </Button>
            )}
          </>
        }
      />

      <div className="row wrap">
        <PurchaseStatusPill status={p.status} daysLate={p.daysLate} invoiceMissing={!p.supplierInvoiceReceived} />
        <span className="body-sm muted">
          {received ? t('detail.arrivedOn', { date: date(p.arrivedOn) }) : t('detail.expectedOn', { date: date(p.expectedOn) })} · {t('detail.orderedOn', { date: date(p.orderedOn) })}
        </span>
      </div>

      {p.daysLate > 0 && openMessages.length === 0 && has('ask') && (
        <Banner tone="bad" action={{ label: t('ask.title'), onClick: () => setSheet('ask') }}>
          {t('detail.lateBanner', { n: p.daysLate })}
        </Banner>
      )}
      {received && !p.supplierInvoiceReceived && has('invoice') && (
        <Banner action={{ label: t('invoice.title'), onClick: () => setSheet('invoice') }}>{t('detail.invoiceMissing')}</Banner>
      )}

      <div className="kpis">
        <KpiTile label={t('tiles.landed')} value={unit(fig.landedUnitCostCents, 4)} sub={fig.landedEstimated ? t('tiles.estimate') : t('tiles.onArrival', { date: dateShort(p.arrivedOn) })} />
        <KpiTile label={t('tiles.inventoryCost')} value={money(fig.inventoryCostCents, true)} sub={t('tiles.forUnits', { n: num(fig.units) })} />
        <KpiTile label={t('tiles.payable')} value={money(fig.payableCents, true)} sub={fig.notInvoicedCents > 0 ? t('tiles.notInvoiced', { amount: money(fig.notInvoicedCents, true) }) : undefined} />
        <KpiTile label={t('tiles.stillToPay')} value={money(fig.stillToPayCents, true)} valueTone={fig.stillToPayCents === 0 && fig.payableCents > 0 ? 'good' : undefined} sub={t('tiles.paidSoFar', { amount: money(fig.paidCents, true) })} />
      </div>

      <Card title={t('detail.progress')}>
        <div className="only-wide">
          <ProgressSteps horizontal steps={steps} current={current === -1 ? steps.length : current} />
        </div>
        <div className="only-phone">
          <ProgressSteps steps={steps} current={current === -1 ? steps.length : current} />
        </div>
      </Card>

      <div className="cols">
        <div className="stack loose">
          <Card flush title={t('detail.lines')}>
            <div className="only-wide">
              <Table columns={lineCols} rows={d.lines} rowKey={(l) => l.id} />
            </div>
            <div className="only-phone" style={{ padding: 'var(--card-padding)', paddingTop: 0 }}>
              <div className="stack tight">
                {d.lines.map((l) => (
                  <div key={l.id} className="an-flav">
                    <i className="dot" style={{ background: FLAVOUR_VAR[l.flavour] }} aria-hidden />
                    <span className="nm">{l.flavour.toUpperCase()}</span>
                    <span className="q">
                      <bdi>{num(l.unitsReceived ?? l.units)}</bdi>
                    </span>
                    <span className="u">{l.unitsReceived == null ? tc('cartonsUnits', { c: num(l.cartons), u: num(l.units) }) : t('lines.receivedOf', { n: num(l.unitsReceived), of: num(l.units) })}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card
            title={t('detail.costs')}
            action={
              has('freight') ? (
                <Button size="sm" icon={NotePencil} onClick={() => setSheet('freight')}>
                  {t('freight.edit')}
                </Button>
              ) : undefined
            }
          >
            <Totals
              lines={[
                [t('costs.goods'), money(fig.goodsCents)],
                [fig.freightCents ? t('costs.freight') : t('costs.freightNone'), money(fig.freightCents)],
                [fig.exciseEstimated ? t('costs.exciseEstimate') : t('costs.excise'), money(fig.exciseCents)],
              ]}
              big={[t('costs.inventory'), money(fig.inventoryCostCents)]}
            />
            <p className="body-sm muted">{fig.landedEstimated ? t('costs.landedHelpEstimate', { amount: unit(fig.landedUnitCostCents, 4), n: num(fig.units) }) : t('costs.landedHelp', { amount: unit(fig.landedUnitCostCents, 4), n: num(fig.units) })}</p>
          </Card>

          <Card title={t('detail.payables')}>
            {d.payables.length === 0 ? (
              <p className="body-sm muted">{t('detail.noPayables')}</p>
            ) : (
              <div className="lrows">
                {d.payables.map((x) => (
                  <ListRow
                    key={x.id}
                    icon={Receipt}
                    iconTone={x.paidCents < x.amountCents && x.dueOn < today ? 'bad' : undefined}
                    title={
                      <>
                        {kind(x.kind)} · <bdi>{x.party}</bdi>
                      </>
                    }
                    sub={
                      <span className="row wrap" style={{ gap: 6 }}>
                        <span>
                          {money(x.amountCents)} · {t('payables.dueOn', { date: dateShort(x.dueOn) })}
                          {x.invoiceNumber && (
                            <>
                              {' · '}
                              <bdi>{x.invoiceNumber}</bdi>
                            </>
                          )}
                        </span>
                        <PayableStatusPill p={x} today={today} />
                      </span>
                    }
                    wrapActions
                    actions={
                      editable && can('record_supplier_payment') && x.stillToPayCents > 0 ? (
                        <Button size="sm" onClick={() => setPaying(x)}>
                          {t('pay.title')}
                        </Button>
                      ) : (
                        <bdi>{x.stillToPayCents > 0 ? money(x.stillToPayCents) : tc('none')}</bdi>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="stack loose">
          <Card title={t('detail.waiting')} action={d.waiting.length > 0 && received && canEdit('inventory') ? <Link href="/inventory?allocate=1" className="an-btn secondary sm">{t('detail.allocate')}</Link> : undefined}>
            {d.waiting.length === 0 ? (
              <p className="body-sm muted">{t('detail.noWaiting')}</p>
            ) : (
              <div className="lrows">
                {d.waiting.map((o) => (
                  <ListRow
                    key={o.id}
                    icon={HourglassMedium}
                    iconTone="warn"
                    href={`/sales/${o.id}`}
                    title={<bdi>{o.customerName ?? o.number}</bdi>}
                    sub={
                      <>
                        <bdi>{o.number}</bdi> · {o.paidAt ? t('detail.paidOn', { date: dateShort(o.paidAt) }) : null}
                      </>
                    }
                    value={t('unitsShort', { n: num(o.units) })}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card
            title={t('detail.documents')}
            action={
              has('upload') ? (
                <Button size="sm" icon={UploadSimple} onClick={() => setSheet('upload')}>
                  {t('docs.upload')}
                </Button>
              ) : undefined
            }
          >
            {d.documents.length === 0 ? (
              <EmptyState icon={FileText} title={t('docs.emptyTitle')} />
            ) : (
              <div>
                {d.documents.map((doc) => (
                  <DocRow
                    key={doc.id}
                    icon={doc.type === 'purchase_order' ? FileText : Receipt}
                    title={doc.type === 'purchase_order' ? <>{tc('docType.purchase_order')} <bdi>{doc.number}</bdi></> : <bdi>{doc.label ?? doc.fileName}</bdi>}
                    sub={
                      <>
                        {date(doc.createdAt)}
                        {doc.by && ` · ${doc.by}`}
                        {doc.totalCents != null && (
                          <>
                            {' · '}
                            <bdi>{money(doc.totalCents)}</bdi>
                          </>
                        )}
                      </>
                    }
                    actions={
                      doc.hasFile ? (
                        <a href={`/api/documents/${doc.id}/file`} target="_blank" rel="noreferrer" className="an-iconbtn" aria-label={`${tc('view')} ${doc.label ?? doc.fileName ?? ''}`}>
                          <Eye className="an-ic" aria-hidden />
                        </a>
                      ) : doc.type === 'purchase_order' ? (
                        <a href={`/api/purchases/${p.id}/order`} target="_blank" rel="noreferrer" className="an-iconbtn" aria-label={`${tc('view')} ${doc.number ?? ''}`}>
                          <Eye className="an-ic" aria-hidden />
                        </a>
                      ) : null
                    }
                  />
                ))}
              </div>
            )}
          </Card>

          <Card title={t('messages.title')} action={has('ask') ? <Button size="sm" onClick={() => setSheet('ask')}>{t('ask.title')}</Button> : undefined}>
            {d.messages.length === 0 ? (
              <p className="body-sm muted">{t('messages.empty')}</p>
            ) : (
              <div className="lrows">
                {d.messages.map((m) => {
                  const due = !m.resolvedAt && m.followUpOn && m.followUpOn <= today;
                  return (
                    <ListRow
                      key={m.id}
                      icon={EnvelopeOpen}
                      iconTone={due ? 'warn' : undefined}
                      title={t(`ask.topics.${m.topic}`)}
                      sub={
                        m.resolvedAt
                          ? t('messages.answered', { date: dateShort(m.createdAt), by: m.by ?? '' })
                          : due
                            ? t('messages.followUpDue', { date: dateShort(m.createdAt) })
                            : t('messages.followUpOn', { date: dateShort(m.createdAt), followUp: dateShort(m.followUpOn) })
                      }
                      wrapActions
                      actions={!m.resolvedAt && editable ? <Button size="sm" busy={resolve.isPending && resolve.variables === m.id} onClick={() => resolve.mutate(m.id)}>{t('messages.resolve')}</Button> : undefined}
                    />
                  );
                })}
              </div>
            )}
          </Card>

          <Card title={t('detail.supplier')} action={<Link href="/purchasing/suppliers" className="an-btn secondary sm">{t('tabs.suppliers')}</Link>}>
            <KeyValue
              items={[
                [t('suppliers.cols.supplier'), <bdi key="c">{d.supplier.company}</bdi>],
                [t('suppliers.form.contact'), d.supplier.contactName ?? '—'],
                [t('suppliers.form.ordersEmail'), <bdi key="e">{d.supplier.ordersEmail}</bdi>],
                [t('suppliers.cols.leadTime'), t('suppliers.days', { n: d.supplier.leadTimeDays })],
                [t('suppliers.cols.terms'), t('suppliers.days', { n: d.supplier.paymentTermsDays })],
              ]}
            />
            {d.shipments.length > 0 && (
              <div className="stack tight">
                <span className="overline">{t('tabs.shipments')}</span>
                {d.shipments.map((s) => (
                  <div key={s.id} className="row between body-sm">
                    <span>
                      <bdi>{s.carrier}</bdi> · {t(`shipments.modes.${s.mode}`)}
                      {s.route && (
                        <>
                          {' · '}
                          <bdi>{s.route}</bdi>
                        </>
                      )}
                    </span>
                    <span className="muted">{t(`shipments.status.${s.status}`)}</span>
                  </div>
                ))}
              </div>
            )}
            {p.note && <p className="body-sm muted">{p.note}</p>}
          </Card>
        </div>
      </div>

      <PurchaseSheet sheet={sheet} detail={d} onClose={() => setSheet(null)} />
      <RecordPaymentSheet payable={paying} onClose={() => setPaying(null)} />
    </div>
  );
}
