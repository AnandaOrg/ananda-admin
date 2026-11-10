'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { REASONS, type OrderStatus } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import {
  Banner,
  Button,
  Card,
  Chips,
  DocRow,
  EnvelopeOpen,
  ErrorState,
  Eye,
  FileText,
  KeyValue,
  KpiTile,
  OrderStatusPill,
  PageHeader,
  PageSkeleton,
  Phone,
  Pill,
  Plus,
  ReasonChips,
  Receipt,
  Select,
  Sheet,
  Table,
  TextArea,
  TextField,
  Users,
} from '@/components/ui';
import { STATUS_TONE } from '../status';

interface CustomerCard {
  freeToClaim: boolean;
  customer: {
    id: string;
    companyName: string;
    vatNumber: string;
    vatValid: boolean | null;
    country: string;
    city: string | null;
    registeredAddress: string;
    deliveryAddress: string | null;
    contactName: string;
    phone: string;
    invoiceEmail: string;
    proformaLanguage: string;
    paymentTermsDays: number;
    ownedUntil: string | null;
    note: string | null;
    status: string;
    displayStatus: string;
    agentId: string | null;
  };
  agent?: { id: string; name: string; email: string } | null;
  tiles?: { owesCents: number; lateCents: number; lastOrder: { id: string; number: string; createdAt: string } | null; deliveredSalesCents: number; vatRegime: string };
  orders?: { id: string; number: string; status: OrderStatus; createdAt: string; totalCents: number; totalCartons: number; outstandingCents: number; paymentDueOn: string | null }[];
  payments?: { id: string; receivedOn: string; amountCents: number; method: string; bankReference: string | null; orderNumber: string; orderId: string }[];
  credits?: { id: string; number: string; createdAt: string; totalCents: number }[];
  documents?: { id: string; type: string; number: string | null; createdAt: string; totalCents: number | null; language: string; supersededById: string | null }[];
  contacts?: { id: string; name: string; role: string | null; phone: string | null; email: string | null }[];
  history?: { id: string; at: string; actorName: string | null; action: string; meta: Record<string, unknown> | null }[];
  approval?: { status: string; declineReason: string | null; declineMessage: string | null } | null;
}

