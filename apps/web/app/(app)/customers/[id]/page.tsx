'use client';

import Link from 'next/link';
import { use, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { PRICE_TIERS, type OrderStatus } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useMedia } from '@/lib/hooks';
import {
  ActionError,
  Banner,
  Button,
  CaretRight,
  Card,
  Chips,
  DocRow,
  EnvelopeSimple,
  Eye,
  FileText,
  Icon,
  KpiTile,
  OrderStatusPill,
  PageHeader,
  PageState,
  Phone,
  Pill,
  Plus,
  Sheet,
  Table,
  TextField,
} from '@/components/ui';
import { ChangeBrokerSheet } from '../ChangeBrokerSheet';
import { NewSaleSheet } from '../../sales/NewSaleSheet';
import { useCountryName } from '../AddCustomerSheet';
import { STATUS_TONE } from '../status';
import s from '../customers.module.css';

interface CustomerCard {
  freeToClaim: boolean;
  ownershipMonths?: number;
  customer: {
    id: string;
    companyName: string;
    vatNumber: string;
    vatValid: boolean | null;
    country: string;
    city: string | null;
    postcode: string | null;
    registeredAddress: string;
    deliveryAddress: string | null;
    contactName: string;
    phone: string;
    invoiceEmail: string;
    proformaLanguage: string;
    paymentTerms: 'before_shipping' | 'half_before_shipping' | 'after_delivery_30';
    ownedUntil: string | null;
    note: string | null;
    status: string;
    displayStatus: string;
    brokerId: string | null;
  };
  broker?: { id: string; name: string; email: string } | null;
  previousBroker?: { id: string; name: string } | null;
  tiles?: { owesCents: number; lateCents: number; lastOrder: { id: string; number: string; createdAt: string } | null; deliveredSalesCents: number; vatRegime: 'domestic' | 'eu_reverse_charge' | 'eu_vat' | 'export' };
  orders?: { id: string; number: string; status: OrderStatus; createdAt: string; requestSentAt: string | null; totalCents: number; totalCartons: number; outstandingCents: number; paymentDueOn: string | null; commissionCents: number }[];
  payments?: { id: string; receivedOn: string; amountCents: number; method: string; bankReference: string | null; orderNumber: string; orderId: string }[];
  credits?: { id: string; number: string; createdAt: string; totalCents: number }[];
  documents?: { id: string; type: string; number: string | null; createdAt: string; totalCents: number | null; language: string; supersededById: string | null; label: string | null; fileName: string | null }[];
  contacts?: { id: string; name: string; role: string | null; phone: string | null; email: string | null }[];
  history?: { id: string; at: string; actorName: string | null; action: string; meta: Record<string, unknown> | null }[];
  approval?: { status: string; declineReason: string | null; declineMessage: string | null } | null;
  rules?: { minOrderCartons: number; ownershipMonths: number };
}

