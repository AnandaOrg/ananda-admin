'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { ALCOHOL_BY_VOLUME, EXCISE_EUR_PER_HL_PURE, PACK_LITRES } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import {
  Bank,
  Button,
  Card,
  CaretRight,
  Icon,
  Check,
  CheckCircle,
  Count,
  DownloadSimple,
  EnvelopeSimple,
  Eye,
  FileText,
  FlavourName,
  KpiTile,
  ListCard,
  Lock,
  Package,
  PageHeader,
  PageState,
  Pill,
  Table,
  Truck,
  type Column,
} from '@/components/ui';
import { PurchaseStatusPill } from '../_components/PurchaseStatus';
import { RecordPaymentSheet } from '../_components/RecordPaymentSheet';
import { PurchaseSheet, type SheetKey } from './PurchaseSheets';
import { formWith, type PurchaseDetail, type PurchaseFile } from '../_lib/types';
import css from '../purchasing.module.css';

interface StepView {
  label: string;
  detail: ReactNode;
  done: boolean;
  action?: ReactNode;
}

/** Ordered → On the way / Arrived → Supplier invoice → Paid supplier → Landed cost, later steps locked. */
function Progress({ steps, horizontal }: { steps: StepView[]; horizontal?: boolean }) {
  const now = steps.findIndex((s) => !s.done);
  const mark = (s: StepView, i: number) => (s.done ? <Check className="an-ic sm" aria-hidden /> : i === now ? i + 1 : <Lock className="an-ic sm" aria-hidden />);
  if (horizontal)
    return (
      <div className="an-hsteps" style={{ ['--n' as string]: steps.length }}>
        {steps.map((s, i) => (
          <div key={i} className={`an-hs ${s.done ? 'done' : i === now ? 'now' : ''}`}>
            <span className="c">{mark(s, i)}</span>
            <span className="t">{s.label}</span>
            <span className="d">{s.detail}</span>
            {i === now && s.action && <span className={css.stepAction}>{s.action}</span>}
          </div>
        ))}
      </div>
    );
  return (
    <ol className={`an-steps ${css.steps}`}>
      {steps.map((s, i) => (
        <li key={i} className={`an-ps ${s.done ? 'done' : i === now ? 'now' : ''}`} aria-current={i === now ? 'step' : undefined}>
          <span className="c">{mark(s, i)}</span>
          <span className="t">{s.label}</span>
          <span className="d">{s.detail}</span>
          {i === now && s.action && <span className={`d ${css.stepAction}`}>{s.action}</span>}
        </li>
      ))}
    </ol>
  );
}

