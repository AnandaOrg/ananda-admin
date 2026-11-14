'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { FLAVOURS, type Flavour, type StatusTone } from '@ananda/shared';
import { api } from '@/lib/api';
import { useFmt } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { ActionError, Banner, Button, DownloadSimple, EnvelopeSimple, Eye, FileText, KeyValue, NotePencil, Pill, Segmented, Sheet, ShoppingCart, TextField } from '@/components/ui';
import { FlavourToggles } from '../_components/FlavourToggles';
import { formWith, type Supplier, type SupplierDetail } from '../_lib/types';
import css from '../purchasing.module.css';

type Status = Supplier['status'];
export const SUPPLIER_TONE: Record<Status, StatusTone> = { approved: 'good', pending: 'warn', inactive: 'mute' };

/** Country code → its name in the user's language ("IT" → "Italy"). */
export function useCountryName() {
  const locale = useLocale();
  return (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' }).of(code.toUpperCase()) ?? code;
    } catch {
      return code;
    }
  };
}

/** "All four", "None", or the flavours by name ("Aloha, Gaia"). `lower` for use inside a sentence. */
export function useFlavourList() {
  const t = useTranslations('purchasing');
  return (fs: string[], lower = false) => {
    const s = fs.length === FLAVOURS.length ? t('suppliers.allFlavours') : fs.length === 0 ? t('suppliers.noFlavours') : FLAVOURS.filter((f) => fs.includes(f)).map((f) => f[0].toUpperCase() + f.slice(1)).join(', ');
    return lower && (fs.length === FLAVOURS.length || fs.length === 0) ? s.toLowerCase() : s;
  };
}