type Tab = 'orders' | 'payments' | 'contacts' | 'documents';

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const ts = useTranslations('sales');
  const router = useRouter();
  const { isAgent, isAdmin, canEdit } = useSession();
  const { money, date, dateTime, num } = useFmt();
  const [tab, setTab] = useState<Tab>('orders');
  const [changeAgent, setChangeAgent] = useState(false);
  const [contact, setContact] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [c, setC] = useState({ name: '', role: '', phone: '', email: '' });
  const q = useQuery({ queryKey: ['customers', id], queryFn: () => api.get<CustomerCard>(`/customers/${id}`) });
  const agents = useQuery({ queryKey: ['agents-list'], queryFn: () => api.get<{ id: string; name: string }[]>('/customers/agents'), enabled: changeAgent });
  const claim = useAction(() => api.post(`/customers/${id}/claim`), { success: t('claimed') });
  const submit = useAction(() => api.patch(`/customers/${id}`, { submit: true }), { success: t('new.sent') });
  const move = useAction(() => api.post(`/customers/${id}/change-agent`, { agentId, reason, note: note || undefined }), { success: t('agentChanged'), onDone: () => setChangeAgent(false) });
  const archive = useAction((archived: boolean) => api.post(`/customers/${id}/archive`, { archived }), { success: t('archivedDone') });
  const addContact = useAction(() => api.post(`/customers/${id}/contacts`, { name: c.name, role: c.role || undefined, phone: c.phone || undefined, email: c.email || undefined }), { success: t('contactAdded'), onDone: () => setContact(false) });

  if (q.isLoading) return <PageSkeleton />;
  if (!q.data) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  const cu = d.customer;

  if (d.freeToClaim) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: tc('nav.customers'), href: '/customers' }, { label: cu.companyName }]} title={cu.companyName} />
        <Card>
          <KeyValue items={[[t('fields.vat'), <bdi key="v">{cu.vatNumber}</bdi>], [t('fields.city'), cu.city ?? '—'], [t('cols.ownsUntil'), cu.ownedUntil ? date(cu.ownedUntil) : '—']]} />
          <p className="muted">{t('freeText')}</p>
          <Button variant="primary" busy={claim.isPending} onClick={() => claim.mutate(undefined)}>
            {t('claim')}
          </Button>
          {claim.errorText && <Banner tone="bad">{claim.errorText}</Banner>}
        </Card>
      </div>
    );
  }

  const tiles = d.tiles!;
  const canSell = canEdit('sales') && (cu.status === 'active') && (!isAgent || cu.agentId);
  const docHref = (doc: { id: string; type: string }) => (doc.type === 'delivery_note' || doc.type === 'upload' ? `/api/documents/${doc.id}/file` : `/api/documents/${doc.id}/print`);

  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: tc('nav.customers'), href: '/customers' }, { label: cu.companyName }]}
        kicker={
          <>
            <bdi>{cu.vatNumber}</bdi> · {d.agent?.name ?? t('noAgent')}
            {cu.ownedUntil && ` · ${t('ownsUntil', { date: date(cu.ownedUntil) })}`}
          </>
        }
        title={
          <span className="row wrap" style={{ gap: 'var(--space-3)' }}>
            {cu.companyName}
            <Pill tone={STATUS_TONE[cu.displayStatus] ?? 'info'}>{tc(`customerStatus.${cu.displayStatus}`)}</Pill>
          </span>
        }
        actions={
          <>
            <a className="an-btn secondary sm" href={`mailto:${cu.invoiceEmail}`}>
              <EnvelopeOpen className="an-ic sm" aria-hidden /> {tc('email')}
            </a>
            {isAdmin && (
              <Button size="sm" icon={Users} onClick={() => setChangeAgent(true)}>
                {t('changeAgent')}
              </Button>
            )}
            {canSell && (
              <Link href={`/sales/new?customer=${id}`} className="an-btn primary sm">
                <Plus className="an-ic sm" aria-hidden /> {tc('newSale')}
              </Link>
            )}
          </>
        }
      />
      {(cu.status === 'draft' || cu.status === 'declined') && (
        <Banner
          tone={cu.status === 'declined' ? 'bad' : 'info'}
          sub={cu.status === 'declined' ? [d.approval?.declineReason && tc(`reasons.decline.${d.approval.declineReason}`), d.approval?.declineMessage].filter(Boolean).join(' · ') : undefined}
          action={isAgent ? { label: t('new.sendForApproval'), onClick: () => submit.mutate(undefined) } : undefined}
        >
          {cu.status === 'declined' ? t('declinedBanner') : t('draftBanner')}
        </Banner>
      )}
      {cu.status === 'needs_approval' && <Banner>{t('waitingBanner')}</Banner>}

      <div className="kpis">
        <KpiTile label={t('tiles.owes')} value={money(tiles.owesCents, true)} sub={tiles.lateCents ? t('tiles.late', { amount: money(tiles.lateCents, true) }) : t('tiles.nothingLate')} subTone={tiles.lateCents ? 'bad' : undefined} />
        <KpiTile label={t('tiles.lastOrder')} value={tiles.lastOrder ? date(tiles.lastOrder.createdAt) : '—'} sub={tiles.lastOrder ? <bdi>{tiles.lastOrder.number}</bdi> : t('tiles.noOrders')} />
        <KpiTile label={t('tiles.delivered')} value={money(tiles.deliveredSalesCents, true)} sub={t('tiles.deliveredSub')} />
        <KpiTile label={t('tiles.vat')} value={t(`vatRegime.${tiles.vatRegime}`)} sub={cu.vatValid === true ? t('tiles.viesValid') : cu.vatValid === false ? t('tiles.viesInvalid') : t('tiles.viesUnchecked')} subTone={cu.vatValid === false ? 'bad' : undefined} />
      </div>

      <Chips
        value={tab}
        onChange={setTab}
        options={[
          { value: 'orders', label: t('tabs.orders'), count: d.orders?.length },
          { value: 'payments', label: t('tabs.payments') },
          { value: 'contacts', label: t('tabs.contacts') },
          { value: 'documents', label: t('tabs.documents') },
        ]}
      />

      {tab === 'orders' && (
        <Card flush>
          <Table
            rows={d.orders ?? []}
            rowKey={(o) => o.id}
            onRow={(o) => router.push(`/sales/${o.id}`)}
            empty={t('tabs.noOrders')}
            columns={[
              { key: 'n', header: t('cols.order'), render: (o) => <bdi className="nm">{o.number}</bdi> },
              { key: 'd', header: tc('created'), render: (o) => date(o.createdAt) },
              { key: 'c', header: tc('cartons'), type: 'count', render: (o) => num(o.totalCartons) },
              { key: 't', header: tc('totalInclVat'), type: 'amount', render: (o) => money(o.totalCents) },
              { key: 'w', header: t('cols.owes'), type: 'amount', render: (o) => (o.outstandingCents && o.status !== 'draft' && o.status !== 'cancelled' ? money(o.outstandingCents) : '—') },
              { key: 's', header: tc('status'), render: (o) => <OrderStatusPill status={o.status} /> },
            ]}
          />
        </Card>
      )}
      {tab === 'payments' && (
        <div className="cols even">
          <Card flush title={t('tabs.payments')}>
            <Table
              rows={d.payments ?? []}
              rowKey={(p) => p.id}
              empty={t('tabs.noPayments')}
              columns={[
                { key: 'd', header: tc('date'), render: (p) => date(p.receivedOn) },
                { key: 'o', header: t('cols.order'), render: (p) => <Link href={`/sales/${p.orderId}`}><bdi>{p.orderNumber}</bdi></Link> },
                { key: 'r', header: ts('actions.confirm_payment.reference'), render: (p) => <bdi>{p.bankReference ?? '—'}</bdi> },
                { key: 'a', header: tc('amount'), type: 'amount', render: (p) => money(p.amountCents) },
              ]}
            />
          </Card>
          <Card flush title={t('tabs.credits')}>
            <Table
              rows={d.credits ?? []}
              rowKey={(p) => p.id}
              empty={t('tabs.noCredits')}
              columns={[
                { key: 'd', header: tc('date'), render: (p) => date(p.createdAt) },
                { key: 'n', header: tc('docType.credit_note'), render: (p) => <bdi>{p.number}</bdi> },
                { key: 'a', header: tc('amount'), type: 'amount', render: (p) => money(p.totalCents) },
              ]}
            />
          </Card>
        </div>
      )}
      {tab === 'contacts' && (
        <div className="cols even">
          <Card title={t('tabs.terms')}>
            <KeyValue
              items={[
                [t('fields.registeredAddress'), cu.registeredAddress],
                [t('fields.deliveryAddress'), cu.deliveryAddress ?? cu.registeredAddress],
                [t('fields.invoiceEmail'), cu.invoiceEmail],
                [t('fields.proformaLanguage'), cu.proformaLanguage === 'bg' ? 'Български' : 'English'],
                [t('fields.terms'), ts('form.termsDays', { n: cu.paymentTermsDays })],
                [t('fields.priceList'), t('priceListDistributor')],
              ]}
            />
            {cu.note && <p className="body-sm muted">{cu.note}</p>}
          </Card>
          <Card title={t('tabs.contacts')} action={canEdit('customers') && <Button size="sm" icon={Plus} onClick={() => setContact(true)}>{t('addContact')}</Button>}>
            {(d.contacts ?? []).map((p) => (
              <div key={p.id} className="row between">
                <span>
                  {p.name}
                  <span className="sub caption muted" style={{ display: 'block' }}>
                    {[p.role, p.email].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {p.phone && (
                  <a className="an-btn secondary sm" href={`tel:${p.phone}`}>
                    <Phone className="an-ic sm" aria-hidden /> {tc('call')}
                  </a>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}
      {tab === 'documents' && (
        <div className="cols even">
          <Card title={t('tabs.documents')}>
            {(d.documents ?? []).length === 0 ? (
              <p className="body-sm subtle">{t('tabs.noDocuments')}</p>
            ) : (
              <div>
                {(d.documents ?? []).map((doc) => (
                  <DocRow
                    key={doc.id}
                    icon={doc.type === 'invoice' || doc.type === 'credit_note' ? Receipt : FileText}
                    title={
                      <>
                        {tc(`docType.${doc.type}`)} {doc.number && <bdi>{doc.number}</bdi>}
                      </>
                    }
                    sub={[date(doc.createdAt), doc.totalCents != null ? money(doc.totalCents) : null].filter(Boolean).join(' · ')}
                    actions={
                      <a className="an-iconbtn" href={docHref(doc)} target="_blank" rel="noreferrer" aria-label={`${tc('view')} ${doc.number ?? ''}`}>
                        <Eye className="an-ic" aria-hidden />
                      </a>
                    }
                  />
                ))}
              </div>
            )}
          </Card>
          <Card title={t('tabs.history')}>
            <div className="stack tight">
              {(d.history ?? []).map((h) => (
                <div key={h.id} className="row between body-sm">
                  <span>
                    {t.has(`history.${h.action}`) ? t(`history.${h.action}`) : h.action.replace(/_/g, ' ')}
                    <span className="muted"> · {h.actorName}</span>
                  </span>
                  <span className="muted nowrap">{dateTime(h.at)}</span>
                </div>
              ))}
            </div>
            {isAdmin && (
              <Button size="sm" onClick={() => archive.mutate(cu.status !== 'archived')}>
                {cu.status === 'archived' ? t('restore') : t('archive')}
              </Button>
            )}
          </Card>
        </div>
      )}

      <Sheet
        open={changeAgent}
        onClose={() => setChangeAgent(false)}
        title={t('changeAgent')}
        sub={cu.companyName}
        footer={
          <>
            <Button onClick={() => setChangeAgent(false)}>{tc('cancel')}</Button>
            <Button variant="primary" disabled={!agentId || !reason} busy={move.isPending} onClick={() => move.mutate(undefined)}>
              {t('changeAgent')}
            </Button>
          </>
        }
      >
        <Select label={t('newAgent')} value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder={t('chooseAgent')} options={(agents.data ?? []).filter((a) => a.id !== cu.agentId).map((a) => ({ value: a.id, label: a.name }))} />
        <ReasonChips reasons={REASONS.change_agent} value={reason} onChange={setReason} label={tc('reason')} ns="change_agent" />
        <TextArea label={tc('noteOptional')} value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="body-sm muted">{t('changeAgentNote')}</p>
        {move.errorText && <Banner tone="bad">{move.errorText}</Banner>}
      </Sheet>
      <Sheet
        open={contact}
        onClose={() => setContact(false)}
        title={t('addContact')}
        footer={
          <>
            <Button onClick={() => setContact(false)}>{tc('cancel')}</Button>
            <Button variant="primary" disabled={!c.name} busy={addContact.isPending} onClick={() => addContact.mutate(undefined)}>
              {tc('save')}
            </Button>
          </>
        }
      >
        <TextField label={t('fields.contact')} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        <TextField label={t('fields.role')} value={c.role} onChange={(e) => setC({ ...c, role: e.target.value })} />
        <TextField label={t('fields.phone')} type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
        <TextField label={tc('email')} type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} error={addContact.fields.email} />
      </Sheet>
    </div>
  );
}