/** FR-PUR-6: purchase page — every purchase, late or received. */
export default function PurchasePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const { canEdit, can, readOnly } = useSession();
  const { money, unit, num, date, dateShort } = useFmt();
  const [sheet, setSheet] = useState<SheetKey | null>(null);
  const [paying, setPaying] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['purchases', id], queryFn: () => api.get<PurchaseDetail>(`/purchases/${id}`) });
  const upload = useAction((file: File) => api.post(`/purchases/${id}/documents`, formWith({}, { file })), { success: t('docs.done') });

  if (!q.data) return <PageState query={q} notFound={{ title: t('detail.notFound'), back: { label: t('detail.back'), href: '/purchasing' } }} />;
  const d = q.data;
  const p = d.purchase;
  const fig = d.figures;
  const editable = canEdit('purchasing') && !readOnly;
  const has = (a: string) => editable && d.actions.includes(a);
  const received = p.status === 'received';
  const open = p.status === 'ordered' || p.status === 'on_the_way';
  const invoice = d.payables.find((x) => x.kind === 'supplier_invoice');
  const canPay = editable && can('record_supplier_payment') && !!invoice && invoice.stillToPayCents > 0;

  const exp = dateShort(p.expectedOn);
  const steps: StepView[] = [
    { label: t('steps.ordered'), detail: date(p.orderedOn), done: true },
    {
      label: received ? t('steps.arrived') : t('steps.on_the_way'),
      detail: received ? t('steps.arrivedDetail', { date: date(p.arrivedOn), expected: date(p.expectedOn) }) : p.daysLate > 0 ? t('steps.dueLate', { date: exp }) : t('steps.due', { date: exp }),
      done: received,
      action: has('on_the_way') ? (
        <Button size="sm" writes icon={Truck} onClick={() => setSheet('on_the_way')}>
          {t('onTheWay.title')}
        </Button>
      ) : undefined,
    },
    {
      label: t('steps.supplier_invoice'),
      detail: p.supplierInvoiceReceived ? t('steps.invoiceDetail', { number: d.steps.supplier_invoice.number ?? '—', date: date(d.steps.supplier_invoice.on) }) : received ? t('steps.notUploaded') : t('steps.withGoods'),
      done: p.supplierInvoiceReceived,
      action: received && has('invoice') ? (
        <Button size="sm" variant="primary" icon={DownloadSimple} onClick={() => setSheet('invoice')}>
          {t('invoice.upload')}
        </Button>
      ) : undefined,
    },
    {
      label: t('steps.paid_supplier'),
      detail: fig.stillToPayCents > 0 ? t('steps.toPay', { amount: money(fig.stillToPayCents, true) }) : t('steps.paidInFull'),
      done: d.steps.paid_supplier.done,
      action: canPay ? (
        <Button size="sm" variant="primary" icon={Bank} onClick={() => setPaying(true)}>
          {t('pay.title')}
        </Button>
      ) : undefined,
    },
    { label: t('steps.landed_cost'), detail: received ? t('steps.aUnit', { amount: unit(fig.landedUnitCostCents) }) : t('steps.onArrival'), done: d.steps.landed_cost.done },
  ];

  const lineCols: Column<PurchaseDetail['lines'][number]>[] = [
    { key: 'flavour', header: tc('flavour'), render: (l) => <FlavourName flavour={l.flavour} /> },
    { key: 'cartons', header: tc('cartons'), type: 'count', render: (l) => <bdi>{num(l.cartons)}</bdi> },
    { key: 'units', header: tc('units'), type: 'count', render: (l) => <bdi>{num(l.unitsReceived ?? l.units)}</bdi> },
  ];
  const exciseRule = t('costs.exciseRule', { rate: unit(EXCISE_EUR_PER_HL_PURE * 100), litres: num(PACK_LITRES, 2), abv: Math.round(ALCOHOL_BY_VOLUME * 100) });
  type CostRow = { key: string; label: ReactNode; sub?: string; amount: string; strong?: boolean };
  const costRows: CostRow[] = [
    { key: 'goods', label: t('costs.goods'), amount: money(fig.goodsCents) },
    {
      key: 'freight',
      label: (
        <span className="row">
          {t('costs.freight')}
          {has('freight') && (
            <Button size="sm" writes onClick={() => setSheet('freight')}>
              {tc('edit')}
            </Button>
          )}
        </span>
      ),
      amount: money(fig.freightCents),
    },
    { key: 'excise', label: t('costs.exciseAuto'), sub: exciseRule, amount: money(fig.exciseCents) },
    { key: 'inventory', label: <b className="strong">{t('costs.inventory')}</b>, sub: t('costs.vatOnTop', { rate: Math.round(fig.supplierVatRate * 100) || 20 }), amount: money(fig.inventoryCostCents), strong: true },
  ];
  const costCols: Column<CostRow>[] = [
    {
      key: 'cost',
      header: t('costs.cost'),
      render: (r) => (
        <>
          {r.label}
          {r.sub && <span className="sb">{r.sub}</span>}
        </>
      ),
    },
    { key: 'amount', header: t('costs.beforeVat'), type: 'amount', render: (r) => (r.strong ? <b className="strong">{r.amount}</b> : r.amount) },
  ];

  const waitingCols: Column<PurchaseDetail['waiting'][number]>[] = [
    {
      key: 'order',
      header: t('waiting.order'),
      render: (o) => (
        <>
          <span className="nm">
            <bdi>{o.customerName ?? o.number}</bdi>
          </span>
          <span className="sb">
            <bdi>{o.number}</bdi>
          </span>
        </>
      ),
    },
    { key: 'broker', header: t('waiting.broker'), render: (o) => <bdi>{o.brokerName ?? '—'}</bdi> },
    { key: 'cartons', header: tc('cartons'), type: 'count', render: (o) => <bdi>{num(o.cartons)}</bdi> },
    { key: 'status', header: tc('status'), type: 'status', render: (o) => <Pill tone="mute">{o.since ? t('waiting.since', { date: dateShort(o.since) }) : t('waiting.waiting')}</Pill> },
    { key: 'go', header: <span className="sr-only" />, type: 'amount', render: () => <Icon as={CaretRight} size="sm" className="subtle" /> },
  ];

  const fileIcon: Record<PurchaseFile['kind'], typeof FileText> = { purchase_order: FileText, supplier_invoice: FileText, carrier_invoice: Truck, received_note: CheckCircle, payment: Bank, upload: DownloadSimple };
  const fileTitle = (f: PurchaseFile) =>
    f.kind === 'purchase_order' ? t('files.po', { number: f.number ?? p.number }) : f.kind === 'supplier_invoice' ? t('files.invoice', { number: f.number ?? '' }) : f.kind === 'carrier_invoice' ? t('files.carrier') : f.kind === 'received_note' ? t('files.grn') : f.kind === 'payment' ? t('files.payment') : (f.label ?? '');
  const fileSub = (f: PurchaseFile, phone?: boolean) => {
    switch (f.kind) {
      case 'purchase_order':
        return phone ? date(f.on) : t('files.poSub', { date: date(f.on), supplier: d.supplier.company });
      case 'supplier_invoice':
        return `${date(f.on)} · ${money(f.amountCents)}`;
      case 'carrier_invoice':
        return money(f.amountCents);
      case 'received_note':
        return t('files.grnSub', { date: date(f.on), n: num(f.units) });
      case 'payment':
        return f.part ? t('files.partPayment', { amount: money(f.amountCents) }) : t('files.paymentSub', { amount: money(f.amountCents), date: date(f.on) });
      default:
        return t('docs.uploadedBy', { date: date(f.on), by: f.by ?? '' });
    }
  };
  const documents = (phone?: boolean) => (
    <>
      {d.files.map((f, i) => {
        const Ic = fileIcon[f.kind];
        return (
          <div key={i} className="an-doc">
            <span className="ico">
              <Ic className="an-ic" aria-hidden />
            </span>
            <span className={css.fileText}>
              <span className={`t ${css.fileTitle}`}>
                <bdi>{fileTitle(f)}</bdi>
              </span>
              <span className="sub">
                <bdi>{fileSub(f, phone)}</bdi>
              </span>
            </span>
            {f.href ? (
              <a href={f.href} target="_blank" rel="noreferrer" className="an-iconbtn" aria-label={`${tc('view')} ${fileTitle(f)}`}>
                <Eye className="an-ic" aria-hidden />
              </a>
            ) : (
              <span />
            )}
          </div>
        );
      })}
      {has('upload') && (
        <>
          <input
            ref={fileInput}
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = '';
            }}
          />
          <Button block writes icon={DownloadSimple} busy={upload.isPending} onClick={() => fileInput.current?.click()}>
            {t('docs.uploadDocument')}
          </Button>
        </>
      )}
    </>
  );

  const headActions = open && editable && (
    <>
      {has('ask') && (
        <Button size="sm" writes icon={EnvelopeSimple} onClick={() => setSheet('ask')}>
          {t('ask.title')}
        </Button>
      )}
      {has('receive') && (
        <Button size="sm" variant="primary" icon={Package} onClick={() => setSheet('receive')}>
          {t('receive.title')}
        </Button>
      )}
    </>
  );
  const pending = !received && p.status !== 'cancelled';
  const waitingNote = pending && d.waiting.length > 0 ? t('waiting.note', { number: p.number }) : null;

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.purchasing'), href: '/purchasing' }, { label: p.number }]}
        kicker={
          <span className={`row between wrap ${css.kicker}`}>
            <span>
              <bdi>{d.supplier.company}</bdi> · {t('detail.orderedOn', { date: date(p.orderedOn) })}
            </span>
            <span className={`only-phone ${css.startEnd}`}>
              <PurchaseStatusPill p={{ ...p, stillToPayCents: fig.stillToPayCents }} />
            </span>
          </span>
        }
        title={
          <span className={`row ${css.titleRow}`}>
            <bdi>{p.number}</bdi>
            <span className={`only-wide ${css.titleStatus}`}>
              <PurchaseStatusPill p={{ ...p, stillToPayCents: fig.stillToPayCents }} />
            </span>
          </span>
        }
        actions={<span className="only-wide row">{headActions}</span>}
      />

      {/* ---------- Phone ---------- */}
      <div className="only-phone stack">
        {open && editable && (
          <div className="row">
            {has('ask') && (
              <Button writes icon={EnvelopeSimple} onClick={() => setSheet('ask')} className="grow">
                {t('ask.title')}
              </Button>
            )}
            {has('receive') && (
              <Button variant="primary" icon={Package} onClick={() => setSheet('receive')} className="grow">
                {t('receive.short')}
              </Button>
            )}
          </div>
        )}
        <div className="kpis">
          <KpiTile label={t('tiles.landed')} value={received ? unit(fig.landedUnitCostCents) : t('tiles.onArrival')} sub={received ? t('tiles.landedPhoneSub') : t('steps.onArrival')} />
          <KpiTile label={t('tiles.stillToPay')} value={<span className={fig.stillToPayCents > 0 ? 'warn' : 'good'}>{money(fig.stillToPayCents, true)}</span>} sub={fig.stillToPayCents > 0 ? t('tiles.paid', { amount: money(fig.paidCents) }) : t('steps.paidInFull')} />
        </div>
        <Card title={<span className="overline">{t('detail.progress')}</span>}>
          <Progress steps={steps} />
        </Card>
        <Card title={<span className="overline">{t('detail.costsBeforeVat')}</span>}>
          <div className="stack tight">
            {costRows.slice(0, 3).map((r) => (
              <div key={r.key} className="row between body-sm">
                <span className="muted">{r.label}</span>
                <bdi>{r.amount}</bdi>
              </div>
            ))}
            <div className={`row between ${css.total}`}>
              <span>{t('costs.inventory')}</span>
              <b className="strong">
                <bdi>{money(fig.inventoryCostCents)}</bdi>
              </b>
            </div>
            <div className="row between body-sm">
              <span className="muted">{fig.supplierVatRate > 0 ? t('costs.payableInclVat', { rate: Math.round(fig.supplierVatRate * 100) }) : t('tiles.payable')}</span>
              <bdi>{money(fig.payableCents)}</bdi>
            </div>
          </div>
        </Card>
        <Card title={<span className="overline">{t('detail.lines')}</span>}>
          <div className="stack tight">
            {d.lines.map((l) => (
              <div key={l.id} className="row between body-sm">
                <FlavourName flavour={l.flavour} />
                <span>
                  {t('lines.cartons', { n: num(l.cartons) })} <span className="muted">· {t('unitsShort', { n: num(l.unitsReceived ?? l.units) })}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
        {d.waiting.length > 0 && (
          <>
            <span className="overline">{t('waiting.titleCount', { n: d.waiting.length })}</span>
            <div className="list-cards">
              {d.waiting.map((o) => (
                <ListCard
                  key={o.id}
                  href={`/sales/${o.id}`}
                  title={<bdi>{o.customerName ?? o.number}</bdi>}
                  amount={t('lines.cartons', { n: num(o.cartons) })}
                  sub={
                    <>
                      <bdi>{o.number}</bdi>
                      {o.since && <> · {t('waiting.sinceLower', { date: dateShort(o.since) })}</>}
                      {o.brokerName && (
                        <>
                          {' · '}
                          <bdi>{o.brokerName}</bdi>
                        </>
                      )}
                    </>
                  }
                  status={<Pill tone={o.paidAt ? 'good' : 'mute'}>{o.paidAt ? t('waiting.paid') : t('waiting.notPaid')}</Pill>}
                />
              ))}
            </div>
          </>
        )}
        <Card title={<span className="overline">{t('detail.documents')}</span>}>{documents(true)}</Card>
      </div>

      {/* ---------- Desktop ---------- */}
      <div className="only-wide stack loose">
        <div className="kpis">
          <KpiTile label={t('tiles.landed')} value={received ? unit(fig.landedUnitCostCents) : t('tiles.onArrival')} sub={received ? t('tiles.landedSub', { cost: money(fig.inventoryCostCents), n: num(fig.units) }) : t('tiles.landedHow')} />
          <KpiTile label={t('tiles.inventoryCost')} value={money(fig.inventoryCostCents)} sub={t('costs.beforeVat')} />
          <KpiTile label={t('tiles.payable')} value={money(fig.payableCents)} sub={t('tiles.inclVat')} />
          <KpiTile label={t('tiles.stillToPay')} value={<span className={fig.stillToPayCents > 0 ? 'warn' : 'good'}>{money(fig.stillToPayCents)}</span>} sub={fig.stillToPayCents > 0 ? t('tiles.paid', { amount: money(fig.paidCents) }) : t('steps.paidInFull')} />
        </div>
        <div className="cols side">
          <div className="stack loose">
            <Card title={t('detail.progress')}>
              <Progress horizontal steps={steps} />
            </Card>
            <div className="cols even">
              <Card flush title={t('detail.lines')}>
                <Table columns={lineCols} rows={d.lines} rowKey={(l) => l.id} />
              </Card>
              <Card flush title={t('detail.costs')}>
                <Table columns={costCols} rows={costRows} rowKey={(r) => r.key} />
              </Card>
            </div>
            {d.waiting.length > 0 && (
              <Card flush title={<span className="row">{t('detail.waiting')}<Count n={d.waiting.length} tone="r" /></span>}>
                <Table columns={waitingCols} rows={d.waiting} rowKey={(o) => o.id} onRow={(o) => router.push(`/sales/${o.id}`)} />
                {waitingNote && (
                  <div className={`body-sm muted ${css.cardPad}`}>
                    {waitingNote}
                  </div>
                )}
                {received && canEdit('inventory') && (
                  <div className={css.cardPad}>
                    <Link href="/inventory?allocate=1" className="an-btn secondary sm">
                      {t('detail.allocate')}
                    </Link>
                  </div>
                )}
              </Card>
            )}
          </div>
          <Card title={<span className={`row ${css.cardTitle}`}>{t('detail.documents')}<Count n={d.files.length} /></span>}>
            <div>{documents()}</div>
          </Card>
        </div>
      </div>

      <PurchaseSheet sheet={sheet} detail={d} onClose={() => setSheet(null)} />
      {invoice && <RecordPaymentSheet payable={paying ? { ...invoice, purchaseNumber: p.number } : null} onClose={() => setPaying(false)} />}
    </div>
  );
}