/** Supplier details in a side panel: status, VAT, contact, lead time, terms, flavours, contracts. */
export function SupplierView({ supplier, onClose, onEdit, onBuy }: { supplier: Supplier | null; onClose: () => void; onEdit?: (s: Supplier) => void; onBuy?: (s: Supplier) => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const { date } = useFmt();
  const country = useCountryName();
  const input = useRef<HTMLInputElement>(null);
  const q = useQuery({ queryKey: ['suppliers', supplier?.id], queryFn: () => api.get<SupplierDetail>(`/suppliers/${supplier!.id}`), enabled: !!supplier });
  const up = useAction((file: File) => api.post(`/suppliers/${supplier!.id}/documents`, formWith({}, { file })), { success: t('docs.done') });
  if (!supplier) return null;
  const s = supplier;
  const docs = q.data?.documents ?? [];
  return (
    <Sheet
      open
      onClose={onClose}
      title={<bdi>{s.company}</bdi>}
      sub={
        <>
          {country(s.country)} · {s.lastPurchaseNumber ? <><bdi>{s.lastPurchaseNumber}</bdi> · {date(s.lastPurchaseOn)}</> : t('new.noPurchases')}
        </>
      }
      footer={
        <>
          <a className="an-btn secondary" href={`mailto:${s.ordersEmail}`}>
            <EnvelopeSimple className="an-ic sm" aria-hidden />
            {t('suppliers.email')}
          </a>
          {onBuy && s.status === 'approved' && (
            <Button variant="primary" icon={ShoppingCart} onClick={() => onBuy(s)}>
              {t('new.title')}
            </Button>
          )}
        </>
      }
    >
      <div className={`an-card ${css.card}`}>
        <KeyValue
          items={[
            [tc('status'), <Pill key="s" tone={SUPPLIER_TONE[s.status]}>{t(`suppliers.status.${s.status}`)}</Pill>],
            [t('suppliers.vat'), s.vatNumber ? <bdi key="v">{s.vatNumber}</bdi> : '—'],
            [t('suppliers.form.contact'), <bdi key="c">{[s.contactName, s.ordersEmail].filter(Boolean).join(' · ')}</bdi>],
            [t('suppliers.cols.leadTime'), t('suppliers.days', { n: s.leadTimeDays })],
            [t('suppliers.cols.terms'), t('suppliers.days', { n: s.paymentTermsDays })],
          ]}
        />
      </div>
      <FlavourToggles readOnly label={t('suppliers.cols.approved')} value={s.approvedFlavours} onChange={() => {}} />
      <FlavourToggles readOnly label={t('suppliers.defaultSupplierFor')} value={s.defaultFlavours} onChange={() => {}} />
      <div className="stack tight">
        <span className="body-sm muted">{t('suppliers.contracts')}</span>
        {docs.map((d) => (
          <div key={d.id} className="an-doc">
            <span className="ico">
              <FileText className="an-ic" aria-hidden />
            </span>
            <span>
              <span className="t">
                <bdi>{d.label}</bdi>
              </span>
              <span className="sub">{t('docs.uploadedBy', { date: date(d.createdAt), by: d.by ?? '' })}</span>
            </span>
            <a className="an-iconbtn" href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" aria-label={`${tc('view')} ${d.label ?? ''}`}>
              <Eye className="an-ic" aria-hidden />
            </a>
          </div>
        ))}
        {onEdit && (
          <>
            <input
              ref={input}
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) up.mutate(f);
                e.target.value = '';
              }}
            />
            <div className="row wrap">
              <Button size="sm" icon={DownloadSimple} busy={up.isPending} onClick={() => input.current?.click()}>
                {t('docs.uploadDocument')}
              </Button>
              <Button size="sm" icon={NotePencil} onClick={() => onEdit(s)}>
                {t('suppliers.edit')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** FR-PUR-3 New supplier / Edit supplier. Making it the default for a flavour moves the default. */
export function SupplierSheet({ open, supplier, all, onClose }: { open: boolean; supplier: Supplier | null; all: Supplier[]; onClose: () => void }) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const [company, setCompany] = useState('');
  const [country, setCountry] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [ordersEmail, setOrdersEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [approved, setApproved] = useState<Flavour[]>([]);
  const [defaults, setDefaults] = useState<Flavour[]>([]);
  const [lead, setLead] = useState('');
  const [terms, setTerms] = useState('30');
  const [price, setPrice] = useState('');
  const [status, setStatus] = useState<Status>('approved');

  useEffect(() => {
    if (!open) return;
    const s = supplier;
    setCompany(s?.company ?? '');
    setCountry(s?.country ?? '');
    setVatNumber(s?.vatNumber ?? '');
    setContactName(s?.contactName ?? '');
    setOrdersEmail(s?.ordersEmail ?? '');
    setPhone(s?.phone ?? '');
    setApproved(s?.approvedFlavours ?? []);
    setDefaults(s?.defaultFlavours ?? []);
    setLead(s ? String(s.leadTimeDays) : '');
    setTerms(String(s?.paymentTermsDays ?? 30));
    setPrice(s ? String(s.unitPriceCents / 100) : '');
    setStatus(s?.status ?? 'approved');
  }, [open, supplier]);

  const priceCents = Math.round(parseFloat(price.replace(',', '.')) * 1_000_000) / 10_000;
  const body = {
    company: company.trim(),
    country: country.trim().toUpperCase(),
    vatNumber: vatNumber.trim() || undefined,
    contactName: contactName.trim() || undefined,
    ordersEmail: ordersEmail.trim(),
    phone: phone.trim() || undefined,
    approvedFlavours: approved,
    defaultFlavours: status === 'approved' ? defaults.filter((f) => approved.includes(f)) : [],
    leadTimeDays: parseInt(lead, 10) || 0,
    paymentTermsDays: parseInt(terms, 10) || 0,
    unitPriceCents: Number.isFinite(priceCents) ? priceCents : 0,
    status,
  };
  const save = useAction(() => (supplier ? api.patch(`/suppliers/${supplier.id}`, body) : api.post('/suppliers', body)), {
    success: supplier ? t('suppliers.saved', { name: body.company }) : t('suppliers.created'),
    onDone: onClose,
  });

  const moves = body.defaultFlavours
    .map((f) => ({ f, from: all.find((s) => s.id !== supplier?.id && s.defaultFlavours.includes(f)) }))
    .filter((m) => m.from);
  const ready = body.company && body.country.length === 2 && body.ordersEmail && approved.length > 0 && body.leadTimeDays > 0 && Number.isFinite(priceCents);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={supplier ? t('suppliers.edit') : t('suppliers.new')}
      sub={supplier ? <bdi>{supplier.company}</bdi> : undefined}
      dirty
      footer={
        <Button variant="primary" block disabled={!ready} busy={save.isPending} onClick={() => save.mutate(undefined)}>
          {supplier ? tc('save') : t('suppliers.createCta')}
        </Button>
      }
    >
      <TextField label={t('suppliers.form.company')} value={company} onChange={(e) => setCompany(e.target.value)} error={save.fields.company} placeholder={t('suppliers.form.companyPh')} />
      <div className="form-grid">
        <TextField label={t('suppliers.form.country')} value={country} maxLength={2} onChange={(e) => setCountry(e.target.value.toUpperCase())} error={save.fields.country} placeholder={t('suppliers.form.countryHelp')} />
        <TextField label={t('suppliers.form.vat')} value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} error={save.fields.vatNumber} placeholder={t('suppliers.form.vatPh')} />
      </div>
      <div className="form-grid">
        <TextField label={t('suppliers.form.contact')} value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder={t('suppliers.form.contactPh')} />
        <TextField label={t('suppliers.form.ordersEmail')} type="email" value={ordersEmail} onChange={(e) => setOrdersEmail(e.target.value)} error={save.fields.ordersEmail} placeholder={t('suppliers.form.emailPh')} />
      </div>
      <TextField label={t('suppliers.form.leadTime')} inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, ''))} error={save.fields.leadTimeDays} placeholder={t('suppliers.form.leadPh')} />
      <div className="form-grid">
        <TextField label={t('suppliers.form.price')} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={save.fields.unitPriceCents} placeholder={t('suppliers.form.pricePh')} />
        <TextField label={t('suppliers.form.terms')} inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value.replace(/\D/g, ''))} error={save.fields.paymentTermsDays} />
      </div>
      {supplier && <TextField label={t('suppliers.form.phone')} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
      <FlavourToggles
        label={t('suppliers.cols.approved')}
        value={approved}
        onChange={(v) => {
          setApproved(v);
          setDefaults(defaults.filter((f) => v.includes(f)));
        }}
        error={save.fields.approvedFlavours}
      />
      {status === 'approved' && approved.length > 0 && <FlavourToggles label={t('suppliers.defaultSupplierFor')} value={defaults} onChange={setDefaults} only={approved} help={t('suppliers.form.defaultsHelp')} error={save.fields.defaultFlavours} />}
      {moves.length > 0 && <Banner>{moves.map((m) => t('suppliers.form.moves', { flavour: m.f.toUpperCase(), from: m.from!.company })).join(' ')}</Banner>}
      {supplier && (
        <div className="an-field">
          <label>{tc('status')}</label>
          <Segmented fill label={tc('status')} value={status} onChange={setStatus} options={(['approved', 'pending', 'inactive'] as Status[]).map((s) => ({ value: s, label: t(`suppliers.status.${s}`) }))} />
          {status !== 'approved' && <span className="an-help">{t('suppliers.form.notApprovedHelp')}</span>}
        </div>
      )}
      {!supplier && <p className="body-sm muted">{t('suppliers.form.thenPick')}</p>}
      {!Object.keys(save.fields).length && <ActionError action={save} />}
    </Sheet>
  );
}