type Tab = 'orders' | 'money' | 'terms' | 'files';

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const router = useRouter();
  const phone = useMedia('(max-width: 767px)');
  const { isBroker, isAdmin, canEdit } = useSession();
  const { money, unit, date, dateShort, num } = useFmt();
  const country = useCountryName();
  const [tab, setTab] = useState<Tab>('orders');
  const [moving, setMoving] = useState(false);
  const [selling, setSelling] = useState(false);
  const [contact, setContact] = useState(false);
  const [c, setC] = useState({ name: '', role: '', phone: '', email: '' });
  const q = useQuery({ queryKey: ['customers', id], queryFn: () => api.get<CustomerCard>(`/customers/${id}`) });
  const claim = useAction(() => api.post(`/customers/${id}/claim`), { success: t('claimed') });
  const submit = useAction(() => api.patch(`/customers/${id}`, { submit: true }), { success: t('new.sent') });
  const archive = useAction((archived: boolean) => api.post(`/customers/${id}/archive`, { archived }), { success: (_r) => t('archivedDone'), errorToast: true });
  const addContact = useAction(() => api.post(`/customers/${id}/contacts`, { name: c.name, role: c.role || undefined, phone: c.phone || undefined, email: c.email || undefined }), {
    success: t('contactAdded'),
    onDone: () => {
      setContact(false);
      setC({ name: '', role: '', phone: '', email: '' });
    },
  });

  if (!q.data) return <PageState query={q} notFound={{ title: t('notFound'), back: { label: t('backToCustomers'), href: '/customers' } }} />;
  const d = q.data;
  const cu = d.customer;

  if (d.freeToClaim) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tc('nav.customers'), href: '/customers' }, { label: cu.companyName }]} kicker={t('kickerFree')} title={cu.companyName} />
        <Card>
          <div className={s.peek}>
            <div className={s.kv}>
              <span>{t('fields.vat')}</span>
              <bdi>{cu.vatNumber || '—'}</bdi>
            </div>
            <div className={s.kv}>
              <span>{t('fields.city')}</span>
              <span>{cu.city ?? '—'}</span>
            </div>
            <div className={s.kv}>
              <span>{t('freeSinceLabel')}</span>
              <span>{cu.ownedUntil ? date(cu.ownedUntil) : '—'}</span>
            </div>
          </div>
          <p className="muted">{t('freeText', { n: d.ownershipMonths ?? 6 })}</p>
          <Button variant="primary" busy={claim.busy} onClick={() => claim.mutate(undefined)}>
            {t('claim')}
          </Button>
          <ActionError action={claim} />
        </Card>
      </div>
    );
  }

  const tiles = d.tiles!;
  const orders = d.orders ?? [];
  const minCartons = d.rules?.minOrderCartons ?? 42;
  const canSell = canEdit('sales') && cu.status === 'active' && (!isBroker || cu.brokerId);
  const free = cu.displayStatus === 'free_to_claim';
  const docHref = (doc: { id: string; type: string }) => (doc.type === 'delivery_note' || doc.type === 'upload' ? `/api/documents/${doc.id}/file` : `/api/documents/${doc.id}/print`);
  const vatLabel = t(`vatRegime.${tiles.vatRegime}`);
  const vatSub = !cu.vatNumber ? t('tiles.noVat') : cu.vatValid === true ? t('tiles.vatValid', { vat: cu.vatNumber }) : cu.vatValid === false ? t('tiles.vatInvalid', { vat: cu.vatNumber }) : t('tiles.vatUnchecked', { vat: cu.vatNumber });
  const address = [cu.registeredAddress, [cu.postcode, cu.city].filter(Boolean).join(' '), country(cu.country)].filter(Boolean).join(', ');
  const deliversTo = cu.deliveryAddress ?? address;
  const priceList = t('priceListRange', { from: unit(PRICE_TIERS[0].unitPriceCents), to: unit(PRICE_TIERS[PRICE_TIERS.length - 1].unitPriceCents) });
  const commissionOf = (orderId: string) => orders.find((o) => o.id === orderId)?.commissionCents ?? null;
  const late = (o: { paymentDueOn: string | null; outstandingCents: number; status: OrderStatus }) =>
    o.paymentDueOn && o.outstandingCents > 0 && !['draft', 'cancelled'].includes(o.status) ? Math.max(0, Math.floor((Date.now() - new Date(o.paymentDueOn).getTime()) / 86_400_000)) : 0;

  const kicker = free ? (
    t('kickerFree')
  ) : d.broker ? (
    <span className={s.head}>
      {tc('broker')} <Pill tone="blue">{d.broker.name}</Pill> · {cu.ownedUntil ? t('keepsUntil', { date: date(cu.ownedUntil) }) : t('keepsNotSet')}
    </span>
  ) : (
    t('kickerHouse')
  );

  const banners = (
    <>
      {(cu.status === 'draft' || cu.status === 'declined') && (
        <Banner
          tone={cu.status === 'declined' ? 'bad' : 'info'}
          sub={cu.status === 'declined' ? [d.approval?.declineReason && (tc.has(`reasons.decline.${d.approval.declineReason}`) ? tc(`reasons.decline.${d.approval.declineReason}`) : d.approval.declineReason), d.approval?.declineMessage].filter(Boolean).join(' · ') : undefined}
          action={isBroker ? { label: t('new.sendForApproval'), onClick: () => submit.mutate(undefined) } : undefined}
        >
          {cu.status === 'declined' ? t('declinedBanner') : t('draftBanner')}
        </Banner>
      )}
      {cu.status === 'needs_approval' && <Banner>{t('waitingBanner')}</Banner>}
      {cu.status === 'archived' && <Banner action={isAdmin ? { label: t('restore'), onClick: () => archive.mutate(false) } : undefined}>{t('archivedBanner')}</Banner>}
    </>
  );

  const ordersTable = (
    <Card flush>
      <Table
        rows={orders}
        rowKey={(o) => o.id}
        onRow={(o) => router.push(`/sales/${o.id}`)}
        empty={<span className="muted">{t('tabs.noOrders')}</span>}
        columns={[
          { key: 'n', header: t('cols.order'), render: (o) => <bdi className="nm">{o.number}</bdi> },
          { key: 'd', header: tc('created'), render: (o) => dateShort(o.requestSentAt ?? o.createdAt) },
          { key: 't', header: tc('totalInclVat'), type: 'amount', render: (o) => money(o.totalCents) },
          { key: 's', header: tc('status'), type: 'status', render: (o) => <OrderStatusPill status={o.status} daysLate={late(o)} /> },
          { key: 'go', header: '', width: 40, render: () => <Icon as={CaretRight} size="sm" className="subtle flip" /> },
        ]}
      />
    </Card>
  );

  type MoneyRow = { id: string; on: string; what: ReactNode; sub?: ReactNode; cents: number; href?: string };
  const moneyRows: MoneyRow[] = [
    ...(d.payments ?? []).map((p) => {
      const cm = commissionOf(p.orderId);
      return {
        id: p.id,
        on: p.receivedOn,
        what: (
          <>
            {t('money.payment')} · <bdi>{p.orderNumber}</bdi>
            {p.bankReference && (
              <>
                {' · '}
                <bdi>{p.bankReference}</bdi>
              </>
            )}
          </>
        ),
        sub: cm != null && d.broker ? t('money.commission', { name: d.broker.name.split(' ')[0], amount: money(cm) }) : undefined,
        cents: p.amountCents,
      };
    }),
    ...(d.credits ?? []).map((cr) => ({ id: cr.id, on: cr.createdAt, what: <>{tc('docType.credit_note')} <bdi>{cr.number}</bdi></>, cents: -cr.totalCents, href: `/api/documents/${cr.id}/print` })),
  ].sort((a, b) => (a.on < b.on ? 1 : -1));
  const moneyTable = (
    <Card flush>
      <Table
        rows={moneyRows}
        rowKey={(r) => r.id}
        empty={<span className="muted">{t('money.none')}</span>}
        columns={[
          { key: 'd', header: tc('date'), render: (r) => dateShort(r.on) },
          {
            key: 'w',
            header: t('money.what'),
            render: (r) => (
              <>
                <span>{r.what}</span>
                {r.sub && <span className={s.requested}>{r.sub}</span>}
              </>
            ),
          },
          { key: 'a', header: tc('amount'), type: 'amount', render: (r) => <bdi className={r.cents < 0 ? 'bad' : ''}>{r.cents < 0 ? `−${money(-r.cents)}` : money(r.cents)}</bdi> },
          {
            key: 'e',
            header: '',
            width: 56,
            render: (r) =>
              r.href ? (
                <a className="an-iconbtn" href={r.href} target="_blank" rel="noreferrer" aria-label={tc('view')} onClick={(e) => e.stopPropagation()}>
                  <Icon as={Eye} />
                </a>
              ) : null,
          },
        ]}
      />
      <div className={s.foot2}>{t('money.foot')}</div>
    </Card>
  );

  const termsCards = (
    <div className="cols even">
      <Card title={t('terms.contacts')} action={canEdit('customers') && <Button size="sm" icon={Plus} onClick={() => setContact(true)}>{t('addContact')}</Button>}>
        <dl className="an-kv">
          <dt>{t('terms.mainContact')}</dt>
          <dd>{[cu.contactName, cu.phone].filter(Boolean).join(' · ')}</dd>
          <dt>{t('terms.invoicesTo')}</dt>
          <dd>
            <bdi>{cu.invoiceEmail}</bdi>
          </dd>
          <dt>{t('terms.deliversTo')}</dt>
          <dd>{deliversTo}</dd>
          <dt>{t('terms.billing')}</dt>
          <dd>{address}</dd>
          <dt>{t('fields.vat')}</dt>
          <dd>
            <bdi>{cu.vatNumber || '—'}</bdi>
          </dd>
          {(d.contacts ?? [])
            .filter((p) => !(p.name === cu.contactName && p.role === 'Main contact'))
            .map((p) => (
              <div key={p.id} style={{ display: 'contents' }}>
                <dt>{p.role || t('terms.contact')}</dt>
                <dd>{[p.name, p.phone, p.email].filter(Boolean).join(' · ')}</dd>
              </div>
            ))}
        </dl>
      </Card>
      <Card title={t('terms.title')}>
        <dl className="an-kv">
          <dt>{t('terms.payment')}</dt>
          <dd>{t(`terms.${cu.paymentTerms ?? 'before_shipping'}`)}</dd>
          <dt>{t('fields.priceList')}</dt>
          <dd>{t('terms.distributor', { range: priceList })}</dd>
          <dt>{t('terms.minimum')}</dt>
          <dd>{t('terms.minimumValue', { n: num(minCartons) })}</dd>
          <dt>{t('fields.proformaLanguage')}</dt>
          <dd>{cu.proformaLanguage === 'bg' ? t('terms.bulgarian') : t('terms.english')}</dd>
        </dl>
        {cu.note && <p className="body-sm muted">{cu.note}</p>}
      </Card>
    </div>
  );

  type HistRow = { id: string; at: string; what: ReactNode; href?: string };
  const histRows: HistRow[] = [
    ...(d.history ?? []).map((h) => ({ id: h.id, at: h.at, what: <>{t.has(`history.${h.action}`) ? t(`history.${h.action}`, { who: h.actorName ?? '' }) : h.action.replace(/_/g, ' ')}{h.actorName && !t.has(`history.${h.action}`) ? ` · ${h.actorName}` : ''}</> })),
    ...(d.documents ?? []).map((doc) => ({
      id: doc.id,
      at: doc.createdAt,
      what: (
        <>
          {doc.label ?? tc(`docType.${doc.type}`)} {doc.number && <bdi>{doc.number}</bdi>}
          {doc.totalCents != null && <span className="muted"> · {money(doc.totalCents)}</span>}
        </>
      ),
      href: docHref(doc),
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const filesTable = (
    <Card flush>
      <Table
        rows={histRows}
        rowKey={(r) => r.id}
        empty={<span className="muted">{t('tabs.noDocuments')}</span>}
        columns={[
          { key: 'w', header: t('files.when'), render: (r) => <span className="nowrap">{dateShort(r.at)}</span>, width: 140 },
          { key: 'x', header: t('files.what'), render: (r) => r.what },
          {
            key: 'e',
            header: '',
            width: 56,
            render: (r) =>
              r.href ? (
                <a className="an-iconbtn" href={r.href} target="_blank" rel="noreferrer" aria-label={tc('view')}>
                  <Icon as={Eye} />
                </a>
              ) : null,
          },
        ]}
      />
      <div className={s.foot2}>
        {t('files.foot')}
        {isAdmin && (
          <>
            {' '}
            <button type="button" className={s.link} onClick={() => archive.mutate(cu.status !== 'archived')}>
              {cu.status === 'archived' ? t('restore') : t('archive')}
            </button>
          </>
        )}
      </div>
    </Card>
  );

  const sheets = (
    <>
      <NewSaleSheet open={selling} onClose={() => setSelling(false)} customerId={id} onDone={(r) => (setSelling(false), router.push(`/sales/${r.id}`))} />
      {moving && <ChangeBrokerSheet customer={{ id: cu.id, companyName: cu.companyName, brokerId: free ? null : cu.brokerId, brokerName: free ? null : (d.broker?.name ?? null), months: d.rules?.ownershipMonths }} onClose={() => setMoving(false)} />}
      <Sheet
        open={contact}
        onClose={() => setContact(false)}
        title={t('addContact')}
        dirty={!!c.name}
        footer={
          <>
            <Button onClick={() => setContact(false)}>{tc('cancel')}</Button>
            <Button variant="primary" disabled={!c.name} busy={addContact.busy} onClick={() => addContact.mutate(undefined)}>
              {tc('save')}
            </Button>
          </>
        }
      >
        <TextField label={t('fields.contact')} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        <TextField label={t('fields.role')} value={c.role} onChange={(e) => setC({ ...c, role: e.target.value })} />
        <TextField label={t('fields.phone')} type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
        <TextField label={tc('email')} type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} error={addContact.fields.email} />
        <ActionError action={addContact} />
      </Sheet>
    </>
  );

  // ---------- phone ----------
  if (phone) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tc('nav.customers'), href: '/customers' }, { label: cu.companyName }]} title={cu.companyName} />
        <div className={s.head}>
          <span className={s.note}>{free ? t('kickerFree') : d.broker ? `${d.broker.name} · ${cu.ownedUntil ? t('keepsItUntil', { date: date(cu.ownedUntil) }) : t('keepsNotSet')}` : t('kickerHouse')}</span>
          <Pill tone={STATUS_TONE[cu.displayStatus] ?? 'info'}>{tc(`customerStatus.${cu.displayStatus}`)}</Pill>
        </div>
        {banners}
        <div className="kpis">
          <KpiTile label={t('tiles.owes')} value={money(tiles.owesCents, true)} valueTone={tiles.lateCents ? 'bad' : undefined} sub={tiles.lateCents ? t('tiles.lateWord') : t('tiles.nothingLate')} subTone={tiles.lateCents ? 'bad' : undefined} />
          <KpiTile label={t('tiles.lastOrder')} value={tiles.lastOrder ? dateShort(tiles.lastOrder.createdAt) : '—'} sub={t('tiles.vatShort', { vat: vatLabel })} />
        </div>
        <div className={s.btns}>
          <a className={`an-btn secondary keep ${cu.phone ? '' : 'disabled'}`} href={cu.phone ? `tel:${cu.phone}` : undefined}>
            <Icon as={Phone} size="sm" />
            {tc('call')}
          </a>
          <a className="an-btn secondary keep" href={`mailto:${cu.invoiceEmail}`}>
            <Icon as={EnvelopeSimple} size="sm" />
            {tc('email')}
          </a>
        </div>
        {(isAdmin || canSell) && (
          <div className={s.btns}>
            {isAdmin && (
              <Button onClick={() => setMoving(true)}>
                {t('changeBroker')}
              </Button>
            )}
            {canSell && (
              <Button variant="primary" icon={Plus} onClick={() => setSelling(true)}>
                {tc('newSale')}
              </Button>
            )}
          </div>
        )}
        <div className={s.grp}>{t('ordersCount', { n: orders.length })}</div>
        {orders.length === 0 ? (
          <Card>
            <span className="muted">{t('tabs.noOrders')}</span>
          </Card>
        ) : (
          <div className="list-cards">
            {orders.map((o) => (
              <Link key={o.id} href={`/sales/${o.id}`} className="an-lcard">
                <span className="t">
                  <bdi>{o.number}</bdi>
                </span>
                <span className="amt">
                  <bdi>{money(o.totalCents)}</bdi>
                </span>
                <span className="sub">{dateShort(o.requestSentAt ?? o.createdAt)}</span>
                <OrderStatusPill status={o.status} daysLate={late(o)} />
              </Link>
            ))}
          </div>
        )}
        {(d.documents ?? []).some((x) => x.type === 'proforma' && !x.supersededById) && (
          <Card title={t('proformas')}>
            {(d.documents ?? [])
              .filter((x) => x.type === 'proforma' && !x.supersededById)
              .map((doc) => (
                <DocRow
                  key={doc.id}
                  icon={FileText}
                  title={
                    <>
                      {tc('docType.proforma')} <bdi>{doc.number}</bdi>
                    </>
                  }
                  sub={[dateShort(doc.createdAt), doc.totalCents != null ? money(doc.totalCents) : null].filter(Boolean).join(' · ')}
                  actions={
                    <a className="an-iconbtn" href={docHref(doc)} target="_blank" rel="noreferrer" aria-label={`${tc('view')} ${doc.number ?? ''}`}>
                      <Icon as={Eye} />
                    </a>
                  }
                />
              ))}
          </Card>
        )}
        <Card title={t('terms.termsAndContact')}>
          <dl className="an-kv">
            <dt>{t('terms.payment')}</dt>
            <dd>{t(`terms.${cu.paymentTerms ?? 'before_shipping'}`)}</dd>
            <dt>{t('fields.priceList')}</dt>
            <dd>{priceList}</dd>
            <dt>{t('terms.minimum')}</dt>
            <dd>{t('terms.minimumValue', { n: num(minCartons) })}</dd>
            <dt>{t('terms.contact')}</dt>
            <dd>{[cu.contactName, cu.phone].filter(Boolean).join(' · ')}</dd>
            <dt>{t('terms.deliversTo')}</dt>
            <dd>{deliversTo}</dd>
          </dl>
        </Card>
        {sheets}
      </div>
    );
  }

  // ---------- desktop ----------
  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.customers'), href: '/customers' }, { label: cu.companyName }]}
        kicker={kicker}
        title={cu.companyName}
        actions={
          <>
            <a className="an-btn secondary sm keep" href={`mailto:${cu.invoiceEmail}`}>
              <Icon as={EnvelopeSimple} size="sm" />
              {tc('email')}
            </a>
            {isAdmin && (
              <Button size="sm" onClick={() => setMoving(true)}>
                {t('changeBroker')}
              </Button>
            )}
            {canSell && (
              <Button size="sm" variant="primary" icon={Plus} onClick={() => setSelling(true)}>
                {tc('newSale')}
              </Button>
            )}
          </>
        }
      />
      {banners}
      <div className="kpis">
        <KpiTile
          label={t('tiles.owes')}
          value={money(tiles.owesCents)}
          valueTone={tiles.lateCents ? 'bad' : undefined}
          sub={tiles.lateCents ? t('tiles.lateWord') : t('tiles.nothingLate')}
          subTone={tiles.lateCents ? 'bad' : undefined}
          chevron
          onClick={() => setTab('money')}
        />
        <KpiTile label={t('tiles.lastOrder')} value={tiles.lastOrder ? dateShort(tiles.lastOrder.createdAt) : t('neverOrdered')} />
        <KpiTile label={t('tiles.delivered')} value={money(tiles.deliveredSalesCents)} sub={t('tiles.allTime')} />
        <KpiTile label={t('tiles.vat')} value={vatLabel} sub={vatSub} subTone={cu.vatValid === false ? 'bad' : undefined} />
      </div>
      <Chips
        value={tab}
        onChange={setTab}
        fill={false}
        options={[
          { value: 'orders', label: t('tabs.orders'), count: orders.length },
          { value: 'money', label: t('tabs.payments') },
          { value: 'terms', label: t('tabs.contacts') },
          { value: 'files', label: t('tabs.documents') },
        ]}
      />
      {tab === 'orders' && ordersTable}
      {tab === 'money' && moneyTable}
      {tab === 'terms' && termsCards}
      {tab === 'files' && filesTable}
      {sheets}
    </div>
  );
}
